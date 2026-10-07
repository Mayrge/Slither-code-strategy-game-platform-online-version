import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { gzipSync,gunzipSync } from 'node:zlib';
import { readFile,readdir } from 'node:fs/promises';
import { digest,rateLimit } from './auth.mjs';
import { validateInWorker } from './validation-worker.mjs';
import { emptyRanking,chooseOpponents,planJob,scheduleJob,settleRanking,COOLDOWN } from './ranking.mjs';

export const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
export function playerView(p, source=false) {
  const {id,owner,name,color,model,status,system,created_at,registered_at,retired_at,cooldown,average,appearances,username,nickname}=p;
  return {id,owner,name,color,model,status,system:!!system,createdAt:created_at,registeredAt:registered_at,retiredAt:retired_at,cooldown,average,appearances,username,nickname,...(source?{source:p.source}:{})};
}
export class ArenaService {
  constructor(store,{startWorkers=true}={}) {
    this.store=store; this.worker=null; this.current=null; this.startWorkers=startWorkers; this.closed=false; this.validations=0;
    store.run("UPDATE jobs SET status='failed',error='服务重启，比赛未结算；可以重新发起' WHERE status='running'");
  }
  async seedSystems() {
    if(this.store.one('SELECT id FROM players WHERE system=1')) return;
    const names=['青柠 · 探路','冰川 · 稳健','珊瑚 · 追猎','紫罗兰 · 远望','琥珀 · 拾荒','薄荷 · 觅食','樱粉 · 回旋','日落 · 巡航','靛蓝 · 侦察','月白 · 均衡'];
    const colors=['#b9fa74','#7ac9ff','#fb897d','#c0a1ff','#ffd56b','#5cdec5','#fc91c9','#f3a960','#8da6ff','#d5e8e3'];
    const files=(await readdir(new URL('./system-strategies/',import.meta.url))).filter(n=>n.endsWith('.js')).sort();
    for(let i=0;i<files.length;i++) {
      const source=await readFile(new URL('./system-strategies/'+files[i],import.meta.url),'utf8');
      this.store.run("INSERT INTO players(owner,name,color,model,source,hash,status,system,created_at,registered_at) VALUES(NULL,?,?,?,?,?,'registered',1,?,?)",names[i],colors[i],'系统选手',source,digest(source),Date.now(),Date.now());
    }
  }
  listPlayers(user,all=false) {
    const rows=this.store.all('SELECT p.*,u.username,u.nickname FROM players p LEFT JOIN users u ON u.id=p.owner '+(all?(user.role==='admin'?'':"WHERE p.status!='draft' OR p.owner=?"):"WHERE p.owner=? OR p.system=1"),...(all&&user.role==='admin'?[]:[user.id]));
    return rows.map(p=>playerView(p,p.owner===user.id));
  }
  source(user,id) {
    const p=this.store.one('SELECT * FROM players WHERE id=?',id);
    if(!p || (p.owner!==user.id && user.role!=='admin')) fail('无权查看该策略',403);
    if(user.role==='admin' && p.owner!==user.id) this.store.audit(user.id,'view-source',id);
    return {source:p.source};
  }
  async saveDraft(user,input,id=null) {
    const name=String(input.name||'').trim(),color=String(input.color||''),model=String(input.model||''),source=input.source;
    if(!name || name.length>24) fail('名称需要1～24个字符');
    if(!/^#[a-f0-9]{6}$/i.test(color)) fail('颜色格式无效');
    const allowed=this.store.get('models',[]);
    const custom=allowed.includes('其他 / 其他（必填填空）')&&model.startsWith('其他 / 自填：')&&model.slice(8).trim().length>0&&model.length<=60;
    if(!allowed.includes(model)&&!custom) fail('请选择管理员提供的AI模型，其他选项必须填写说明');
    if(model==='其他 / 其他（必填填空）') fail('选择其他时需要填写模型说明');
    if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>100000) fail('策略需要是100KB以内的JavaScript代码');
    if(id) {
      const p=this.store.one('SELECT * FROM players WHERE id=?',id);
      if(!p||p.owner!==user.id||p.status!=='draft') fail('只能修改自己的草稿',403);
      this.store.run('UPDATE players SET name=?,color=?,model=?,source=? WHERE id=?',name,color,model,source,id);
    } else {
      if(this.store.one("SELECT COUNT(*) n FROM players WHERE owner=? AND status='draft'",user.id).n>=30) fail('最多保存30份草稿');
      id=Number(this.store.run("INSERT INTO players(owner,name,color,model,source,status,created_at) VALUES(?,?,?,?,?,'draft',?)",user.id,name,color,model,source,Date.now()).lastInsertRowid);
    }
    return playerView(this.store.one('SELECT * FROM players WHERE id=?',id),true);
  }
  async register(user,id) {
    const p=this.store.one('SELECT * FROM players WHERE id=?',id);
    if(!p||p.owner!==user.id||p.status!=='draft') fail('请选择自己的草稿',403);
    if(this.validations>=2) fail('策略检查繁忙，请稍后重试',429);
    rateLimit(this.store,'validate:'+user.id,10,600000);
    this.validations++;
    try { await validateInWorker(p.source); }
    catch { fail('策略加载失败或初始化超时：需要同步JavaScript模块并导出decide函数'); }
    finally { this.validations--; }
    return this.store.transaction(()=>{
      const fresh=this.store.one('SELECT * FROM players WHERE id=?',id);
      if(fresh.status!=='draft'||fresh.source!==p.source||fresh.name!==p.name||fresh.model!==p.model) fail('草稿已变化，请重试');
      if(this.store.one("SELECT COUNT(*) n FROM players WHERE owner=? AND status='registered'",user.id).n>=5) fail('最多同时拥有5名未退役选手');
      if(this.store.one('SELECT COUNT(*) n FROM players WHERE owner=? AND registered_at>?',user.id,Date.now()-COOLDOWN).n>=5) fail('为维护公平竞技，每连续12小时最多注册5名选手');
      const hash=digest(p.source.replaceAll('\r\n','\n').trim());
      if(this.store.one('SELECT id FROM players WHERE owner=? AND hash=? AND registered_at IS NOT NULL',user.id,hash)) fail('该代码已注册过，退役后也不能换名重复注册');
      if(this.store.one('SELECT id FROM players WHERE name=? COLLATE NOCASE AND registered_at IS NOT NULL',p.name)) fail('该选手名称已被注册');
      this.store.run("UPDATE players SET status='registered',hash=?,registered_at=? WHERE id=?",hash,Date.now(),id);
      this.store.audit(user.id,'register-player',id);
      return playerView(this.store.one('SELECT * FROM players WHERE id=?',id),true);
    });
  }
  retire(user,id) {
    const p=this.store.one('SELECT * FROM players WHERE id=?',id);
    if(!p||p.owner!==user.id||p.status!=='registered') fail('只能退役自己的正式选手',403);
    const active=this.store.all("SELECT roster,candidate,kind,status FROM jobs WHERE status IN ('queued','running')");
    if(active.some(j=>j.candidate===id||JSON.parse(j.roster).includes(id))) fail('选手正在等待或参与比赛，请比赛完成后退役');
    const ranking=this.store.get('ranking',emptyRanking());
    if(ranking.order.includes(id)&&active.some(j=>j.kind!=='practice'&&j.status==='running')) fail('正式比赛结算期间暂不能改变榜单，请比赛完成后退役');
    this.store.transaction(()=>{
      this.store.run("UPDATE players SET status='retired',retired_at=? WHERE id=?",Date.now(),id);
      const rank=this.store.get('ranking',emptyRanking()); const before=[...rank.order]; rank.order=rank.order.filter(v=>v!==id);
      if(before.length!==rank.order.length) { rank.revision++; rank.history.unshift({at:Date.now(),kind:'retire',candidate:id,before,after:[...rank.order]}); this.store.set('ranking',rank); }
      this.store.audit(user.id,'retire-player',id);
    });
  }
  enqueue(user,{kind,candidate,opponents=[],count=1}) {
    if(!['ranked','practice','bootstrap'].includes(kind) || (kind==='bootstrap'&&user.role!=='admin')) fail('赛程类型无效');
    let roster;
    if(kind==='bootstrap') {
      if(this.store.get('ranking',emptyRanking()).order.length) fail('已完成初始定榜');
      if(this.store.one("SELECT id FROM jobs WHERE kind='bootstrap' AND status IN ('queued','running')")) fail('初始定榜正在进行');
      roster=this.store.all("SELECT * FROM players WHERE system=1 AND status='registered'"); count=50;
    } else {
      if(kind==='ranked') {
        const own=this.store.one('SELECT * FROM players WHERE id=? AND owner=?',candidate,user.id);
        if(!own || own.status==='retired') fail('请选择自己的未退役选手');
        if(own.status!=='registered') fail('正式排位需要注册选手');
        if(!this.store.get('ranking',emptyRanking()).order.length) fail('管理员尚未完成系统选手初始定榜');
        if(own.cooldown>Date.now()) fail('该选手仍处于12小时排位冷却');
        if(this.store.one("SELECT id FROM jobs WHERE candidate=? AND kind='ranked' AND status IN ('queued','running')",candidate)) fail('该选手已有排位任务');
        roster=[]; count=50; // Matchmaking is performed when the queued job actually starts.
      } else {
        if(!Number.isInteger(count)||count<1||count>100) fail('练习局数需要1～100');
        if(!Array.isArray(opponents)||opponents.length<1||opponents.length>9||new Set(opponents).size!==opponents.length||opponents.includes(candidate)) fail('请选择1～9名不同对手');
        roster=[candidate,...opponents].map(id=>this.store.one("SELECT * FROM players WHERE id=? AND (status='registered' OR (owner=? AND status='draft'))",id,user.id));
        if(roster.some(p=>!p)) fail('请选择可参与练习的选手：系统选手、已注册选手或自己的草稿');
        if(this.store.one("SELECT id FROM jobs WHERE owner=? AND kind='practice' AND status IN ('queued','running')",user.id)) fail('请先完成已有练习');
        rateLimit(this.store,'practice:'+user.id,20,86400000);
      }
    }
    const id=randomUUID(),seed=randomUUID();
    this.store.run("INSERT INTO jobs(id,owner,candidate,kind,status,total,seed,roster,created_at) VALUES(?,?,?,?,'queued',?,?,?,?)",id,user.id,candidate??null,kind,count,seed,JSON.stringify(roster.map(p=>p.id)),Date.now());
    this.kick(); return {id};
  }
  kick() { if(!this.closed&&this.startWorkers&&!this.worker) setImmediate(()=>this.next()); }
  next() {
    if(this.closed||this.worker) return;
    const job=this.store.one("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1"); if(!job) return;
    try {
      const account=this.store.one('SELECT * FROM users WHERE id=? AND banned=0',job.owner); if(!account) throw new Error('账户不可用');
      const state=this.store.get('ranking',emptyRanking()); let players;
      const candidate=job.candidate?this.store.one('SELECT * FROM players WHERE id=?',job.candidate):null;
      if(job.kind==='ranked') {
        if(candidate?.status!=='registered'||candidate.cooldown>Date.now()) throw new Error('选手不可用或正在冷却');
        players=chooseOpponents(state,this.store.all("SELECT * FROM players WHERE status='registered'"),candidate);
      } else players=JSON.parse(job.roster).map(id=>this.store.one('SELECT * FROM players WHERE id=?',id));
      if(players.some(p=>!p||p.status==='retired')) throw new Error('选手已退役');
      const plan=job.kind==='practice'?null:planJob(state,players,candidate,job.kind);
      const schedule=scheduleJob(players,job.total,job.seed);
      this.store.run("UPDATE jobs SET status='running',plan=?,roster=? WHERE id=?",JSON.stringify(plan),JSON.stringify(players.map(p=>p.id)),job.id);
      const worker=new Worker(new URL('./match-worker.mjs',import.meta.url),{workerData:{players,schedule},resourceLimits:{maxOldGenerationSizeMb:128},execArgv:[]});
      this.worker=worker; this.current={id:job.id,round:0,frame:null,config:null};
      let last=Date.now(),finished=false;
      const complete=error=>{
        if(finished)return; finished=true; clearInterval(timer);
        try {
          if(error) throw new Error(error);
          this.store.transaction(()=>{
            const fresh=this.store.one('SELECT * FROM jobs WHERE id=?',job.id);
            if(fresh.completed!==fresh.total) throw new Error('比赛记录不完整');
            if(plan) {
              const games=this.store.all('SELECT results FROM games WHERE job_id=? ORDER BY round',job.id).map(g=>({results:JSON.parse(g.results)}));
              const settled=settleRanking(this.store.get('ranking',emptyRanking()),plan,games);
              settled.ranking.history[0].jobId=job.id;
              this.store.set('ranking',settled.ranking);
              for(const [id,t] of Object.entries(settled.averages)) this.store.run('UPDATE players SET average=?,appearances=appearances+? WHERE id=?',t.average,t.games,Number(id));
              if(settled.retired) this.store.run("UPDATE players SET status='retired',retired_at=? WHERE id=?",Date.now(),settled.retired);
              if(job.candidate) this.store.run('UPDATE players SET cooldown=? WHERE id=?',Date.now()+COOLDOWN,job.candidate);
              this.store.audit(job.owner,'rank-settlement',job.id);
            }
            this.store.run("UPDATE jobs SET status='completed',finished_at=?,applied=? WHERE id=?",Date.now(),plan?1:0,job.id);
          });
        } catch(e) { this.store.run("UPDATE jobs SET status='failed',finished_at=?,error=? WHERE id=?",Date.now(),e.message,job.id); }
        void worker.terminate(); this.worker=null; this.current=null; this.kick();
      };
      const timer=setInterval(()=>{if(Date.now()-last>10000) complete('比赛执行超时，未计入排行榜');},1000);
      worker.on('message',message=>{
        if(finished)return; last=Date.now();
        try {
          if(message.type==='frame') this.current={id:job.id,round:message.round,frame:message.frame,config:message.config};
          else if(message.type==='game') this.store.transaction(()=>{
            this.store.run('INSERT INTO games VALUES(?,?,?,?,?)',job.id,message.round,message.seed,JSON.stringify(message.results),gzipSync(JSON.stringify(message.replay)));
            this.store.run('UPDATE jobs SET completed=? WHERE id=?',message.round,job.id);
          });
          else if(message.type==='done') complete(); else if(message.type==='failed') complete(message.error);
        } catch { complete('比赛记录保存失败，未计入排行榜'); }
      });
      worker.on('error',()=>complete('执行环境异常，未计入排行榜'));
      worker.on('exit',()=>{if(!finished)complete('执行环境退出，未计入排行榜');});
    } catch(error) { this.store.run("UPDATE jobs SET status='failed',error=?,finished_at=? WHERE id=?",error.message,Date.now(),job.id); this.kick(); }
  }
  jobs(user) { return this.store.all('SELECT id,candidate,kind,status,total,completed,seed,created_at,finished_at,error,applied,roster FROM jobs WHERE owner=? ORDER BY created_at DESC LIMIT 200',user.id).map(j=>({...j,roster:JSON.parse(j.roster)})); }
  gameList(user,id) {
    const job=this.store.one('SELECT * FROM jobs WHERE id=?',id); if(!job||(job.owner!==user.id&&user.role!=='admin'))fail('无权查看比赛记录',403);
    return this.store.all('SELECT round,seed,results FROM games WHERE job_id=? ORDER BY round',id).map(g=>({...g,results:JSON.parse(g.results)}));
  }
  replay(user,id,round) {
    const job=this.store.one('SELECT * FROM jobs WHERE id=?',id);
    if(!job||(job.owner!==user.id&&user.role!=='admin'&&!(job.applied&&job.status==='completed')))fail('无权查看回放',403);
    const game=this.store.one('SELECT replay FROM games WHERE job_id=? AND round=?',id,round); if(!game)fail('回放不存在',404);
    return JSON.parse(gunzipSync(game.replay).toString());
  }
  highlights(user,id) {
    const p=this.store.one('SELECT * FROM players WHERE id=? AND owner=?',id,user.id); if(!p||!p.registered_at)fail('请选择自己的正式或退役选手');
    const games=this.store.all("SELECT g.job_id,g.round,g.results FROM games g JOIN jobs j ON j.id=g.job_id WHERE j.status='completed' AND j.applied=1 ORDER BY j.created_at DESC,g.round");
    const own=games.map(g=>({...g,result:JSON.parse(g.results).find(r=>r.id===id)})).filter(g=>g.result);
    if(!own.length)return [];
    const best=[...own].sort((a,b)=>a.result.rank-b.result.rank||b.result.score-a.result.score)[0];
    const worst=[...own].sort((a,b)=>b.result.rank-a.result.rank||a.result.score-b.result.score)[0];
    const result=[{...best,label:best.result.rank===1?'第一名对局':'最佳名次对局'}];
    if(best.job_id!==worst.job_id||best.round!==worst.round)result.push({...worst,label:worst.result.rank===JSON.parse(worst.results).length?'最后一名对局':'最差名次对局'});
    const pool=own.filter(g=>!result.some(r=>r.job_id===g.job_id&&r.round===g.round));
    for(let i=0;i<3&&pool.length;i++) { const g=pool.splice(Math.floor(Math.random()*pool.length),1)[0];result.push({...g,label:'随机回看 '+(i+1)}); }
    return result.map(({job_id,round,result,label})=>({jobId:job_id,round,result,label}));
  }
  deleteJob(user,id) {
    const job=this.store.one('SELECT * FROM jobs WHERE id=?',id);if(!job||job.owner!==user.id)fail('无权删除赛程',403);
    if(['queued','running'].includes(job.status))fail('进行中的赛程不能取消或删除');
    this.store.transaction(()=>{this.store.run('DELETE FROM jobs WHERE id=?',id);this.store.audit(user.id,'delete-job',id);});
  }
  async close() { this.closed=true; if(this.worker)await this.worker.terminate(); }
}
