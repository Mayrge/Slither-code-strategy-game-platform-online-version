import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../server.mjs';
import {Store} from '../server/database.mjs';
import {bootstrap,openSession,digest} from '../server/auth.mjs';
import {ArenaService} from '../server/service.mjs';

test('personal invites preserve lifetime quota, record ancestry, and pause when ineligible',async()=>{
  const app=await createServer({database:':memory:',workers:false});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port,s=app.store;
  const adminId=await bootstrap(s,'AdminTest','TestPasswordOnly123');
  const add=(username,invite=null)=>{const id=randomUUID();s.run('INSERT INTO users(id,username,nickname,password,role,invite_id,created_at) VALUES(?,?,?,?,?,?,?)',id,username,username,'unused','user',invite,Date.now());return id;};
  const session=id=>{const r=openSession(s,id);return {cookie:'arena_session='+r.secret,csrf:r.csrf};};
  const admin=session(adminId),root=randomUUID();s.run('INSERT INTO invites(id,code,label,max_uses,created_at) VALUES(?,?,?,?,?)',root,'ROOTTEST','Friends',50,1);
  const aId=add('InviteA',root),a=session(aId),bId=add('InviteB'),b=session(bId);
  const player=(owner,name)=>Number(s.run("INSERT INTO players(owner,name,color,model,source,status,created_at,registered_at) VALUES(?,?,'#123456','test','secret','registered',1,1)",owner,name).lastInsertRowid);
  const request=async(path,method='GET',data,who=a)=>{
    const r=await fetch(base+'/api'+path,{method,headers:{Origin:base,Cookie:who.cookie,'X-CSRF-Token':who.csrf,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};
  };
  const signup=async(username,code)=>request('/register','POST',{username,password:'TestPasswordOnly123',invite:code,consent:true});
  try {
    assert.equal((await request('/personal-invite','POST',{})).status,400);
    const p=player(aId,'InviteActive');
    const made=(await request('/personal-invite','POST',{})).data;assert.equal(made.limit,5);assert.equal(made.used,0);
    assert.equal((await request('/personal-invite','POST',{})).data.invite.code,made.invite.code);
    assert.equal((await signup('ChildOne',made.invite.code)).status,201);
    const child=s.one("SELECT id FROM users WHERE username='ChildOne'");player(child.id,'ChildActive');
    const childSession=session(child.id),childCode=(await request('/personal-invite','POST',{},childSession)).data.invite.code;
    assert.equal((await signup('Grandchild',childCode)).status,201);
    const accounts=(await request('/admin/users','GET',undefined,admin)).data;
    const grand=accounts.find(u=>u.username==='Grandchild');assert.equal(grand.source,'Friends');assert.equal(grand.inviter,'ChildOne');assert.equal(grand.chain,'InviteA → ChildOne → Grandchild');
    assert.equal((await request('/admin/users','GET',undefined,b)).status,403);
    const rotated=(await request('/personal-invite','POST',{rotate:true})).data;
    assert.equal(rotated.used,1);assert.equal(rotated.remaining,4);assert.notEqual(rotated.invite.code,made.invite.code);
    assert.equal((await signup('OldCodeUser',made.invite.code)).status,400);
    assert.equal((await request('/admin/invites/'+made.invite.id,'PUT',{enabled:true},admin)).status,400);
    assert.equal((await request('/admin/users/'+aId+'/invite-limit','PUT',{limit:2},admin)).status,200);
    assert.equal((await signup('ChildTwo',rotated.invite.code)).status,201);
    assert.equal((await signup('ChildThree',rotated.invite.code)).status,400);
    assert.equal((await request('/personal-invite','POST',{rotate:true})).status,400);
    assert.equal((await request('/admin/users/'+aId+'/invite-limit','PUT',{limit:5},admin)).status,200);
    s.run("UPDATE players SET status='retired' WHERE id=?",p);
    assert.equal((await signup('NoActive',rotated.invite.code)).status,400);
    assert.equal((await request('/personal-invite')).data.eligible,false);
    s.run("UPDATE players SET status='registered' WHERE id=?",p);
    assert.equal((await request('/admin/invites/'+rotated.invite.id,'PUT',{enabled:false},admin)).status,200);
    assert.equal((await request('/personal-invite','POST',{rotate:true})).status,400);
    assert.equal((await signup('Disabled',rotated.invite.code)).status,400);
    assert.equal((await request('/admin/invites/'+rotated.invite.id,'PUT',{enabled:true},admin)).status,200);
    s.run('UPDATE users SET banned=1 WHERE id=?',aId);
    assert.equal((await signup('BannedOwner',rotated.invite.code)).status,400);
  }finally {await app.close();}
});

test('private conversation authorization, unread receipts, announcement permissions and cross-device settings',async()=>{
  const app=await createServer({database:':memory:',workers:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const s=app.store,base='http://127.0.0.1:'+app.server.address().port;
  const adminId=await bootstrap(s,'AdminTest','TestPasswordOnly123');
  const add=name=>{const id=randomUUID();s.run('INSERT INTO users(id,username,nickname,password,role,created_at) VALUES(?,?,?,?,?,?)',id,name,name,'unused','user',1);return id;};
  const aId=add('SenderA'),bId=add('SenderB');const session=id=>{const v=openSession(s,id);return {cookie:'arena_session='+v.secret,csrf:v.csrf};};const a=session(aId),b=session(bId),admin=session(adminId);
  const request=async(path,method='GET',data,who=a,origin=base)=>{const r=await fetch(base+'/api'+path,{method,headers:{Origin:origin,Cookie:who.cookie,'X-CSRF-Token':who.csrf,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};};
  try {
    assert.equal((await request('/private-messages','POST',{body:'<script>private test</script>'})).status,200);
    assert.equal((await request('/private-messages','POST',{body:'rate limit'})).status,429);
    assert.deepEqual((await request('/private-messages','GET',undefined,b)).data,[]);
    assert.equal((await request('/admin/private-messages/'+aId,'GET',undefined,b)).status,403);
    assert.equal((await request('/admin/private-messages/'+aId,'POST',{body:'intruder'},b)).status,403);
    assert.equal((await request('/admin/private-messages','GET',undefined,admin)).data[0].unread,1);
    await request('/admin/private-messages/'+aId,'GET',undefined,admin);
    assert.equal((await request('/admin/private-messages','GET',undefined,admin)).data[0].unread,0);
    assert.equal((await request('/admin/private-messages/'+aId,'POST',{body:'reply'},admin)).status,200);
    assert.equal((await request('/announcements')).data.unread,1);
    const thread=(await request('/private-messages')).data;assert.equal(thread.length,2);assert.equal(thread[1].body,'reply');
    assert.equal((await request('/announcements')).data.unread,0);
    assert.deepEqual((await request('/messages','GET',undefined,b)).data,[]);
    assert.equal((await request('/admin/announcements','POST',{title:'x',body:'x'},b)).status,403);
    assert.equal((await request('/admin/announcements','POST',{title:'x',body:'x'},admin,'https://evil.example')).status,403);
    const made=(await request('/admin/announcements','POST',{title:'Updated',body:'Invitation and private replies'},admin)).data;
    assert.equal((await request('/announcements/preferences','POST',{disabled:'true'})).status,400);
    await request('/announcements/preferences','POST',{disabled:true,seen:made.id});
    const second=session(aId);const me=(await request('/me','GET',undefined,second)).data.user;assert.equal(me.announcementDisabled,true);assert.equal(me.announcementSeen,made.id);
    assert.equal((await request('/announcements','GET',undefined,second)).data.items[0].title,'Updated');
    const revised=(await request('/admin/announcements/'+made.id,'PUT',{title:'Revised',body:'new content'},admin)).data;
    assert.ok(revised.id>made.id);assert.equal((await request('/announcements')).data.items.some(n=>n.id===made.id),false);
    await request('/admin/announcements/'+revised.id,'DELETE',undefined,admin);
    assert.equal((await request('/announcements')).data.items.some(n=>n.id===revised.id),false);
  }finally {await app.close();}
});

test('unplayed retirement clears code, keeps registration safeguards, and migrates existing retired rows',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'snake-community-')),path=join(dir,'arena.sqlite');let s=new Store(path);
  try {
    s.run("INSERT INTO users(id,username,nickname,password,role,created_at) VALUES('owner','Owner','Owner','unused','user',1)");
    const insert=(name,status='registered',appearances=0,best=null)=>Number(s.run("INSERT INTO players(owner,name,color,model,source,hash,status,created_at,registered_at,appearances,best_rank) VALUES('owner',?,'#123456','test','private',?,?,1,1,?,?)",name,digest(name),status,appearances,best).lastInsertRowid);
    const removed=insert('Removed'),old=insert('OldRemoved','retired'),history=insert('History','retired',50),peak=insert('Peak','retired',0,3),top=insert('Top','registered',100);
    const arena=new ArenaService(s,{startWorkers:false});arena.retire({id:'owner'},removed);
    assert.equal(s.one('SELECT source FROM players WHERE id=?',removed).source,'');assert.ok(s.one('SELECT registered_at,hash FROM players WHERE id=?',removed).hash);
    assert.throws(()=>arena.source({id:'owner',role:'user'},removed),/无权/);
    assert.ok(!arena.listPlayers({id:'owner',role:'admin'},true).some(p=>p.id===removed));
    s.close();s=new Store(path);
    assert.equal(s.one('SELECT source FROM players WHERE id=?',old).source,'');
    assert.equal(s.one('SELECT source FROM players WHERE id=?',history).source,'private');assert.equal(s.one('SELECT source FROM players WHERE id=?',peak).source,'private');
    assert.equal(new ArenaService(s,{startWorkers:false}).listPlayers({id:'owner',role:'admin'},true)[0].id,top);
    const notices=s.one('SELECT COUNT(*) n FROM announcements').n;s.close();s=new Store(path);assert.equal(s.one('SELECT COUNT(*) n FROM announcements').n,notices);
  }finally{s.close();await rm(dir,{recursive:true,force:true});}
});
