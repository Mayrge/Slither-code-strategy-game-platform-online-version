import { readFile,mkdir,writeFile,access } from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { resolve,basename,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AgentArena } from './environment.mjs';
import { makeSchedule } from '../public/core/tournament.js';
export function argsOf(values){const out={};for(let i=0;i<values.length;i++){if(!values[i].startsWith('--'))throw Error('参数需要使用--名称');const key=values[i].slice(2);out[key]=values[i+1]&&!values[i+1].startsWith('--')?values[++i]:true;}return out;}
async function loadPlayers(args){
  if(typeof args.strategy!=='string')throw Error('必须提供--strategy');
  let baseline=fileURLToPath(new URL('../opponents/amber.js',import.meta.url));
  if(args.opponents===undefined)try{await access(baseline);}catch{baseline=fileURLToPath(new URL('../server/system-strategies/05-amber.js',import.meta.url));}
  const opponents=args.opponents??baseline;
  if(typeof opponents!=='string')throw Error('--opponents需要对手文件路径，多份用逗号分隔');
  const paths=[args.strategy,...opponents.split(',')];if(paths.length<2||paths.length>10)throw Error('需要自己和1～9名对手');
  const colors=['#c4f786','#7ac9ff','#fb897d','#c0a1ff','#ffd56b','#5cdec5','#fc91c9','#f3a960','#8da6ff','#d5e8e3'];
  return Promise.all(paths.map(async(path,i)=>{const source=await readFile(resolve(path),'utf8');if(Buffer.byteLength(source)>100000)throw Error('策略超过100KB');return {id:i+1,name:basename(path).slice(0,24),color:colors[i],source};}));
}
async function validateMap(path){if(!path)return;const map=JSON.parse(await readFile(resolve(path),'utf8'));if(map.width!==30||map.height!==30||map.maxTurns!==500||(map.food?.length)||(map.snakes?.length)||(map.walls?.length))throw Error('请使用30×30、500回合的空白地图');}
async function writeLine(stream,data){if(!stream.write(JSON.stringify(data)+'\n'))await once(stream,'drain');}
export async function main(command,args){
  if(command==='inspect'){
    if(!args.trace)throw Error('需要--trace');
    const input=createReadStream(resolve(args.trace));const lines=createInterface({input,crlfDelay:Infinity});
    try{for await(const line of lines){const record=JSON.parse(line);if(record.game===Number(args.game||1)&&record.turn===Number(args.turn||0)){console.log(JSON.stringify(record));return;}}throw Error('未找到回合；全部死亡会提前结束');}finally{lines.close();input.destroy();}
  }
  const players=await loadPlayers(args);await validateMap(args.map);const seed=String(args.seed||randomUUID());
  if(command==='serve'){
    let arena=await new AgentArena(players,{seed}).initialize();console.log(JSON.stringify({type:'ready',record:arena.record(),observation:arena.observation()}));
    const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
    try{for await(const line of lines){try{const input=JSON.parse(line);if(input.command==='observe')console.log(JSON.stringify(arena.observation(input.player||1)));else if(input.command==='step')console.log(JSON.stringify(arena.step(input.actions)));else if(input.command==='run'){while(!arena.game.done)console.log(JSON.stringify(arena.step()));}else if(input.command==='reset'){arena.close();arena=await new AgentArena(players,{seed:input.seed||seed}).initialize();console.log(JSON.stringify(arena.record()));}else if(input.command==='close'){console.log(JSON.stringify({closed:true}));break;}else throw Error('支持observe、step、run、reset、close');}catch(e){console.log(JSON.stringify({error:e.message}));}}}finally{arena.close();lines.close();}return;
  }
  if(command!=='run')throw Error('支持run、inspect、serve');
  const requested=Number(args.games||10);if(!Number.isInteger(requested)||requested<1||requested>1000)throw Error('局数需要1～1000');
  const count=Math.ceil(requested/players.length)*players.length;if(count>1000)throw Error('完整位置轮换后超过1000局');
  const folder=resolve(args.out||'runs/'+randomUUID());await mkdir(dirname(folder),{recursive:true});await mkdir(folder,{recursive:false});
  if(args.replays)await mkdir(resolve(folder,'replays'));
  const stream=createWriteStream(resolve(folder,'trace.jsonl'),{flags:'wx'});const games=[];let streamError;
  stream.on('error',e=>{streamError=e;});
  try{for(const round of makeSchedule(players,count,seed)){
    const arena=await new AgentArena(round.order.map(id=>players.find(p=>p.id===id)),{seed:round.seed,rotation:round.rotation,recordReplay:!!args.replays}).initialize();
    try{await writeLine(stream,arena.record(round.round));while(!arena.game.done){const record=arena.step();record.game=round.round;await writeLine(stream,record);if(streamError)throw streamError;}games.push({round:round.round,seed:round.seed,results:arena.record().results});if(args.replays)await writeFile(resolve(folder,'replays/game-'+round.round+'.json'),JSON.stringify(arena.replay()));}finally{arena.close();}
  }}finally{stream.end();await once(stream,'close');}
  const stats=players.map(p=>{const results=games.map(g=>g.results.find(r=>r.id===p.id));return {id:p.id,name:p.name,averageScore:results.reduce((s,r)=>s+r.score,0)/count,averagePoints:results.reduce((s,r)=>s+r.points,0)/count,wins:results.filter(r=>r.rank===1).length};});
  const summary={ranked:false,seed,requested,total:count,trace:resolve(folder,'trace.jsonl'),stats,games};await writeFile(resolve(folder,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{await main(process.argv[2],argsOf(process.argv.slice(3)));}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}}
