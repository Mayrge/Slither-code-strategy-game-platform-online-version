import { Worker,isMainThread,parentPort,workerData } from 'node:worker_threads';
import { validateStrategy } from './sandbox.mjs';

// Registration must never execute submitted code on the HTTP server's event loop.
export function validateInWorker(source) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./validation-worker.mjs',import.meta.url),{workerData:source,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64}});
    let finished=false;
    const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);void worker.terminate();error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error('初始化超时')),1500);
    worker.once('message',message=>finish(message.ok?null:new Error('代码加载失败')));
    worker.once('error',()=>finish(new Error('执行环境异常')));
    worker.once('exit',()=>finish(new Error('执行环境退出')));
  });
}
if(!isMainThread) {
  try {await validateStrategy(workerData);parentPort.postMessage({ok:true});}
  catch {parentPort.postMessage({ok:false});}
}
