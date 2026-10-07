import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,sep } from 'node:path';
import { Store } from '../server/database.mjs';
import { ArenaService } from '../server/service.mjs';
import { LiveBuffer } from '../server/live-buffer.mjs';
import { Worker } from 'node:worker_threads';

test('old database migrates peaks from retained history and preserves first achievement',async()=>{
 const folder=await mkdtemp(resolve(tmpdir(),'arena-peak-')),path=resolve(folder,'test.sqlite');let store;
 try{
  store=new Store(path);
  store.run("INSERT INTO users(id,username,nickname,password,role,created_at) VALUES('u','Tester','Tester','unused','user',1)");
  for(const id of [1,2,3])store.run("INSERT INTO players(id,owner,name,color,model,source,status,created_at,registered_at) VALUES(?,'u',?,'#112233','test','private','registered',1,1)",id,'P'+id);
  store.set('ranking',{revision:3,order:[2,1],history:[{at:300,after:[2,1]},{at:200,after:[2,1,3]},{at:100,after:[1,2,3]}]});
  store.close();store=null;
  const old=new DatabaseSync(path);old.exec('ALTER TABLE users DROP COLUMN guide_disabled; ALTER TABLE players DROP COLUMN best_rank; ALTER TABLE players DROP COLUMN best_rank_at;');old.prepare('DELETE FROM settings WHERE key=?').run('peak-rank-migrated');old.close();
  store=new Store(path);
  assert.deepEqual(store.all('SELECT id,best_rank,best_rank_at FROM players').map(r=>({...r})),[{id:1,best_rank:1,best_rank_at:100},{id:2,best_rank:1,best_rank_at:200},{id:3,best_rank:3,best_rank_at:100}]);
  assert.equal(store.one('SELECT guide_disabled FROM users').guide_disabled,0);
  store.run("INSERT INTO players(id,owner,name,color,model,source,status,created_at,registered_at) VALUES(4,'u','P4','#112233','test','private','registered',1,1)");
  const ranking=store.get('ranking');ranking.order=[2,4,1];store.set('ranking',ranking);store.recordPeaks(ranking.order,350);
  const arena=new ArenaService(store,{startWorkers:false});arena.retire({id:'u',role:'user'},2);
  assert.equal(store.one('SELECT best_rank FROM players WHERE id=4').best_rank,1);
  assert.equal(store.one('SELECT best_rank_at FROM players WHERE id=4').best_rank_at,store.get('ranking').history[0].at);
  assert.equal(store.one('SELECT best_rank_at FROM players WHERE id=2').best_rank_at,200);
  store.recordPeaks([3,1],400);store.recordPeaks([3,1],500);
  assert.deepEqual({...store.one('SELECT best_rank,best_rank_at FROM players WHERE id=3')},{best_rank:1,best_rank_at:400});
  store.close();store=new Store(path);assert.equal(store.one('SELECT best_rank_at FROM players WHERE id=3').best_rank_at,400);
 }finally{store?.close();assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep));await rm(folder,{recursive:true,force:true});}
});
test('worker sends every turn in order and live frames exactly match the saved replay',async()=>{
 const players=[1,2].map(id=>({id,name:'Test'+id,color:'#112233',source:'export default s=>["right","down","left","up"][s.turn%4]'}));
 const worker=new Worker(new URL('../server/match-worker.mjs',import.meta.url),{workerData:{players,schedule:[{round:1,order:[1,2],seed:'live-test',rotation:0}]},execArgv:[]});
 const frames=[];let replay;
 try{await new Promise((resolve,reject)=>{worker.on('error',reject);worker.on('message',m=>{if(m.type==='frames')frames.push(...m.frames);if(m.type==='game')replay=m.replay;if(m.type==='failed')reject(Error(m.error));if(m.type==='done')resolve();});worker.on('exit',code=>{if(code)reject(Error('Worker failed'));});});
  assert.ok(frames.length>10);assert.deepEqual(frames,replay.frames);assert.deepEqual(frames.map(f=>f.turn),Array.from({length:frames.length},(_,i)=>i));
 }finally{await worker.terminate();}
});
test('live frames are bounded, incremental, ordered across rounds, and private',()=>{
 const buffer=new LiveBuffer(120),config={width:30,height:30};
 buffer.push(1,Array.from({length:150},(_,turn)=>({turn})),config);
 assert.equal(buffer.frames.length,120);const first=buffer.since(0);assert.equal(first.frames.length,60);assert.equal(first.frames[0].seq,31);
 const second=buffer.since(first.sequence);assert.equal(second.frames.length,60);assert.equal(second.sequence,150);assert.equal(buffer.since(150).frames.length,0);
 buffer.push(2,[{turn:0},{turn:1}],config);assert.deepEqual(buffer.since(150).frames.map(f=>[f.round,f.frame.turn]),[[2,0],[2,1]]);
 const store=new Store(':memory:');try{
  store.run("INSERT INTO users(id,username,nickname,password,role,created_at) VALUES('u','User','User','unused','user',1)");
  store.run("INSERT INTO jobs(id,owner,kind,status,total,seed,roster,created_at) VALUES('job','u','practice','running',1,'seed','[]',1)");
  const arena=new ArenaService(store,{startWorkers:false});store.run("UPDATE jobs SET status='running'");arena.current={id:'job',buffer};
  assert.throws(()=>arena.live({id:'other',role:'user'},'job'),/无权/);assert.throws(()=>arena.live({id:'u'},'job',-1),/序号/);
  assert.equal(arena.live({id:'u'},'job',150).frames.length,2);
  assert.equal(JSON.stringify(arena.live({id:'u'},'job')).includes('source'),false);
  arena.current=null;store.run("UPDATE jobs SET status='completed',completed=1");assert.equal(arena.live({id:'u'},'job').status,'completed');
 }finally{store.close();}
});
