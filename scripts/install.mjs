import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const [major,minor]=process.versions.node.split('.').map(Number);
if(major<24||(major===24&&minor<4))throw Error('需要 Node.js 24.4 或更新版本。');
const npm=resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
await access(npm).catch(()=>{throw Error('当前Node安装未包含npm，请使用官方Node.js安装包。');});
const child=spawn(process.execPath,[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],{stdio:'inherit'});
const code=await new Promise((resolveCode,reject)=>{child.once('exit',resolveCode);child.once('error',reject);});
if(code)process.exitCode=code;
else{
 let initialized=false;
 try{const database=new DatabaseSync('data/arena.sqlite',{readOnly:true});try{initialized=!!database.prepare("SELECT id FROM users WHERE role='admin'").get();}finally{database.close();}}catch{}
 if(initialized)console.log('已有管理员，不覆盖账户和比赛资料。');
 else{const setup=spawn(process.execPath,['setup.mjs'],{stdio:'inherit'});process.exitCode=await new Promise((r,reject)=>{setup.once('exit',r);setup.once('error',reject);});}
}
