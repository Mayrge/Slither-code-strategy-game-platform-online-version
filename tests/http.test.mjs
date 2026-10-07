import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';
import { bootstrap } from '../server/auth.mjs';
import { INITIAL_MODELS } from '../setup.mjs';
const PASSWORD='CorrectHorse12345';
test('invite registration, ownership, admin review, CSRF, immutable players and message deletion',async()=>{
  const app=await createServer({database:':memory:',workers:false});await bootstrap(app.store,'Mayrge',PASSWORD);app.store.set('models',INITIAL_MODELS);
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
  const request=async(path,{method='GET',data,session,origin=base}={})=>{
    const response=await fetch(base+'/api'+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:origin}:{}),...(session?{Cookie:session.cookie,'X-CSRF-Token':session.csrf}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const result=await response.json();return {status:response.status,result,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async name=>{const result=await request('/login',{method:'POST',data:{username:name,password:PASSWORD}});assert.equal(result.status,200);return {cookie:result.cookie,csrf:result.result.csrf};};
  try{
    assert.equal((await request('/players')).status,401);
    const admin=await login('Mayrge');const made=await request('/admin/invites',{method:'POST',session:admin,data:{label:'friends',maxUses:2}});assert.equal(made.status,201);
    for(const username of ['friendA','friendB']){const result=await request('/register',{method:'POST',data:{username,password:PASSWORD,invite:made.result.code,consent:true}});assert.equal(result.status,201);}
    assert.equal((await request('/register',{method:'POST',data:{username:'friendC',password:PASSWORD,invite:made.result.code,consent:true}})).status,400);
    const a=await login('friendA'),b=await login('friendB');
    assert.equal((await request('/me',{session:a})).result.user.guideDisabled,false);
    assert.equal((await request('/account',{method:'POST',session:a,data:{nickname:'friendA',guideDisabled:true}})).status,200);
    const aNew=await login('friendA');assert.equal((await request('/me',{session:aNew})).result.user.guideDisabled,true);
    assert.equal((await request('/me',{session:b})).result.user.guideDisabled,false);
    assert.equal((await request('/account',{method:'POST',session:a,data:{nickname:'Should not save',guideDisabled:'false'}})).status,400);
    assert.equal((await request('/me',{session:a})).result.user.nickname,'friendA');
    assert.equal((await request('/account',{method:'POST',session:a,data:{nickname:'friendA',guideDisabled:false}})).status,200);
    const source='export default function(){return "down"}',input={name:'Alpha',color:'#aabbcc',model:INITIAL_MODELS[0],source};
    const draft=await request('/players',{method:'POST',data:input,session:a});assert.equal(draft.status,201);const id=draft.result.id;
    const otherList=await request('/players?all=1',{session:b});assert.ok(!otherList.result.some(p=>p.id===id));
    assert.equal((await request('/players/'+id+'/source',{session:b})).status,403);assert.equal((await request('/players/'+id+'/source',{session:admin})).result.source,source);
    assert.equal((await request('/players/'+id+'/register',{method:'POST',session:a})).status,200);
    assert.equal((await request('/players/'+id,{method:'PUT',session:a,data:{...input,name:'changed'}})).status,403);
    const publicList=await request('/players?all=1',{session:b});assert.ok(publicList.result.some(p=>p.id===id));assert.ok(publicList.result.every(p=>!('source'in p)));
    assert.equal((await request('/players/'+id+'/retire',{method:'POST',session:a})).status,200);
    const duplicate=await request('/players',{method:'POST',session:a,data:{...input,name:'Beta'}});assert.equal((await request('/players/'+duplicate.result.id+'/register',{method:'POST',session:a})).status,400);
    assert.equal((await request('/admin/invites',{session:b})).status,403);
    assert.equal((await request('/messages',{method:'POST',session:a,data:{body:'<script>alert(1)</script>'},origin:'https://evil.example'})).status,403);
    assert.equal((await request('/messages',{method:'POST',session:a,data:{body:'Hello'}})).status,201);
    const messages=await request('/messages',{session:b});assert.equal(messages.result[0].body,'Hello');const messageId=messages.result[0].id;
    assert.equal((await request('/messages/'+messageId,{method:'DELETE',session:b})).status,403);assert.equal((await request('/messages/'+messageId,{method:'DELETE',session:admin})).status,200);
    const users=await request('/admin/users',{session:admin});assert.equal(users.result.find(u=>u.username==='friendA').source,'friends');
    const custom=await request('/players',{method:'POST',session:b,data:{...input,name:'Custom',model:'其他 / 自填：手工测试'}});assert.equal(custom.status,201);
    assert.equal((await request('/players',{method:'POST',session:b,data:{...input,model:'其他 / 其他（必填填空）'}})).status,400);
    const bSecond=await login('friendB');
    assert.equal((await request('/account',{method:'POST',session:b,data:{nickname:'Friend B',password:PASSWORD,newPassword:'UpdatedTestPassword123'}})).status,200);
    assert.equal((await request('/me',{session:bSecond})).status,401);assert.equal((await request('/me',{session:b})).result.user.nickname,'Friend B');
    const bannedId=users.result.find(u=>u.username==='friendB').id;
    assert.equal((await request('/admin/users/'+bannedId,{method:'PUT',session:admin,data:{banned:true}})).status,200);
    assert.equal((await request('/me',{session:b})).status,401);
    for(const path of ['/server/system-strategies/01-lime.js','/data/arena.sqlite','/setup.mjs','/../server/auth.mjs'])assert.equal((await fetch(base+path)).status,404);
    const kit=await fetch(base+'/api/agent-kit',{headers:{Cookie:a.cookie}});assert.equal(kit.status,200);assert.equal(kit.headers.get('content-type'),'application/zip');
  }finally{await app.close();}
});
