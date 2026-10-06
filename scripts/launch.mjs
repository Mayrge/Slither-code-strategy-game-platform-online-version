import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));

const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24||(major===24&&minor<4))throw Error('请安装 Node.js 24.4 或更新版本。');
await access(resolve(root,'node_modules/quickjs-emscripten/package.json')).catch(()=>{throw Error('请先双击“首次初始化.cmd”安装依赖。');});
await access(resolve(root,'data/arena.sqlite')).catch(()=>{throw Error('请先双击“首次初始化.cmd”创建管理员。');});
const port=Number(process.env.PORT||3082);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('PORT需要是1024～65535之间的端口。');
const local='http://127.0.0.1:'+port,site=process.env.PUBLIC_URL?new URL(process.env.PUBLIC_URL).origin:local;
function open(){if(process.platform==='win32'){const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',site],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();}}
async function health(){try{const response=await fetch(local+'/api/health',{signal:AbortSignal.timeout(1000)});const data=await response.json();return data.app==='snake-arena-online'&&data.initialized;}catch{return false;}}
if(await health()){console.log('竞技台已经在运行，已打开：'+site);open();}
else{
 const child=spawn(process.execPath,[resolve(root,'server.mjs')],{cwd:root,env:process.env,stdio:'inherit'});
 let opened=false;
 const timer=setInterval(async()=>{if(!opened&&await health()){opened=true;clearInterval(timer);open();console.log('关闭此窗口会停止服务。朋友访问期间请保持电脑开机。');}},1000);
 child.once('error',error=>{clearInterval(timer);console.error(error.message);process.exitCode=1;});
 child.once('exit',code=>{clearInterval(timer);process.exitCode=code||0;});
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
}
