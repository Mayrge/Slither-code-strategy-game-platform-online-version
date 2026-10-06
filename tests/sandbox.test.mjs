import test from 'node:test';
import assert from 'node:assert/strict';
import { StrategyVM,validateStrategy } from '../server/sandbox.mjs';
import { AgentArena } from '../agent-sandbox/environment.mjs';
test('ES modules and per-game memory work without exposing Node, network or files',async()=>{
  const source=`let n=0;export default function(){if(typeof process!=='undefined'||typeof fetch!=='undefined'||typeof require!=='undefined')throw Error('host leaked');return ++n%2?'down':'right'}`;
  const a=await StrategyVM.create(source,'A'),b=await StrategyVM.create(source,'A');
  try{assert.equal(a.decide({}).direction,'down');assert.equal(a.decide({}).direction,'right');assert.equal(b.decide({}).direction,'down');}finally{a.dispose();b.dispose();}
  await assert.rejects(validateStrategy(`import fs from 'node:fs';export default function(){return 'down'}`));
  await assert.rejects(validateStrategy('while(true){};export default ()=>"down"'));
  await assert.rejects(validateStrategy('export const unused=1'));
});
test('infinite decisions, async output and excessive memory terminate safely',async()=>{
  for(const source of ['export default function(){while(true){}}','export default async function(){return "down"}','export default function(){let xs=[];while(true)xs.push(new Array(100000).fill(1))}']){
    const vm=await StrategyVM.create(source,'A');try{const start=performance.now();assert.ok(vm.decide({}).error);assert.ok(performance.now()-start<5000);}finally{vm.dispose();}
  }
});
test('training state, turn records and replay use the same referee',async()=>{
  const source='export default function(state){return state.snakes.find(s=>s.id===state.you).direction}';
  const arena=await new AgentArena([{id:1,name:'one',color:'#aabbcc',source},{id:2,name:'two',color:'#bbccdd',source}],{seed:'TEST'}).initialize();
  try{assert.equal(arena.record().turn,0);assert.equal(arena.observation().you,1);while(!arena.game.done)arena.step();assert.equal(arena.replay().frames.length,arena.game.turn+1);assert.equal(arena.record().results.length,2);}finally{arena.close();}
});
