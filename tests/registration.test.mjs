import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/database.mjs';
import { ArenaService } from '../server/service.mjs';
import { bootstrap } from '../server/auth.mjs';
import { INITIAL_MODELS } from '../setup.mjs';
test('five active and rolling registrations are independent; retirement never refunds the rolling quota',async()=>{
 const store=new Store(':memory:'),arena=new ArenaService(store,{startWorkers:false});
 try{
  await bootstrap(store,'TestAdmin','FixturePassword123');store.set('models',INITIAL_MODELS);const user=store.one('SELECT * FROM users');
  const ids=[];
  for(let i=0;i<6;i++){
   const draft=await arena.saveDraft(user,{name:'Player '+i,color:'#aabbcc',model:INITIAL_MODELS[0],source:`// strategy ${i}\nexport default ()=>"down"`});ids.push(draft.id);
   if(i<5)await arena.register(user,draft.id);
  }
  await assert.rejects(arena.register(user,ids[5]),/同时/);
  arena.retire(user,ids[0]);await assert.rejects(arena.register(user,ids[5]),/每连续12小时/);
  store.run('UPDATE players SET registered_at=? WHERE registered_at IS NOT NULL',Date.now()-13*3600000);
  await arena.register(user,ids[5]);assert.equal(store.one("SELECT COUNT(*) n FROM players WHERE status='registered'").n,5);
  assert.equal(store.one('SELECT status FROM players WHERE id=?',ids[0]).status,'retired');
 }finally{await arena.close();store.close();}
});
