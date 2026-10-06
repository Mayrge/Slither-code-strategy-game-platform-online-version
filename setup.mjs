import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './server/database.mjs';
import { bootstrap } from './server/auth.mjs';
import { ArenaService } from './server/service.mjs';
const root=fileURLToPath(new URL('./',import.meta.url));
export const MODEL_GROUPS={
  DeepSeek:['V4 Pro','V4.1 Flash','不知道'],
  Kimi:['K3','K2.7 Code','K2.6','不知道'],
  GPT:['GPT-6 Astra','GPT-6.1 Sol','GPT-6 Sol','GPT-6 Luna','GPT-5.6 Sol','GPT-5.6 Luna','不知道'],
  Claude:['Opus 5.5','Sonnet 5.5','Fable 5.1','Haiku 4.5','不知道'],
  Gemini:['Gemini 4 Argon','Gemini 3.8 Flash','Gemini 3.8 Live','Gemini 3.8 Flash-Lite','Gemini 3.5 Flash-Lite','不知道'],
  Qwen:['Qwen3.8-Flash','Qwen3.8','Qwen3.7-Max','Qwen3.6-Plus','Qwen3-Max','不知道'],
  GLM:['GLM-5.3','GLM-5.3-Flash','GLM-5.3-FlashX','GLM-5.2','不知道'],
  '豆包':['Seed-2.1-Pro','Seed-2.0-Pro','Seed-Evolving','不知道'],
  '文心一言':['ERNIE 5.1','ERNIE 5.0','ERNIE 4.0 Turbo','不知道'],
  '其他':['自己独立完成','多模型','其他（必填填空）']
};
export const INITIAL_MODELS=Object.entries(MODEL_GROUPS).flatMap(([brand,values])=>values.map(value=>brand+' / '+value));
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const store=new Store(resolve(root,'data/arena.sqlite'));
  try {
    const username=process.argv[2]||'Mayrge',password=randomBytes(18).toString('base64url');
    const id=await bootstrap(store,username,password);store.set('models',INITIAL_MODELS);
    const arena=new ArenaService(store,{startWorkers:false});await arena.seedSystems();
    await mkdir(resolve(root,'data'),{recursive:true});
    await writeFile(resolve(root,'data/管理员首次登录.txt'),`本机私有资料，请勿上传或分享\n网址：http://127.0.0.1:3082\n用户名：${username}\n初始密码：${password}\n首次登录后在账户设置修改密码。\n`,{flag:'wx',mode:0o600});
    console.log(`管理员 ${username} 已创建。密码保存在 data/管理员首次登录.txt。`);
    console.log('启动后在平台管理中创建邀请码，并点击“系统选手初始定榜”。');
  } finally {store.close();}
}
