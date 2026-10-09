import { randomUUID } from 'node:crypto';
import { token,rateLimit,publicUser } from './auth.mjs';
import { fail } from './service.mjs';

export class Community {
  constructor(store) { this.store=store; }
  eligible(id) {
    return !!this.store.one("SELECT u.id FROM users u WHERE u.id=? AND u.banned=0 AND EXISTS(SELECT 1 FROM players p WHERE p.owner=u.id AND p.status='registered' AND p.system=0)",id);
  }
  used(id) { return this.store.one('SELECT COUNT(*) n FROM users u JOIN invites i ON i.id=u.invite_id WHERE i.owner=?',id).n; }
  validateInvite(invite) {
    if(!invite||!invite.enabled||invite.superseded||invite.uses>=invite.max_uses||(invite.expires&&invite.expires<=Date.now()))fail('邀请码无效、过期或人数已满');
    if(invite.owner) {
      const owner=this.store.one('SELECT invite_limit FROM users WHERE id=?',invite.owner);
      if(!owner||!this.eligible(invite.owner)||this.used(invite.owner)>=owner.invite_limit)fail('个人邀请码已暂停或邀请名额已满');
    }
  }
  provenance(id) {
    const chain=[],visited=new Set();let current=id,root='本机初始化',inviter=null;
    while(current&&!visited.has(current)&&visited.size<100) {
      visited.add(current);
      const row=this.store.one('SELECT u.username,u.nickname,i.label,i.owner FROM users u LEFT JOIN invites i ON i.id=u.invite_id WHERE u.id=?',current);
      if(!row)break;
      chain.unshift(row.username);
      if(!row.owner) {root=row.label||'本机初始化';break;}
      if(current===id) {const parent=this.store.one('SELECT username,nickname FROM users WHERE id=?',row.owner);inviter=parent?.username||null;}
      current=row.owner;
    }
    return {source:root,inviter,chain:chain.join(' → ')};
  }
  personal(user) {
    const row=this.store.one('SELECT invite_limit FROM users WHERE id=?',user.id),invite=this.store.one('SELECT * FROM invites WHERE owner=? AND superseded=0',user.id),used=this.used(user.id);
    return {eligible:this.eligible(user.id),limit:row.invite_limit,used,remaining:Math.max(0,row.invite_limit-used),invite:invite?{id:invite.id,code:invite.code,enabled:!!invite.enabled}:null,
      accounts:this.store.all('SELECT u.username,u.nickname,u.created_at FROM users u JOIN invites i ON i.id=u.invite_id WHERE i.owner=? ORDER BY u.created_at DESC',user.id)};
  }
  generate(user,rotate=false) {
    return this.store.transaction(()=>{
      if(!this.eligible(user.id))fail('拥有至少一名未退役的注册选手后才能生成邀请码');
      const old=this.store.one('SELECT * FROM invites WHERE owner=? AND superseded=0',user.id);
      if(old&&!rotate)return this.personal(user);
      if(old&&!old.enabled)fail('邀请码已由管理员停用，请联系服主');
      const limit=this.store.one('SELECT invite_limit FROM users WHERE id=?',user.id).invite_limit;
      if(this.used(user.id)>=limit)fail('邀请名额已用完，请联系服主');
      if(rotate)rateLimit(this.store,'invite-rotate:'+user.id,5,86400000);
      if(old)this.store.run('UPDATE invites SET enabled=0,superseded=1 WHERE id=?',old.id);
      const id=randomUUID(),code=token().slice(0,16).toUpperCase();
      this.store.run('INSERT INTO invites(id,code,label,max_uses,created_at,owner) VALUES(?,?,?,?,?,?)',id,code,'个人邀请 @'+user.username,limit,Date.now(),user.id);
      this.store.audit(user.id,old?'rotate-personal-invite':'create-personal-invite',id);
      return this.personal(user);
    });
  }
  accounts() {
    return this.store.all('SELECT id,username,nickname,role,banned,created_at,invite_limit FROM users ORDER BY created_at DESC').map(u=>({...u,...this.provenance(u.id),invited:this.used(u.id)}));
  }
  thread(user,owner) {
    if(user.role!=='admin'&&owner!==user.id)fail('无权查看该对话',403);
    if(!this.store.one('SELECT id FROM users WHERE id=?',owner))fail('账户不存在',404);
    return this.store.transaction(()=>{
      this.store.run('UPDATE private_messages SET read_at=? WHERE owner=? AND read_at IS NULL AND '+(user.role==='admin'?"sender=owner":"sender!=owner"),Date.now(),owner);
      return this.store.all('SELECT m.id,m.sender,m.body,m.created_at,m.read_at,u.nickname,u.username FROM private_messages m JOIN users u ON u.id=m.sender WHERE m.owner=? ORDER BY m.id DESC LIMIT 200',owner).reverse();
    });
  }
  write(user,owner,input) {
    if(user.role!=='admin'&&owner!==user.id)fail('无权发送该对话',403);
    const target=this.store.one('SELECT id,role FROM users WHERE id=?',owner);if(!target||target.role==='admin')fail('请选择普通账户的对话');
    const text=typeof input.body==='string'?input.body.trim():'';if(!text||text.length>2000)fail('私信需要1～2000个字符');
    rateLimit(this.store,'private-message:'+user.id,1,10000);
    this.store.run('INSERT INTO private_messages(owner,sender,body,created_at) VALUES(?,?,?,?)',owner,user.id,text,Date.now());
    return {ok:true};
  }
  inbox() {
    return this.store.all(`SELECT u.id,u.username,u.nickname,MAX(m.created_at) latest,
      SUM(CASE WHEN m.sender=m.owner AND m.read_at IS NULL THEN 1 ELSE 0 END) unread
      FROM private_messages m JOIN users u ON u.id=m.owner GROUP BY u.id ORDER BY unread>0 DESC,latest DESC`);
  }
  async route({path,method,user,body}) {
    const s=this.store;
    if(path==='/api/announcements'&&method==='GET')return {items:s.all('SELECT * FROM announcements WHERE active=1 ORDER BY id DESC LIMIT 50'),unread:s.one('SELECT COUNT(*) n FROM private_messages WHERE owner=? AND sender!=owner AND read_at IS NULL',user.id).n};
    if(path==='/api/announcements/preferences'&&method==='POST') {
      const input=await body();
      if(input.disabled!==undefined&&typeof input.disabled!=='boolean')fail('通知设置无效');
      if(input.seen!==undefined&&(!Number.isSafeInteger(input.seen)||input.seen<0||input.seen>(s.one('SELECT MAX(id) n FROM announcements').n||0)))fail('通知编号无效');
      if(input.disabled!==undefined)s.run('UPDATE users SET announcement_disabled=? WHERE id=?',input.disabled?1:0,user.id);
      if(input.seen!==undefined)s.run('UPDATE users SET announcement_seen=MAX(announcement_seen,?) WHERE id=?',input.seen,user.id);
      return {user:publicUser(s.one('SELECT * FROM users WHERE id=?',user.id))};
    }
    if(path==='/api/personal-invite'&&method==='GET')return this.personal(user);
    if(path==='/api/personal-invite'&&method==='POST') {const input=await body();if(input.rotate!==undefined&&typeof input.rotate!=='boolean')fail('操作无效');return this.generate(user,input.rotate===true);}
    if(path==='/api/private-messages'&&method==='GET')return this.thread(user,user.id);
    if(path==='/api/private-messages'&&method==='POST')return this.write(user,user.id,await body());
    if(!path.startsWith('/api/admin/'))return undefined;
    if(user.role!=='admin')fail('需要管理员权限',403);
    if(path==='/api/admin/users'&&method==='GET')return this.accounts();
    if(path==='/api/admin/private-messages'&&method==='GET')return this.inbox();
    const thread=path.match(/^\/api\/admin\/private-messages\/([a-f0-9-]{36})$/);
    if(thread&&method==='GET')return this.thread(user,thread[1]);
    if(thread&&method==='POST')return this.write(user,thread[1],await body());
    const limit=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})\/invite-limit$/);
    if(limit&&method==='PUT') {
      const input=await body();if(!Number.isInteger(input.limit)||input.limit<0||input.limit>1000)fail('邀请总名额需要0～1000');
      if(!s.one('SELECT id FROM users WHERE id=?',limit[1]))fail('账户不存在',404);
      s.transaction(()=>{s.run('UPDATE users SET invite_limit=? WHERE id=?',input.limit,limit[1]);s.run('UPDATE invites SET max_uses=? WHERE owner=? AND superseded=0',input.limit,limit[1]);s.audit(user.id,'personal-invite-limit',limit[1]+':'+input.limit);});return {ok:true};
    }
    if(path==='/api/admin/announcements'&&method==='GET')return s.all('SELECT * FROM announcements ORDER BY id DESC LIMIT 100');
    const notice=path.match(/^\/api\/admin\/announcements\/(\d+)$/);
    if((path==='/api/admin/announcements'&&method==='POST')||(notice&&method==='PUT')) {
      const input=await body(),title=typeof input.title==='string'?input.title.trim():'',text=typeof input.body==='string'?input.body.trim():'';
      if(!title||title.length>80||!text||text.length>5000)fail('标题需要1～80字，内容需要1～5000字');
      return s.transaction(()=>{
        if(notice) {if(!s.one('SELECT id FROM announcements WHERE id=?',Number(notice[1])))fail('通知不存在',404);s.run('UPDATE announcements SET active=0 WHERE id=?',Number(notice[1]));}
        const id=Number(s.run('INSERT INTO announcements(title,body,created_at) VALUES(?,?,?)',title,text,Date.now()).lastInsertRowid);s.audit(user.id,'publish-announcement',id);return {id};
      });
    }
    if(notice&&method==='DELETE') {s.transaction(()=>{s.run('UPDATE announcements SET active=0 WHERE id=?',Number(notice[1]));s.audit(user.id,'withdraw-announcement',notice[1]);});return {ok:true};}
    return undefined;
  }
}
