import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.mjs';
import { bootstrap } from '../server/auth.mjs';
import { INITIAL_MODELS } from '../setup.mjs';

async function waitJob(app,id){
  const deadline=Date.now()+45000;
  while(Date.now()<deadline){const job=app.store.one('SELECT * FROM jobs WHERE id=?',id);if(!['queued','running'].includes(job.status)){assert.equal(job.status,'completed',job.error);return job;}await delay(30);}
  assert.fail('比赛队列未及时完成');
}
test('real 50-game settlement, replay deletion, cooldown, immutable history and restart recovery',{timeout:120000},async()=>{
  const folder=await mkdtemp(resolve(tmpdir(),'snake-online-test-')),database=resolve(folder,'arena.sqlite');let app;
  try{
    app=await createServer({database});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    await bootstrap(app.store,'Mayrge','TestOnlyPassword123');app.store.set('models',INITIAL_MODELS);
    const user=app.store.one('SELECT * FROM users WHERE username=?','Mayrge');
    // Use short, independently executed matches so this tests the production queue without slow AI searches.
    app.store.run('UPDATE players SET source=?','export default state=>state.snakes.find(s=>s.id===state.you).direction');
    const initial=app.arena.enqueue(user,{kind:'bootstrap'}).id;
    const first=await waitJob(app,initial);assert.equal(first.completed,50);assert.equal(first.applied,1);
    assert.equal(app.store.get('ranking').order.length,10);assert.equal(app.store.get('ranking').revision,1);
    const games=app.arena.gameList(user,initial);assert.equal(games.length,50);
    for(const game of games){assert.equal(game.results.length,10);assert.ok(game.results.every(p=>Number.isFinite(p.points)));}
    const replay=app.arena.replay(user,initial,1);assert.ok(replay.frames.length>1);
    const input={name:'Queue challenger',color:'#112233',model:INITIAL_MODELS[0],source:'export default state=>"down"'};
    const draft=await app.arena.saveDraft(user,input);await app.arena.register(user,draft.id);
    const ranked=app.arena.enqueue(user,{kind:'ranked',candidate:draft.id}).id;
    assert.throws(()=>app.arena.retire(user,draft.id),/比赛/);
    assert.throws(()=>app.arena.enqueue(user,{kind:'ranked',candidate:draft.id}),/排位任务/);
    const done=await waitJob(app,ranked);assert.equal(done.completed,50);assert.equal(done.applied,1);
    assert.equal(app.store.get('ranking').revision,2);assert.equal(app.store.get('ranking').history.length,2);
    assert.throws(()=>app.arena.enqueue(user,{kind:'ranked',candidate:draft.id}),/冷却/);
    const highlights=app.arena.highlights(user,draft.id);assert.ok(highlights.length>=3&&highlights.length<=5);
    assert.equal(new Set(highlights.map(g=>g.jobId+':'+g.round)).size,highlights.length);
    const before=app.store.get('ranking'),cooldown=app.store.one('SELECT cooldown FROM players WHERE id=?',draft.id).cooldown;
    app.arena.deleteJob(user,ranked);assert.equal(app.store.one('SELECT COUNT(*) n FROM games WHERE job_id=?',ranked).n,0);
    assert.deepEqual(app.store.get('ranking'),before);assert.equal(app.store.one('SELECT appearances FROM players WHERE id=?',draft.id).appearances,50);
    assert.throws(()=>app.arena.replay(user,ranked,1),/无权/);
    await app.close();app=null;
    app=await createServer({database,workers:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    assert.deepEqual(app.store.get('ranking'),before);assert.equal(app.store.one('SELECT cooldown FROM players WHERE id=?',draft.id).cooldown,cooldown);
    app.store.run("UPDATE jobs SET status='running' WHERE id=?",initial);
    await app.close();app=null;
    app=await createServer({database,workers:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
    assert.equal(app.store.one('SELECT status FROM jobs WHERE id=?',initial).status,'failed');assert.deepEqual(app.store.get('ranking'),before);
  }finally{
    if(app)await app.close();
    const parent=resolve(tmpdir());assert.ok(resolve(folder).startsWith(parent+sep));await rm(folder,{recursive:true,force:true});
  }
});

test('an account without players can visualize system and other registered players without changing ranked records',{timeout:60000},async()=>{
  const app=await createServer({database:':memory:'});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    await bootstrap(app.store,'FixtureAdmin','TestOnlyPassword123');app.store.set('models',INITIAL_MODELS);
    const admin=app.store.one('SELECT * FROM users WHERE username=?','FixtureAdmin'),viewerId=randomUUID();
    app.store.run('INSERT INTO users(id,username,nickname,password,role,created_at) VALUES(?,?,?,?,?,?)',viewerId,'ViewerOnly','ViewerOnly',admin.password,'user',Date.now());
    const viewer=app.store.one('SELECT * FROM users WHERE id=?',viewerId);
    assert.equal(app.store.one('SELECT COUNT(*) n FROM players WHERE owner=?',viewerId).n,0);
    // The fixture alone uses fast strategies; shipped strategies and real data are untouched.
    app.store.run('UPDATE players SET source=?','export default state=>state.snakes.find(s=>s.id===state.you).direction');
    await waitJob(app,app.arena.enqueue(admin,{kind:'bootstrap'}).id);
    const draftInput={name:'Private draft',color:'#112233',model:INITIAL_MODELS[0],source:'export default ()=>"down"'};
    const privateDraft=await app.arena.saveDraft(admin,draftInput);
    const registered=await app.arena.saveDraft(admin,{...draftInput,name:'Public registered'});await app.arena.register(admin,registered.id);
    const before=app.store.get('ranking'),stats=app.store.all('SELECT id,average,appearances,cooldown FROM players ORDER BY id');
    const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'ViewerOnly',password:'TestOnlyPassword123'})});
    assert.equal(login.status,200);
    const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    const request=async(path,data)=>fetch(base+'/api'+path,{method:data?'POST':'GET',headers:{Cookie:cookie,...(data?{Origin:base,'Content-Type':'application/json','X-CSRF-Token':session.csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
    for(const candidate of [1,registered.id]){
      const response=await request('/jobs',{kind:'practice',candidate,opponents:[2],count:1});assert.equal(response.status,201);
      const job=await waitJob(app,(await response.json()).id);assert.equal(job.applied,0);assert.equal(job.completed,1);
      const replayResponse=await request('/jobs/'+job.id+'/replay/1');assert.equal(replayResponse.status,200);
      const replay=await replayResponse.json();assert.ok(replay.frames.length>1);assert.equal(replay.frames[0].snakes.length,2);
      assert.deepEqual(app.store.get('ranking'),before);assert.deepEqual(app.store.all('SELECT id,average,appearances,cooldown FROM players ORDER BY id'),stats);
    }
    assert.equal((await request('/players/'+registered.id+'/source')).status,403);
    const publicPlayers=await (await request('/players?all=1')).json();
    assert.ok(publicPlayers.every(p=>!('source' in p)));assert.ok(!publicPlayers.some(p=>p.id===privateDraft.id));
    for(const data of [
      {candidate:privateDraft.id,opponents:[1]},
      {candidate:1,opponents:[privateDraft.id]},
      {candidate:1,opponents:[1]},
      {candidate:1,opponents:[2,2]},
      {candidate:1,opponents:[]},
      {candidate:1,opponents:Array.from({length:10},(_,i)=>i+2)}
    ])assert.equal((await request('/jobs',{kind:'practice',count:1,...data})).status,400);
    assert.equal((await request('/jobs',{kind:'ranked',candidate:registered.id})).status,400);
    assert.equal((await request('/jobs',{kind:'ranked',candidate:1})).status,400);
    await app.arena.retire(admin,registered.id);
    assert.equal((await request('/jobs',{kind:'practice',candidate:registered.id,opponents:[1],count:1})).status,400);
    assert.equal(app.store.one('SELECT COUNT(*) n FROM players WHERE owner=?',viewerId).n,0);
  }finally{await app.close();}
});
