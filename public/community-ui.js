export function communityUI({api,run,esc,date,getUser,setUser,getPlayers,viewSource,isPage}) {
  let dismissed=false,items=[],lastPoll=0,generation=0,selectedNotice=null,conversationGeneration=0;
  const $=id=>document.getElementById(id);
  const host=$('announcements'),bell=$('announcement-bell');
  function close(){dismissed=true;host.hidden=true;}
  async function show(){
    if(!getUser())return;
    host.hidden=false;
    host.innerHTML=`<div class="dialog-title"><h3>平台通知</h3><button id="close-announcements" aria-label="关闭通知">×</button></div><div class="announcement-list">${items.map(n=>`<article class="message"><strong>${esc(n.title)}</strong><span class="small muted">${date(n.created_at)}</span><p class="plain-text">${esc(n.body)}</p></article>`).join('')||'<p class="muted">暂无通知。</p>'}</div><div class="row"><button id="dismiss-announcements">本次登录不再弹出</button><button id="disable-announcements">永久关闭自动弹出</button></div><p class="small muted">关闭后仍可点击右上角“通知”查看。</p>`;
    $('close-announcements').onclick=close;$('dismiss-announcements').onclick=close;
    $('disable-announcements').onclick=run(async()=>{const result=await api('/announcements/preferences',{method:'POST',data:{disabled:true}});setUser(result.user);close();if(isPage('account'))$('announcements-disabled').checked=true;});
    const seen=items[0]?.id||0;
    const epoch=generation;
    if(seen>(getUser().announcementSeen||0)){const result=await api('/announcements/preferences',{method:'POST',data:{seen}});if(epoch===generation&&getUser()){setUser(result.user);bell.classList.remove('unread');}}
  }
  async function poll(force=false){
    if(!getUser()||(!force&&Date.now()-lastPoll<15000))return;
    lastPoll=Date.now();const epoch=generation;
    const data=await api('/announcements');if(epoch!==generation||!getUser())return;
    items=data.items;const fresh=(items[0]?.id||0)>(getUser().announcementSeen||0);
    bell.classList.toggle('unread',fresh);bell.title=data.unread?`平台通知 · ${data.unread} 条服主未读回复`:'平台通知';
    const mail=$('private-mail-unread');if(mail)mail.textContent=data.unread?`${data.unread} 条未读回复`:'';
    if(fresh&&!dismissed&&!getUser().announcementDisabled)await show();
  }
  bell.onclick=run(async()=>{await poll(true);await show();});
  host.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  document.addEventListener('click',e=>{if(!host.hidden&&!host.contains(e.target)&&!bell.contains(e.target))close();});
  function logout(){generation++;conversationGeneration++;host.hidden=true;items=[];dismissed=false;lastPoll=0;selectedNotice=null;$('private-dialog').close();}
  async function login(){generation++;dismissed=false;lastPoll=0;await poll(true);if(getUser()&&items.length&&!getUser().announcementDisabled&&host.hidden&&!dismissed)await show();}
  async function conversation(owner=null,label='与服主对话') {
    const conversationEpoch=++conversationGeneration;
    const endpoint=owner?'/admin/private-messages/'+owner:'/private-messages',dialog=$('private-dialog');
    let request=0;
    dialog.innerHTML=`<div class="dialog-title"><h2>${esc(label)}</h2><button id="close-private" aria-label="关闭对话">×</button></div><p class="muted small">仅本人及管理员可见，文本最多 2000 字，每 10 秒最多一条。显示最近 200 条。</p><div id="private-thread" class="private-thread" aria-live="polite"></div><form id="private-form"><label>发送消息<textarea id="private-body" maxlength="2000" required rows="3"></textarea></label><button class="primary">发送</button><button type="button" id="refresh-private">刷新回复</button></form><p id="private-error" role="status"></p>`;
    dialog.showModal();$('close-private').onclick=()=>dialog.close();
    async function load(){const epoch=++request,messages=await api(endpoint);if(!dialog.open||epoch!==request||conversationEpoch!==conversationGeneration||!getUser())return;$('private-thread').innerHTML=messages.map(m=>`<article class="message ${m.sender===getUser().id?'mine':''}"><strong>${esc(m.nickname)} <span class="muted small">@${esc(m.username)}</span></strong><span class="small muted">${date(m.created_at)}</span><p class="plain-text">${esc(m.body)}</p></article>`).join('')||'<p class="empty">还没有消息，写下你的问题或建议。</p>';$('private-thread').scrollTop=$('private-thread').scrollHeight;}
    $('private-form').onsubmit=async e=>{e.preventDefault();const button=e.submitter;button.disabled=true;try{await api(endpoint,{method:'POST',data:{body:$('private-body').value}});$('private-body').value='';await load();$('private-error').textContent='已发送。';}catch(error){$('private-error').textContent=error.message;}finally{button.disabled=false;}};
    $('refresh-private').onclick=run(load);await load();
  }
  async function mountAccount(){
    const pageMarker=$('page').firstElementChild;const data=await api('/personal-invite');if(!isPage('account')||$('page').firstElementChild!==pageMarker)return;
    $('page').insertAdjacentHTML('beforeend',`<section class="card"><h3>平台通知与私信</h3><label class="checkline"><input id="announcements-disabled" type="checkbox" ${getUser().announcementDisabled?'checked':''}>永久关闭所有通知的自动弹出</label><p class="muted small">右上角通知入口一直保留；取消勾选可恢复自动弹出。</p><div class="row"><button id="open-notices">查看平台通知</button>${getUser().role!=='admin'?'<button id="open-private">与服主对话</button><span id="private-mail-unread" class="badge"></span>':'<button id="open-admin-mail">查看用户私信</button>'}</div></section><section class="card"><h3>邀请朋友</h3><p class="muted">拥有至少一名未退役的注册选手，即可生成自己的唯一邀请码。默认可邀请 5 个账户；更换邀请码不重置累计名额。</p><p><strong>已邀请 ${data.used} / ${data.limit} 人</strong> · 剩余 ${data.remaining} 人</p>${data.invite?`<div class="row"><code id="personal-code">${esc(data.invite.code)}</code><button id="copy-personal-invite">复制邀请码</button></div><p class="muted small">${!data.invite.enabled?'已被管理员停用':!data.eligible?'暂停使用：当前没有未退役的注册选手':!data.remaining?'邀请名额已满':'可用于注册'}</p>`:'<p class="muted">尚未生成邀请码。</p>'}<button id="generate-personal-invite" ${!data.eligible||!data.remaining||(data.invite&&!data.invite.enabled)?'disabled':''}>${data.invite?'更换邀请码':'生成我的邀请码'}</button><p class="muted small">更换后旧码立即失效；已邀请账户不受影响。名额需要调整时请联系服主。</p><h4>我直接邀请的账户</h4>${data.accounts.map(a=>`<p>${esc(a.nickname)} <span class="muted small">@${esc(a.username)} · ${date(a.created_at)}</span></p>`).join('')||'<p class="muted">暂无邀请记录。</p>'}</section>`);
    $('announcements-disabled').onchange=run(async()=>{const input=$('announcements-disabled');try{const result=await api('/announcements/preferences',{method:'POST',data:{disabled:input.checked}});setUser(result.user);}catch(error){input.checked=getUser().announcementDisabled;throw error;}});
    $('open-notices').onclick=run(async()=>{await poll(true);await show();});
    if($('open-private'))$('open-private').onclick=run(()=>conversation());
    if($('open-admin-mail'))$('open-admin-mail').onclick=()=>document.querySelector('[data-page="admin"]').click();
    if($('copy-personal-invite'))$('copy-personal-invite').onclick=run(async()=>{await navigator.clipboard.writeText(data.invite.code);$('copy-personal-invite').textContent='已复制';});
    $('generate-personal-invite').onclick=run(async()=>{if(data.invite&&!confirm('更换后旧邀请码立即失效，累计邀请名额不会重置。继续？'))return;await api('/personal-invite',{method:'POST',data:{rotate:!!data.invite}});if(isPage('account'))document.querySelector('[data-page="account"]').click();});
    await poll(true);
  }
  function accountButtons(accounts){
    document.querySelectorAll('[data-account-detail]').forEach(b=>b.onclick=()=>{
      const a=accounts.find(a=>a.id===b.dataset.accountDetail);const list=getPlayers().filter(p=>p.owner===a.id);
      $('admin-account-detail').hidden=false;$('admin-account-detail').innerHTML=`<div class="card-header"><h3>${esc(a.nickname)} <span class="muted small">@${esc(a.username)}</span></h3><button id="close-account-detail">收起</button></div><p class="muted">直接邀请人：${esc(a.inviter||'管理员邀请码')} · 原始来源：${esc(a.source)}</p><p class="plain-text small">邀请链：${esc(a.chain)}</p><form id="personal-limit-form" class="row"><label>累计邀请名额<input id="personal-limit" type="number" min="0" max="1000" required value="${a.invite_limit}"></label><span class="muted">已邀请 ${a.invited} 人</span><button class="primary">调整名额</button></form><h4>该账户的选手</h4><div class="player-code-list">${['draft','registered','retired'].map(status=>`<details><summary>${{draft:'草稿',registered:'已注册',retired:'已退役'}[status]} · ${list.filter(p=>p.status===status).length}</summary>${list.filter(p=>p.status===status).map(p=>`<p><button data-account-source="${p.id}">${esc(p.name)} · ${esc(p.model)}</button><span class="small muted"> ${p.appearances} 局</span></p>`).join('')||'<p class="muted">暂无选手。</p>'}</details>`).join('')}</div>`;
      $('close-account-detail').onclick=()=>{$('admin-account-detail').hidden=true;};
      $('personal-limit-form').onsubmit=run(async()=>{const value=Number($('personal-limit').value);await api('/admin/users/'+a.id+'/invite-limit',{method:'PUT',data:{limit:value}});a.invite_limit=value;$('personal-limit-form').querySelector('button').textContent='已保存';});
      document.querySelectorAll('[data-account-source]').forEach(button=>button.onclick=run(()=>viewSource(Number(button.dataset.accountSource))));$('admin-account-detail').scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  }
  async function mountAdmin(){
    const pageMarker=$('page').firstElementChild;const [notices,inbox]=await Promise.all([api('/admin/announcements'),api('/admin/private-messages')]);if(!isPage('admin')||$('page').firstElementChild!==pageMarker)return;
    $('page').insertAdjacentHTML('afterbegin',`<div class="grid two"><section class="card"><h3>平台通知</h3><form id="announcement-form"><label>标题<input id="announcement-title" maxlength="80" required placeholder="更新通知"></label><label>内容<textarea id="announcement-body" maxlength="5000" rows="5" required placeholder="向所有账户发布通知"></textarea></label><div class="row"><button class="primary">发布通知</button><button id="announcement-new" type="button">新建</button></div><p id="announcement-edit-caption" class="muted small">普通关闭仅对本次登录生效，永久关闭的用户仍可手动查看。</p></form><details><summary>已发布通知 · ${notices.filter(n=>n.active).length}</summary>${notices.map(n=>`<div class="message"><strong>${esc(n.title)}</strong><span class="small muted">${date(n.created_at)} · ${n.active?'已发布':'已撤下'}</span><div class="row"><button data-edit-announcement="${n.id}">编辑并重新发布</button>${n.active?`<button data-withdraw-announcement="${n.id}" class="danger">撤下</button>`:''}</div></div>`).join('')}</details></section><section class="card"><h3>与服主对话 · 收件箱</h3><p class="muted small">仅管理员可以查看。打开对话后，对方发来的消息会标记为已读。</p><button id="refresh-admin-mail">刷新收件箱</button><div>${inbox.map(t=>`<div class="message"><button data-private-owner="${t.id}" data-private-label="${esc(t.username)}">${esc(t.nickname)} · @${esc(t.username)}</button>${t.unread?`<span class="badge lime">${t.unread} 条未读</span>`:'<span class="small muted">已读</span>'}<span class="small muted">${date(t.latest)}</span></div>`).join('')||'<p class="muted">暂无用户私信。</p>'}</div></section></div>`);
    selectedNotice=null;
    $('announcement-form').onsubmit=run(async()=>{await api('/admin/announcements'+(selectedNotice?'/'+selectedNotice:''),{method:selectedNotice?'PUT':'POST',data:{title:$('announcement-title').value,body:$('announcement-body').value}});document.querySelector('[data-page="admin"]').click();});
    $('announcement-new').onclick=()=>{selectedNotice=null;$('announcement-form').reset();$('announcement-edit-caption').textContent='正在新建通知。';};
    document.querySelectorAll('[data-edit-announcement]').forEach(b=>b.onclick=()=>{const n=notices.find(n=>n.id===Number(b.dataset.editAnnouncement));selectedNotice=n.id;$('announcement-title').value=n.title;$('announcement-body').value=n.body;$('announcement-edit-caption').textContent='保存时会撤下旧内容并重新发布这条通知。';$('announcement-title').focus();});
    document.querySelectorAll('[data-withdraw-announcement]').forEach(b=>b.onclick=run(async()=>{if(!confirm('撤下这条通知？'))return;await api('/admin/announcements/'+b.dataset.withdrawAnnouncement,{method:'DELETE'});document.querySelector('[data-page="admin"]').click();}));
    $('refresh-admin-mail').onclick=()=>document.querySelector('[data-page="admin"]').click();
    document.querySelectorAll('[data-private-owner]').forEach(b=>b.onclick=run(()=>conversation(b.dataset.privateOwner,'与 @'+b.dataset.privateLabel+' 对话')));
    document.querySelectorAll('[data-system-source]').forEach(b=>b.onclick=run(()=>viewSource(Number(b.dataset.systemSource))));
  }
  return {login,logout,poll,mountAccount,mountAdmin,accountButtons};
}
