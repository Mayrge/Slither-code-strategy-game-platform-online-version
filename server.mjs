import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './server/database.mjs';
import { ArenaService,fail } from './server/service.mjs';
import { token,digest,validUsername,hashPassword,verifyPassword,openSession,readSession,publicUser,rateLimit } from './server/auth.mjs';
import { emptyRanking } from './server/ranking.mjs';
import { createAgentKit } from './agent-sandbox/package-kit.mjs';

export const root=fileURLToPath(new URL('./',import.meta.url));
const JSON_HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function send(res,status,data,extra={}) { res.writeHead(status,{...JSON_HEADERS,...extra});res.end(JSON.stringify(data)); }
async function body(req) {
  if(!req.headers['content-type']?.startsWith('application/json'))fail('请使用JSON请求',415);
  const parts=[];let bytes=0;
  for await(const part of req) { bytes+=part.length;if(bytes>120000)fail('请求过大',413);parts.push(part); }
  try { const data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data; }catch{fail('请求内容无效');}
}
const integer=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('编号无效');return n;};
export async function createServer({database=resolve(root,'data/arena.sqlite'),publicUrl=process.env.PUBLIC_URL||'',workers=true,listener=null}={}) {
  const store=new Store(database),arena=new ArenaService(store,{startWorkers:workers});
  await arena.seedSystems();
  const canonical=publicUrl?new URL(publicUrl).origin:null;
  if(canonical&&!canonical.startsWith('https://'))throw new Error('PUBLIC_URL需要使用HTTPS网站地址');
  const cookie=secret=>`arena_session=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${canonical?'; Secure':''}`;
  const server=listener||http.createServer();
  server.on('request',async(req,res)=>{
    try {
      const url=new URL(req.url,'http://localhost'),path=url.pathname,method=req.method;
      if(path==='/api/health'&&method==='GET')return send(res,200,{app:'snake-arena-online',version:'0.1.4',initialized:!!store.one("SELECT id FROM users WHERE role='admin'")});
      if(path.startsWith('/api/')) {
        const user=readSession(store,req);
        if(!['GET','HEAD'].includes(method)) {
          const origin=req.headers.origin,allowed=canonical||'http://'+req.headers.host;
          if(origin!==allowed)fail('请求来源无效',403);
          if(!['/api/login','/api/register'].includes(path)&&(!user||req.headers['x-csrf-token']!==user.csrf))fail('登录已失效或请求校验失败',403);
        }
        if(method==='POST'&&path==='/api/login') {
          const input=await body(req);validUsername(input.username);
          rateLimit(store,'login:'+input.username.toLowerCase(),10,600000);
          rateLimit(store,'auth-global',300,3600000);
          const row=store.one('SELECT * FROM users WHERE username=? COLLATE NOCASE',input.username);
          const dummy='scrypt$00000000000000000000000000000000$'+ '0'.repeat(64);
          if(!(await verifyPassword(input.password,row?.password||dummy))||!row||row.banned)fail('用户名或密码错误，或账户已停用',401);
          const session=openSession(store,row.id);return send(res,200,{user:publicUser(row),csrf:session.csrf},{'Set-Cookie':cookie(session.secret)});
        }
        if(method==='POST'&&path==='/api/register') {
          const input=await body(req);validUsername(input.username);
          if(input.consent!==true)fail('请确认平台管理员可查看策略的说明');
          rateLimit(store,'signup-global',100,3600000);
          const password=await hashPassword(input.password),code=String(input.invite||'').trim().toUpperCase(),id=randomUUID();
          store.transaction(()=>{
            if(store.one('SELECT id FROM users WHERE username=? COLLATE NOCASE',input.username))fail('用户名已被使用');
            const invite=store.one('SELECT * FROM invites WHERE code=?',code);
            if(!invite||!invite.enabled||invite.uses>=invite.max_uses||(invite.expires&&invite.expires<Date.now()))fail('邀请码无效、过期或人数已满');
            store.run('INSERT INTO users(id,username,nickname,password,role,invite_id,created_at) VALUES(?,?,?,?,?,?,?)',id,input.username,input.username,password,'user',invite.id,Date.now());
            store.run('UPDATE invites SET uses=uses+1 WHERE id=?',invite.id);store.audit(id,'account-register',invite.id);
          });
          const row=store.one('SELECT * FROM users WHERE id=?',id),session=openSession(store,id);
          return send(res,201,{user:publicUser(row),csrf:session.csrf},{'Set-Cookie':cookie(session.secret)});
        }
        if(!user)fail('请先登录',401);
        const admin=()=>{if(user.role!=='admin')fail('需要管理员权限',403);};
        if(method==='GET'&&path==='/api/me')return send(res,200,{user:publicUser(user),csrf:user.csrf,models:store.get('models',[])});
        if(method==='POST'&&path==='/api/logout') {store.run('DELETE FROM sessions WHERE hash=?',user.session_hash);return send(res,200,{ok:true},{'Set-Cookie':'arena_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'+(canonical?'; Secure':'')});}
        if(method==='POST'&&path==='/api/account') {
          const input=await body(req),nickname=String(input.nickname||'').trim();if(!nickname||nickname.length>24)fail('昵称需要1～24个字符');
          if(input.guideDisabled!==undefined&&typeof input.guideDisabled!=='boolean')fail('新手引导设置无效');
          if(input.newPassword) {
            if(!(await verifyPassword(input.password,user.password)))fail('当前密码错误',403);
            const password=await hashPassword(input.newPassword);
            store.transaction(()=>{store.run('UPDATE users SET nickname=?,password=? WHERE id=?',nickname,password,user.id);store.run('DELETE FROM sessions WHERE user_id=? AND hash!=?',user.id,user.session_hash);});
          }else store.run('UPDATE users SET nickname=? WHERE id=?',nickname,user.id);
          if(input.guideDisabled!==undefined)store.run('UPDATE users SET guide_disabled=? WHERE id=?',input.guideDisabled?1:0,user.id);
          return send(res,200,{ok:true,user:publicUser(store.one('SELECT * FROM users WHERE id=?',user.id))});
        }
        if(method==='GET'&&path==='/api/players')return send(res,200,arena.listPlayers(user,url.searchParams.get('all')==='1'));
        if(method==='POST'&&path==='/api/players')return send(res,201,await arena.saveDraft(user,await body(req)));
        const playerMatch=path.match(/^\/api\/players\/(\d+)(?:\/(source|register|retire|highlights))?$/);
        if(playerMatch) {
          const id=integer(playerMatch[1]),action=playerMatch[2];
          if(method==='GET'&&action==='source')return send(res,200,arena.source(user,id));
          if(method==='GET'&&action==='highlights')return send(res,200,arena.highlights(user,id));
          if(method==='PUT'&&!action)return send(res,200,await arena.saveDraft(user,await body(req),id));
          if(method==='POST'&&action==='register')return send(res,200,await arena.register(user,id));
          if(method==='POST'&&action==='retire') {arena.retire(user,id);return send(res,200,{ok:true});}
          if(method==='DELETE'&&!action) {
            const p=store.one("SELECT id FROM players WHERE id=? AND owner=? AND status='draft'",id,user.id);if(!p)fail('只能删除自己的草稿',403);
            store.run('DELETE FROM players WHERE id=?',id);return send(res,200,{ok:true});
          }
        }
        if(method==='GET'&&path==='/api/ranking')return send(res,200,store.get('ranking',emptyRanking()));
        if(method==='GET'&&path==='/api/jobs')return send(res,200,arena.jobs(user));
        if(method==='POST'&&path==='/api/jobs')return send(res,201,arena.enqueue(user,await body(req)));
        const jobMatch=path.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(games|current|replay)(?:\/(\d+))?)?$/);
        if(jobMatch) {
          const [,id,action,round]=jobMatch;
          if(method==='GET'&&action==='games')return send(res,200,arena.gameList(user,id));
          if(method==='GET'&&action==='replay'&&round)return send(res,200,arena.replay(user,id,integer(round)));
          if(method==='GET'&&action==='current') {
            return send(res,200,arena.live(user,id,Number(url.searchParams.get('after')||0),url.searchParams.get('summary')==='1'));
          }
          if(method==='DELETE'&&!action){arena.deleteJob(user,id);return send(res,200,{ok:true});}
        }
        if(method==='GET'&&path==='/api/messages')return send(res,200,store.all('SELECT m.id,m.owner,m.body,m.created_at,u.nickname,u.username FROM messages m JOIN users u ON u.id=m.owner WHERE m.deleted_at IS NULL ORDER BY m.id DESC LIMIT 100'));
        if(method==='POST'&&path==='/api/messages') {
          const input=await body(req),text=String(input.body||'').trim();if(!text||text.length>500)fail('留言需要1～500个字符');
          rateLimit(store,'message:'+user.id,1,30000);
          store.run('INSERT INTO messages(owner,body,created_at) VALUES(?,?,?)',user.id,text,Date.now());return send(res,201,{ok:true});
        }
        const messageMatch=path.match(/^\/api\/messages\/(\d+)$/);
        if(method==='DELETE'&&messageMatch) {
          const id=integer(messageMatch[1]),message=store.one('SELECT owner FROM messages WHERE id=? AND deleted_at IS NULL',id);
          if(!message||(message.owner!==user.id&&user.role!=='admin'))fail('无权删除该留言',403);
          store.transaction(()=>{store.run('UPDATE messages SET deleted_at=? WHERE id=?',Date.now(),id);store.audit(user.id,'delete-message',id);});return send(res,200,{ok:true});
        }
        if(method==='GET'&&path==='/api/rules'){return send(res,200,{text:await readFile(resolve(root,'RULES.md'),'utf8')});}
        if(method==='GET'&&path==='/api/agent-kit') {
          const zip=await createAgentKit();res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="snake-agent-kit.zip"','Cache-Control':'no-store'});return res.end(zip);
        }
        if(path.startsWith('/api/admin/')) {
          admin();
          if(method==='GET'&&path==='/api/admin/invites')return send(res,200,store.all('SELECT * FROM invites ORDER BY created_at DESC'));
          if(method==='POST'&&path==='/api/admin/invites') {
            const input=await body(req),label=String(input.label||'').trim(),max=Number(input.maxUses),expires=input.expires?Number(input.expires):null;
            if(!label||label.length>40||!Number.isInteger(max)||max<1||max>1000||(expires&&(!Number.isSafeInteger(expires)||expires<=Date.now())))fail('请输入来源标签、1～1000人的上限和有效的到期时间');
            const id=randomUUID(),code=token().slice(0,16).toUpperCase();store.run('INSERT INTO invites(id,code,label,max_uses,expires,created_at) VALUES(?,?,?,?,?,?)',id,code,label,max,expires,Date.now());store.audit(user.id,'create-invite',id);return send(res,201,{id,code});
          }
          const inviteMatch=path.match(/^\/api\/admin\/invites\/([a-f0-9-]{36})$/);
          if(method==='PUT'&&inviteMatch) {const input=await body(req);if(typeof input.enabled!=='boolean')fail('状态无效');store.run('UPDATE invites SET enabled=? WHERE id=?',input.enabled?1:0,inviteMatch[1]);store.audit(user.id,'invite-state',inviteMatch[1]);return send(res,200,{ok:true});}
          if(method==='GET'&&path==='/api/admin/users')return send(res,200,store.all('SELECT u.id,u.username,u.nickname,u.role,u.banned,u.created_at,i.label AS source FROM users u LEFT JOIN invites i ON i.id=u.invite_id ORDER BY u.created_at DESC'));
          const userMatch=path.match(/^\/api\/admin\/users\/([a-f0-9-]{36})$/);
          if(method==='PUT'&&userMatch) {
            const input=await body(req),target=store.one('SELECT * FROM users WHERE id=?',userMatch[1]);if(!target||target.role==='admin')fail('不能通过此入口修改管理员');
            if(typeof input.banned==='boolean') {store.run('UPDATE users SET banned=? WHERE id=?',input.banned?1:0,target.id);if(input.banned)store.run('DELETE FROM sessions WHERE user_id=?',target.id);store.audit(user.id,'account-state',target.id);}
            if(input.password) {const password=await hashPassword(input.password);store.transaction(()=>{store.run('UPDATE users SET password=? WHERE id=?',password,target.id);store.run('DELETE FROM sessions WHERE user_id=?',target.id);store.audit(user.id,'reset-password',target.id);});}
            return send(res,200,{ok:true});
          }
          if(method==='PUT'&&path==='/api/admin/models') {
            const input=await body(req);if(!Array.isArray(input.models)||input.models.length<1||input.models.length>100||input.models.some(m=>typeof m!=='string'||!m.trim()||m.length>60))fail('模型列表无效');
            store.set('models',[...new Set(input.models.map(m=>m.trim()))]);store.audit(user.id,'update-models','models');return send(res,200,{ok:true});
          }
          if(method==='GET'&&path==='/api/admin/audit')return send(res,200,store.all('SELECT a.*,u.username FROM audit a LEFT JOIN users u ON u.id=a.actor ORDER BY a.id DESC LIMIT 100'));
        }
        fail('接口不存在',404);
      }
      if(method!=='GET'&&method!=='HEAD')fail('不支持的请求',405);
      const requested=path==='/'?'/index.html':path;
      const file=resolve(root,'public','.'+decodeURIComponent(requested)),publicRoot=resolve(root,'public');
      if(!file.startsWith(publicRoot+sep)||!['.html','.js','.css','.svg','.ico'].includes(extname(file)))fail('文件不存在',404);
      const content=await readFile(file);
      res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"});
      res.end(method==='HEAD'?undefined:content);
    }catch(error) {send(res,error.status||(error.code==='ENOENT'?404:500),{error:error.status?error.message:error.code==='ENOENT'?'文件不存在':'操作未完成，请稍后重试或联系管理员'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  const close=async()=>{await arena.close();await new Promise(resolveClose=>server.close(resolveClose));store.close();};
  arena.kick();return {server,store,arena,close};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||3082),listener=http.createServer();
  try {
    // Bind before opening the database: a duplicate launch must not invalidate an active match.
    await new Promise((ready,reject)=>{listener.once('error',reject);listener.listen(port,'127.0.0.1',ready);});
    const app=await createServer({listener});
    console.log(`联网版 v0.1.4：http://127.0.0.1:${app.server.address().port}`);
    app.server.on('error',error=>{console.error(error.message);process.exitCode=1;void app.close();});
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit()));
  }catch(error){console.error(error.code==='EADDRINUSE'?`端口 ${port} 已被占用。竞技台可能已经启动；请打开已有页面，或修改 .env 中的 PORT。`:error.message);listener.close();process.exitCode=1;}
}
