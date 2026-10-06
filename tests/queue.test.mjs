import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
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
