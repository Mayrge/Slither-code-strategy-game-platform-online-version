import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseOpponents,settleRanking,scheduleJob,emptyRanking } from '../server/ranking.mjs';
test('system matchmaking excludes same-owner rivals and uses at most one per account',()=>{
  const players=Array.from({length:30},(_,i)=>({id:i+1,owner:'U'+Math.floor(i/3),status:'registered',system:false}));
  const state={...emptyRanking(),order:players.map(p=>p.id)};
  const roster=chooseOpponents(state,players,players[0]);assert.equal(roster.length,10);assert.equal(new Set(roster.map(p=>p.owner)).size,10);assert.ok(!roster.some(p=>p.id===2||p.id===3));
});
test('50 games balance ten spawn positions and retain the shared seed within each cycle',()=>{
  const players=Array.from({length:10},(_,i)=>({id:i+1}));const schedule=scheduleJob(players,50,'FAIR');
  assert.equal(schedule.length,50);for(let i=0;i<50;i+=10){assert.equal(new Set(schedule.slice(i,i+10).map(r=>r.seed)).size,1);assert.equal(new Set(schedule.slice(i,i+10).map(r=>r.rotation)).size,10);}
});
test('strong newcomers can enter first; overflow retires the last, and scores do not accumulate by repetition',()=>{
  const state={...emptyRanking(),order:Array.from({length:30},(_,i)=>i+1)};
  const members=[31,1,5,9,13,17,21,25,28,30];const games=Array.from({length:50},()=>({results:members.map((id,i)=>({id,points:100-i*10,score:100-i}))}));
  const result=settleRanking(state,{revision:0,candidate:31,members,kind:'ranked'},games);
  assert.equal(result.ranking.order[0],31);assert.equal(result.ranking.order.length,30);assert.equal(result.retired,30);assert.equal(result.averages[31].average,100);
  assert.throws(()=>settleRanking(result.ranking,{revision:0,candidate:31,members,kind:'ranked'},games));assert.throws(()=>settleRanking(state,{revision:0,candidate:31,members,kind:'ranked'},games.slice(1)));
});
