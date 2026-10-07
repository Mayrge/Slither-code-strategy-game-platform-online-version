import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const root=fileURLToPath(new URL('../',import.meta.url));
export function tunnelUrl(text) { return text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i)?.[0] || null; }
export function configurePublicUrl(text,url) {
  if (url && (!tunnelUrl(url) || tunnelUrl(url)!==url)) throw Error('临时网址格式无效');
  const line='PUBLIC_URL='+url;
  return /^PUBLIC_URL=[^\r\n]*/m.test(text) ? text.replace(/^PUBLIC_URL=[^\r\n]*/m,line) : text+(text.endsWith('\n')||!text?'':'\n')+line+'\n';
}
const wait=ms=>new Promise(resolveWait=>setTimeout(resolveWait,ms));
async function health(url,timeout=2000) {
  try {const response=await fetch(url+'/api/health',{signal:AbortSignal.timeout(timeout)});return response.ok && (await response.json()).app==='snake-arena-online';}catch{return false;}
}
async function downloadConnector(file) {
  try {await access(file);return;}catch{}
  console.log('首次启动：正在下载 Cloudflare 官方连接器……');
  const headers={'User-Agent':'Snake-Arena-Setup'};
  const release=await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest',{headers,signal:AbortSignal.timeout(30000)});
  if(!release.ok)throw Error('无法查询官方连接器，请检查网络后重试。');
  const asset=(await release.json()).assets.find(a=>a.name==='cloudflared-windows-amd64.exe');
  if(!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest||'') || !asset.browser_download_url.startsWith('https://github.com/cloudflare/cloudflared/releases/download/'))throw Error('官方连接器下载信息或校验信息不完整。');
  const response=await fetch(asset.browser_download_url,{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error('连接器下载失败，请检查网络后重试。');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(createHash('sha256').update(bytes).digest('hex')!==asset.digest.slice(7))throw Error('连接器文件校验失败。');
  await writeFile(file+'.download',bytes);await rename(file+'.download',file);
}
function alive(pid) {if(!Number.isSafeInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
async function lock(file) {
  for(let attempt=0;attempt<2;attempt++) {
    try {const handle=await open(file,'wx');await handle.writeFile(String(process.pid));await handle.close();return;}
    catch(error) {
      if(error.code!=='EEXIST')throw error;
      const pid=Number((await readFile(file,'utf8')).trim());
      if(!Number.isSafeInteger(pid)||pid<1)throw Error('启动记录正在写入，请稍后重试。');
      if(alive(pid))throw Error('临时试玩已在运行，请保留已有窗口，不要重复启动。');
      await unlink(file);
    }
  }
  throw Error('无法取得启动锁，请稍后重试。');
}
function openSite(url) {
  const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true,stdio:'ignore'});
  child.on('error',()=>{});child.unref();
}
export async function startQuickTunnel({openBrowser=true}={}) {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('这个双击入口需要64位 Windows。其他平台请按部署说明运行 Cloudflare Tunnel。');
  const [major,minor]=process.versions.node.split('.').map(Number);
  if(major<24||(major===24&&minor<4))throw Error('请安装 Node.js 24.4 或更新版本。');
  await access(resolve(root,'node_modules/quickjs-emscripten/package.json')).catch(()=>{throw Error('请先运行“首次初始化.cmd”。');});
  await access(resolve(root,'data/arena.sqlite')).catch(()=>{throw Error('请先运行“首次初始化.cmd”。');});
  const port=Number(process.env.PORT||3082);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT需要是1024～65535之间的端口。');
  const local='http://127.0.0.1:'+port;
  if(await health(local))throw Error('本机竞技台已在运行。请先关闭原启动窗口，再双击这个临时试玩入口。');
  const lockFile=resolve(root,'data/quick-tunnel.lock'),envFile=resolve(root,'.env');
  const previousEnv=await readFile(envFile,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
  const previousUrl=previousEnv.match(/^PUBLIC_URL=(.*)$/m)?.[1]?.trim()||'';
  await lock(lockFile);
  let connector,server,log,rl,url,configured=false,closing=false,endpointTimeout;
  let stop;
  const stopped=new Promise(resolveStop=>{stop=()=>{closing=true;resolveStop();};});
  const stopSignal=()=>stop();
  process.once('SIGINT',stopSignal);process.once('SIGTERM',stopSignal);
  try {
    const tools=resolve(root,'exports/tunnel');await mkdir(tools,{recursive:true});
    const executable=resolve(tools,'cloudflared.exe');await downloadConnector(executable);
    log=createWriteStream(resolve(root,'data/tunnel-cloudflared.log'),{flags:'a',mode:0o600});
    log.on('error',()=>stop());
    connector=spawn(executable,['tunnel','--no-autoupdate','--url',local,'--protocol','http2'],{cwd:tools,windowsHide:true,stdio:['ignore','pipe','pipe']});
    connector.once('exit',()=>stop());
    console.log('正在生成临时网址……');
    const endpoint=new Promise((ready,reject)=>{
      let tail='';endpointTimeout=setTimeout(()=>reject(Error('隧道连接超时，请检查网络后重试。')),60000);
      const onError=()=>{clearTimeout(endpointTimeout);reject(Error('Cloudflare 连接器无法启动。'));};
      connector.once('error',onError);connector.once('exit',onError);
      for(const stream of [connector.stdout,connector.stderr])stream.on('data',chunk=>{
        log.write(chunk);tail=(tail+chunk.toString()).slice(-16000);
        const found=tunnelUrl(tail);
        if(found && tail.includes('Registered tunnel connection')){clearTimeout(endpointTimeout);connector.removeListener('error',onError);connector.removeListener('exit',onError);ready(found);}
      });
    });
    url=await Promise.race([endpoint,stopped.then(()=>{throw Error('启动已停止。');})]);
    const currentEnv=await readFile(envFile,'utf8').catch(()=>previousEnv);
    await writeFile(envFile,configurePublicUrl(currentEnv,url));configured=true;
    server=spawn(process.execPath,[resolve(root,'server.mjs')],{cwd:root,env:{...process.env,PUBLIC_URL:url,PORT:String(port)},windowsHide:true,stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',chunk=>process.stdout.write(chunk));server.stderr.on('data',chunk=>process.stderr.write(chunk));
    server.once('error',()=>stop());server.once('exit',()=>stop());
    let ready=false;
    for(let attempt=0;attempt<30;attempt++) {
      if(closing||server.exitCode!==null||connector.exitCode!==null)throw Error('服务已结束，请检查提示后重新启动。');
      if(await health(local) && await health(url,3000)){ready=true;break;}
      await Promise.race([wait(1000),stopped]);
    }
    if(!ready)throw Error('本机或公网检查未通过，请检查网络后重试。');
    await writeFile(resolve(root,'data/当前试玩网址.txt'),'临时公网试玩网址：\n'+url+'\n\n重开临时隧道后网址会变化，请分享新的网址。\n朋友注册需要你在“平台管理”创建的邀请码。\n电脑休眠、断网或停止服务期间无法访问。\n');
    console.log('\n临时试玩已启动：'+url);
    console.log('网址已保存到 data/当前试玩网址.txt。朋友需要邀请码才能注册。');
    console.log('保持此窗口运行和电脑不休眠。按回车停止；进行中的比赛不会结算。');
    if(openBrowser)openSite(url);
    if(process.stdin.isTTY){rl=createInterface({input:process.stdin,output:process.stdout});rl.once('line',()=>stop());}
    await stopped;
  } finally {
    clearTimeout(endpointTimeout);
    rl?.close();
    for(const child of [connector,server])if(child?.pid&&child.exitCode===null){const exited=once(child,'exit').catch(()=>{});child.kill();await Promise.race([exited,wait(5000)]);}
    log?.end();
    if(configured) {
      const current=await readFile(envFile,'utf8');
      if(current.match(/^PUBLIC_URL=(.*)$/m)?.[1]?.trim()===url) {
        // Only restore the setting owned by this run; preserve other edits to .env.
        const line='PUBLIC_URL='+previousUrl;
        await writeFile(envFile,current.replace(/^PUBLIC_URL=[^\r\n]*/m,line));
      }
    }
    process.removeListener('SIGINT',stopSignal);process.removeListener('SIGTERM',stopSignal);
    await unlink(lockFile);
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startQuickTunnel({openBrowser:!process.argv.includes('--no-open')}).catch(error=>{console.error(error.message);process.exitCode=1;});
