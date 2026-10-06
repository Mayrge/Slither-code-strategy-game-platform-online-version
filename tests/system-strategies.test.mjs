import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { AgentArena } from '../agent-sandbox/environment.mjs';
test('shipped system strategies make valid decisions in the restricted interpreter',async()=>{
 const files=(await readdir(new URL('../server/system-strategies/',import.meta.url))).filter(f=>f.endsWith('.js')).sort();
 const players=await Promise.all(files.map(async(f,i)=>({id:i+1,name:f,color:'#aabbcc',source:await readFile(new URL('../server/system-strategies/'+f,import.meta.url),'utf8')})));
 const arena=await new AgentArena(players,{seed:'SYSTEM-COMPATIBILITY'}).initialize();
 try{for(let i=0;i<20&&!arena.game.done;i++)arena.step();assert.ok(arena.game.turn>=10);assert.ok(arena.game.snakes.every(s=>!String(s.deathReason).includes('超时')&&!String(s.deathReason).includes('策略异常')));}
 finally{arena.close();}
});
