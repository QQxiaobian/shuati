'use strict';
/* ================= 工具 ================= */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,9);
const nowTs=()=>Date.now();
const fmtTime=ts=>{if(!ts)return'-';const d=new Date(ts);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;};
const fmtSize=b=>{if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';if(b<1073741824)return (b/1048576).toFixed(1)+' MB';return (b/1073741824).toFixed(2)+' GB';};
function shuffle(a){a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function hashPwd(s){ // cyrb53 不可逆哈希 + 盐（纯前端演示级）
  const salt='shutibao::';let h1=0xdeadbeef^0x9e3779b9,h2=0x41c6ce57^0x9e3779b9;const str=salt+s;
  for(let i=0;i<str.length;i++){const ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (h2>>>0).toString(16)+(h1>>>0).toString(16);
}
/* ================= 数据层（服务器同步 + 本地缓存） ================= */
let DB=null;
let BASE=null; // 上次与服务器一致时的行哈希基线 {table:{id:hash}, settings/builtin*:hash}
const SYNC_TABLES=['banks','questions','answers','wrongBook','papers','examRecords','shares','paperShares','favorites','importTasks','practiceProgress','auditLogs','users'];
const SYNC_META=['settings','builtinCategories','builtinBanks'];

function emptyDB(settings){
  return {settings:settings||{openRegister:true,quotaMB:1024,maxFileMB:35,maxSheets:30,maxRows:10000,maxPerImport:20000,shareEnabled:true,wrongThreshold:2},
    users:[],banks:[],questions:[],answers:[],wrongBook:[],papers:[],examRecords:[],
    shares:[],paperShares:[],favorites:[],importTasks:[],practiceProgress:[],auditLogs:[],builtinCategories:[],builtinBanks:[],session:null};
}
async function api(path,opts){
  let r;
  try{r=await fetch('api/'+path,{credentials:'same-origin',...opts});}
  catch(e){throw new Error('无法连接服务器，请确认服务已启动');}
  const j=await r.json().catch(()=>({ok:false,error:'服务器响应异常（HTTP '+r.status+'）'}));
  if(r.status===401&&DB){DB.session=null;if(location.hash!=='#/login'&&location.hash!=='#/register'){location.hash='#/login';}}
  return j;
}
const apiGet=p=>api(p);
const apiPost=(p,data)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});

function baseline(){
  BASE={};
  SYNC_TABLES.forEach(t=>{BASE[t]={};(DB[t]||[]).forEach(r=>{if(r&&r.id)BASE[t][r.id]=hashPwd(JSON.stringify(r));});});
  SYNC_META.forEach(k=>{BASE[k]=hashPwd(JSON.stringify(DB[k]));});
}
let pushChain=Promise.resolve();
let saveTimer=null;
function buildDiff(){ // 与基线比较，返回 {upserts,deletes} 或 null
  const up={},del={};
  SYNC_TABLES.forEach(t=>{
    const cur={};
    (DB[t]||[]).forEach(r=>{if(!r||!r.id)return;const h=hashPwd(JSON.stringify(r));cur[r.id]=h;if(BASE[t][r.id]!==h)(up[t]=up[t]||[]).push(r);});
    Object.keys(BASE[t]).forEach(id=>{if(!(id in cur))(del[t]=del[t]||[]).push(id);});
  });
  SYNC_META.forEach(k=>{const h=hashPwd(JSON.stringify(DB[k]));if(BASE[k]!==h)up[k]=DB[k];});
  if(!Object.keys(up).length&&!Object.keys(del).length)return null;
  return {upserts:up,deletes:del};
}
function saveDB(){ // 写穿透：防抖 350ms 合并高频修改（保持原有同步调用签名）
  if(!DB||!DB.session||!BASE)return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{saveTimer=null;pushChain=pushChain.then(pushDiff).catch(e=>{console.warn('同步失败',e);toast('数据同步失败：'+e.message,'err');});},350);
}
window.addEventListener('beforeunload',()=>{ // 关页面前尽力冲刷未推送的修改
  if(!saveTimer||!DB||!DB.session||!BASE)return;
  const d=buildDiff();if(!d)return;
  try{navigator.sendBeacon('api/sync',new Blob([JSON.stringify(d)],{type:'application/json'}));}catch(e){}
});
async function pushDiff(){
  const d0=buildDiff();
  if(!d0)return;
  const up=d0.upserts,del=d0.deletes;
  // 大变更分块推送，避免超出 PHP post 限制；banks/users/settings 先于其他表，保证归属校验通过
  const CHUNK=1200;
  const mkJobs=obj=>{const jobs=[];Object.keys(obj).forEach(t=>{const v=obj[t];
    if(Array.isArray(v)&&v.length>CHUNK){for(let i=0;i<v.length;i+=CHUNK)jobs.push({[t]:v.slice(i,i+CHUNK)});}
    else jobs.push({[t]:v});});return jobs;};
  const upJobs=mkJobs(up);
  upJobs.sort((a,b)=>((a.banks||a.users||a.settings)?0:1)-((b.banks||b.users||b.settings)?0:1));
  for(const u2 of upJobs){const r=await apiPost('sync',{upserts:u2,deletes:{}});if(!r.ok)throw new Error(r.error||'保存失败');}
  for(const d2 of mkJobs(del)){const r=await apiPost('sync',{upserts:{},deletes:d2});if(!r.ok)throw new Error(r.error||'保存失败');}
  baseline();
}
async function flushSave(){ // 立即推送未保存的修改（交卷/生成试卷前调用）
  if(!DB||!DB.session||!BASE)return;
  clearTimeout(saveTimer);saveTimer=null;
  pushChain=pushChain.then(()=>pushDiff());
  await pushChain;
}
async function fullSync(){
  const r=await apiGet('sync');
  if(!r.ok)throw new Error(r.error||'同步失败');
  DB=r.db;DB.session={userId:r.user.id};baseline();
}
/* ---- 旧版（纯静态 localStorage）数据一次性迁移 ---- */
function migrateLegacy(){
  try{
    if(localStorage.getItem('shutibao_migrated'))return;
    const old=JSON.parse(localStorage.getItem('shutibao_db_v1')||'null');
    if(old&&old.session&&Array.isArray(old.banks)){
      const me=DB.session.userId,lu=old.session.userId;
      const bids=new Set((old.banks||[]).filter(b=>b.ownerId===lu).map(b=>b.id));
      let n=0;
      (old.banks||[]).filter(b=>bids.has(b.id)).forEach(b=>{b.ownerId=me;if(!DB.banks.some(x=>x.id===b.id)){DB.banks.push(b);n++;}});
      (old.questions||[]).filter(q=>bids.has(q.bankId)).forEach(q=>{if(!DB.questions.some(x=>x.id===q.id))DB.questions.push(q);});
      ['answers','wrongBook','papers','examRecords','importTasks'].forEach(t=>{
        (old[t]||[]).filter(r=>r.userId===lu).forEach(r=>{r.userId=me;if(!DB[t].some(x=>x.id===r.id))DB[t].push(r);});
      });
      if(n){saveDB();toast(`已迁移本机历史题库 ${n} 个到服务器`,'ok');}
    }
    localStorage.setItem('shutibao_migrated','1');
    localStorage.removeItem('shutibao_db_v1');
  }catch(e){console.warn('迁移旧数据失败',e);}
}
function audit(action,target,result,reason){
  const u=currentUser();
  DB.auditLogs.unshift({id:uid(),actor:u?u.username:'system',action,target:target||'',result:result||'成功',reason:reason||'',ts:nowTs()});
  if(DB.auditLogs.length>2000)DB.auditLogs.length=2000;
}
/* ================= 会话 ================= */
function currentUser(){return DB.session?DB.users.find(u=>u.id===DB.session.userId&&u.status==='active')||null:null;}
function isAdmin(){const u=currentUser();return u&&u.role==='admin';}
function requireAuth(){if(!currentUser()){location.hash='#/login';return false;}return true;}
/* ================= 题库领域 ================= */
const TYPES={single:'单选题',multi:'多选题',judge:'判断题',blank:'填空题',essay:'简答题'};
const TYPE_KEYS=Object.keys(TYPES);
const DIFFS={easy:'简单',mid:'中等',hard:'困难',none:'未设置'};
const DIFF_KEYS=Object.keys(DIFFS);
function bankQuestions(bankId){return DB.questions.filter(q=>q.bankId===bankId);}
function bankById(id){return DB.banks.find(b=>b.id===id);}
function questionById(id){return DB.questions.find(q=>q.id===id);}
function isOwner(bank){const u=currentUser();return u&&bank&&bank.ownerId===u.id;}
function shareFor(bank,userId){return DB.shares.find(s=>s.bankId===bank.id&&s.status==='active'&&s.targetUserId===userId);}
function canReadBank(bank){
  const u=currentUser();if(!u||!bank)return false;
  if(bank.ownerId===u.id)return true;
  const s=shareFor(bank,u.id);
  if(!s)return false;
  const owner=DB.users.find(x=>x.id===bank.ownerId);
  return owner&&owner.status==='active';
}
function myBanks(){const u=currentUser();return DB.banks.filter(b=>b.ownerId===u.id);}
function sharedBanks(){const u=currentUser();return DB.banks.filter(b=>b.ownerId!==u.id&&canReadBank(b));}
function readableBanks(){return [...myBanks(),...sharedBanks()];}
function bankChapters(bankId){
  const set=new Set();bankQuestions(bankId).forEach(q=>set.add(q.chapter||'未设置章节'));
  return [...set].sort();
}
function allChapters(bankIds){const set=new Set();bankIds.forEach(id=>bankQuestions(id).forEach(q=>set.add(q.chapter||'未设置章节')));return [...set].sort();}
function chapterMatch(qChapter,sel){ // 父章节包含子章节
  if(!sel||sel==='全部')return true;
  const qc=qChapter||'未设置章节';
  return qc===sel||qc.startsWith(sel+'/');
}
function userStorageBytes(userId){
  let bytes=0;
  DB.banks.filter(b=>b.ownerId===userId).forEach(b=>{bytes+=JSON.stringify(b).length;});
  DB.questions.filter(q=>{const b=bankById(q.bankId);return b&&b.ownerId===userId;}).forEach(q=>{bytes+=JSON.stringify(q).length;});
  return bytes*2; // 粗略按 UTF-16 估算
}
function quotaLeft(userId){return DB.settings.quotaMB*1048576-userStorageBytes(userId);}
/* ---- 归一化 ---- */
function normalizeDifficulty(raw){
  const s=String(raw??'').trim();if(!s)return'none';
  if(['简单','容易','低','1','2','易'].includes(s))return'easy';
  if(['中等','一般','中','3'].includes(s))return'mid';
  if(['困难','难','高','4','5'].includes(s))return'hard';
  if(/初级|入门|基础/.test(s))return'easy';
  if(/中级|熟练/.test(s))return'mid';
  if(/高级|技师|专家/.test(s))return'hard';
  const stars=(s.match(/★/g)||[]).length;
  if(stars===1)return'easy';
  if(stars===2)return'mid';
  if(stars>=3)return'hard';
  return'none';
}
function normalizeChapter(raw){
  let s=String(raw??'').trim();if(!s)return'未设置章节';
  return s.replace(/[>＞→►▶]+/g,'/').replace(/\s*\/\s*/g,'/').replace(/\/+/g,'/').replace(/\/$/,'');
}
function toHalf(s){return String(s??'').replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0));}
function normalizeJudge(raw){
  const s=toHalf(raw).trim().toLowerCase().replace(/[\.、:：\)。]+$/,'');
  if(['对','正确','√','✓','✔','t','true','是','y','yes','right','对的','是正确'].includes(s))return'正确';
  if(['错','错误','×','x','✗','✘','f','false','否','n','no','wrong','不对','不正确'].includes(s))return'错误';
  return null;
}
function parseChoiceLetters(raw){
  let s=toHalf(raw).trim().replace(/^(参考答案|正确答案|答案)\s*[：:]\s*/,'');
  const m=s.toUpperCase().match(/[A-F]/g);
  if(!m)return null;
  return [...new Set(m)].sort();
}
function normalizeTypeName(raw){
  const s=String(raw??'').trim().replace(/\s+/g,'');
  if(!s)return null;
  if(/简答|问答|论述|案例|计算|综合|分析|识图|实操|技能|名词解释|作图|绘图|操作/.test(s))return'essay';
  if(/多选|多项/.test(s))return'multi';
  if(/单选|单项/.test(s))return'single';
  if(/判断|是非/.test(s))return'judge';
  if(/填空|完形/.test(s))return'blank';
  return null;
}
function inferType(optCount,answerRaw){
  const j=normalizeJudge(answerRaw);
  if(optCount>=2){
    const letters=parseChoiceLetters(answerRaw);
    if(letters){return letters.length>=2?'multi':'single';}
    if(j)return'judge';
    return null;
  }
  if(j)return'judge';
  if(String(answerRaw??'').trim())return'blank';
  return null;
}
function splitAccepted(raw){return String(raw??'').split('|').map(s=>s.trim()).filter(Boolean);}
function dedupeKey(q){
  const opts=(q.options||[]).map(o=>o.t.trim()).sort().join('|');
  const ans=q.type==='blank'?String(q.answer).trim().toLowerCase():String(q.answer);
  return [q.stem.trim().replace(/\s+/g,' '),q.type,opts,ans].join('##');
}
/* ---- 判分（7.1） ---- */
function gradeAnswer(q,userContent){
  if(q.type==='essay')return null;
  if(q.type==='single')return String(userContent).toUpperCase()===String(q.answer).toUpperCase();
  if(q.type==='judge')return userContent===q.answer;
  if(q.type==='multi'){
    const u=[...String(userContent)].sort().join('');
    return u===[...String(q.answer)].sort().join('');
  }
  if(q.type==='blank'){
    const norm=s=>String(s).trim().toLowerCase();
    return splitAccepted(q.answer).some(a=>norm(a)===norm(userContent));
  }
  return false;
}
/* ---- 答题记录与错题 ---- */
function latestAnswer(userId,qid){
  const list=DB.answers.filter(a=>a.userId===userId&&a.questionId===qid);
  return list.length?list[list.length-1]:null;
}
function recordAnswer(q,content,correct,source){
  const u=currentUser();
  DB.answers.push({id:uid(),userId:u.id,questionId:q.id,bankId:q.bankId,content,correct,source,ts:nowTs()});
  if(correct===false)wrongOn(q);
  saveDB();
}
function wrongOn(q){
  const u=currentUser();
  let w=DB.wrongBook.find(x=>x.userId===u.id&&x.questionId===q.id);
  if(!w){w={id:uid(),userId:u.id,questionId:q.id,bankId:q.bankId,wrongCount:0,streak:0,status:'unmastered',lastWrongTs:0};DB.wrongBook.push(w);}
  w.wrongCount++;w.streak=0;w.status='unmastered';w.lastWrongTs=nowTs();
}
function wrongCorrect(w){ // 错题练习中答对
  w.streak++;
  if(w.streak>=(DB.settings.wrongThreshold||2))w.status='mastered';
}
function refreshWrongValidity(){ // 题目删除/分享撤销后标记失效
  const u=currentUser();if(!u)return;
  DB.wrongBook.filter(w=>w.userId===u.id&&w.status!=='invalid').forEach(w=>{
    const q=questionById(w.questionId);const b=q&&bankById(q.bankId);
    if(!q||!b||!canReadBank(b))w.status='invalid';
  });
  saveDB();
}
/* ================= 收藏 ================= */
function isFav(qid){const u=currentUser();return !!(u&&DB.favorites.some(f=>f.userId===u.id&&f.questionId===qid));}
function toggleFav(q){ // 返回切换后的收藏状态
  const u=currentUser();if(!u||!q)return false;
  const ex=DB.favorites.find(f=>f.userId===u.id&&f.questionId===q.id);
  if(ex){DB.favorites=DB.favorites.filter(f=>f.id!==ex.id);saveDB();return false;}
  DB.favorites.push({id:uid(),userId:u.id,questionId:q.id,bankId:q.bankId,createdAt:nowTs()});
  saveDB();return true;
}
function myFavorites(){
  const u=currentUser();if(!u)return [];
  return DB.favorites.filter(f=>f.userId===u.id).sort((a,b)=>b.createdAt-a.createdAt);
}
/* ================= 试卷 ================= */
function paperById(id){return DB.papers.find(p=>p.id===id);}
function myPapers(){const u=currentUser();return DB.papers.filter(p=>u&&p.userId===u.id);}
function sharedPapers(){const u=currentUser();return DB.papers.filter(p=>u&&p.userId!==u.id);}
function paperShareFor(paper,userId){return DB.paperShares.find(s=>s.paperId===paper.id&&s.status==='active'&&s.targetUserId===userId);}
/* ================= UI 组件 ================= */
function toast(msg,type){
  const box=$('#toastBox');const el=document.createElement('div');
  el.className='toast'+(type?' '+type:'');el.textContent=msg;box.appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transition='opacity .3s';setTimeout(()=>el.remove(),320);},2600);
}
function openModal(html,wide){
  closeModal();
  const mask=document.createElement('div');mask.className='modal-mask';mask.id='modalMask';
  mask.innerHTML=`<div class="modal${wide?' wide':''}">${html}</div>`;
  mask.addEventListener('click',e=>{if(e.target===mask)closeModal();});
  document.body.appendChild(mask);return mask;
}
function closeModal(){const m=$('#modalMask');if(m)m.remove();}
function confirmBox(title,body,onOk,okText,danger){
  const m=openModal(`<h3>${esc(title)}</h3><div style="font-size:13.5px;color:var(--ink-soft)">${body}</div>
    <div class="modal-foot"><button class="btn" id="cfCancel">取消</button>
    <button class="btn ${danger?'danger':'primary'}" id="cfOk">${esc(okText||'确定')}</button></div>`);
  m.querySelector('#cfCancel').onclick=closeModal;
  m.querySelector('#cfOk').onclick=()=>{closeModal();onOk();};
}
function pager(total,page,per,cb){
  const pages=Math.max(1,Math.ceil(total/per));if(pages<=1)return'';
  let h='<div class="pager">';
  const btn=(p,t)=>`<button class="${p===page?'cur':''}" data-p="${p}">${t}</button>`;
  if(page>1)h+=btn(page-1,'‹');
  let s=Math.max(1,page-3),e=Math.min(pages,s+6);s=Math.max(1,e-6);
  for(let p=s;p<=e;p++)h+=btn(p,p);
  if(page<pages)h+=btn(page+1,'›');
  h+='</div>';
  setTimeout(()=>{$$('.pager button').forEach(b=>b.onclick=()=>cb(+b.dataset.p));});
  return h;
}
function typeTag(t){const c={single:'blue',multi:'accent',judge:'green',blank:'amber',essay:'gray'}[t]||'gray';return `<span class="tag ${c==='blue'?'':c}">${TYPES[t]||t}</span>`;}
function diffTag(d){const c={easy:'green',mid:'amber',hard:'red',none:'gray'}[d];return `<span class="tag ${c}">${DIFFS[d]||'未设置'}</span>`;}
function srcTag(s){return {manual:'<span class="tag gray">手动</span>',import:'<span class="tag">表格导入</span>',builtin_copy:'<span class="tag accent">内置副本</span>'}[s]||'';}
/* ================= 布局与路由 ================= */
const NAV=[
  {h:'#/banks',t:'题库',i:'📚'},
  {h:'#/wrongbook',t:'错题本',i:'✏️'},
  {h:'#/papers',t:'模拟考试',i:'📝'},
  {h:'#/exams',t:'考试记录',i:'🗂️'},
  {h:'#/favorites',t:'收藏',i:'⭐'},
  {h:'#/search',t:'搜题',i:'🔍'},
];
function layout(content,active){
  const u=currentUser();
  const navHtml=NAV.map(n=>`<button class="nav-item${active===n.h?' active':''}" data-h="${n.h}"><span class="ico">${n.i}</span>${n.t}</button>`).join('')
    +(u.role==='admin'?`<button class="nav-item${active==='#/admin'?' active':''}" data-h="#/admin"><span class="ico">🛠️</span>管理后台</button>`:'');
  return `<div class="layout">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">刷</div><div><strong>刷题宝</strong><span>SHUATIBAO</span></div></div>
      ${navHtml}
      <div style="margin-top:6px"><button class="nav-item" data-h="#/settings"><span class="ico">⚙️</span>账号设置</button></div>
      <div class="foot">👤 ${esc(u.nickname||u.username)} · ${u.role==='admin'?'管理员':'普通用户'}<br><a id="logoutLink">退出登录</a></div>
    </aside>
    <div style="flex:1;min-width:0">
      <div class="topbar"><div class="brand-mark" style="width:30px;height:30px;font-size:14px">刷</div><strong>刷题宝</strong><span class="small muted" style="flex:1;min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(u.nickname||u.username)}</span><button class="btn sm ghost" id="logoutTop" style="color:var(--red);flex:0 0 auto">退出登录</button></div>
      <main class="main"><div class="wrap">${content}</div></main>
    </div>
    <nav class="bottom-nav">${navHtml}</nav>
  </div>`;
}
function bindLayout(){
  $$('.nav-item[data-h]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.h;});
  const doLogout=()=>{apiPost('auth',{action:'logout'}).catch(()=>{}).finally(()=>{location.hash='#/login';location.reload();});};
  [$('#logoutLink'),$('#logoutTop')].forEach(el=>{if(el)el.onclick=doLogout;});
}
function render(html,active){$('#app').innerHTML=layout(html,active);bindLayout();window.scrollTo(0,0);}
function renderRaw(html){$('#app').innerHTML=html;window.scrollTo(0,0);}
/* ---- 路由 ---- */
const routes=[];
function route(pattern,handler){routes.push({re:new RegExp('^'+pattern.replace(/:[^/]+/g,'([^/]+)')+'$'),handler});}
function dispatch(){
  const h=(location.hash||'#/banks').split('?')[0];
  for(const r of routes){const m=h.match(r.re);if(m){r.handler(...m.slice(1));return;}}
  location.hash='#/banks';
}
async function boot(){
  renderRaw('<div class="auth-page"><div class="auth-card"><h1>刷题宝</h1><div class="sub">正在连接服务器…</div></div></div>');
  try{
    const r=await apiGet('sync');
    if(r.ok){DB=r.db;DB.session={userId:r.user.id};baseline();migrateLegacy();}
    else DB=emptyDB(r.settings);
  }catch(e){
    renderRaw(`<div class="auth-page"><div class="auth-card"><h1>无法连接服务器</h1><div class="sub">${esc(e.message)}<br>请确认刷题宝服务已启动。</div><button class="btn primary lg" style="width:100%;justify-content:center" onclick="location.reload()">重新连接</button></div></div>`);
    return;
  }
  window.addEventListener('hashchange',dispatch);dispatch();
}
/* ================= 登录 / 注册 / 改密 ================= */
route('#/login',()=>{
  if(currentUser()){location.hash='#/banks';return;}
  renderRaw(`<div class="auth-page"><div class="auth-card">
    <h1>刷题宝</h1><div class="sub">登录你的账号，开始刷题</div>
    <div class="field"><label>用户名</label><input class="input" id="lgUser" autocomplete="username"></div>
    <div class="field"><label>密码</label><input class="input" id="lgPwd" type="password" autocomplete="current-password"></div>
    <div class="field-err hidden" id="lgErr"></div>
    <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:6px" id="lgBtn">登 录</button>
    ${DB.settings.openRegister?`<div class="small muted" style="text-align:center;margin-top:14px">还没有账号？<a href="#/register">立即注册</a></div>`:`<div class="small muted" style="text-align:center;margin-top:14px">注册已关闭，如需账号请联系管理员</div>`}
    <div class="small muted" style="text-align:center;margin-top:10px">默认管理员：admin / admin123</div>
  </div></div>`);
  const doLogin=async()=>{
    const name=$('#lgUser').value.trim(),pwd=$('#lgPwd').value;const err=$('#lgErr');
    const fail=m=>{err.textContent=m;err.classList.remove('hidden');};
    if(!name||!pwd)return fail('请输入用户名和密码');
    $('#lgBtn').disabled=true;
    try{
      const r=await apiPost('auth',{action:'login',username:name,pwd:hashPwd(pwd)});
      if(!r.ok)return fail(r.error||'登录失败');
      DB=r.db;DB.session={userId:r.user.id};baseline();migrateLegacy();
      if(r.user.mustChangePwd){location.hash='#/changepwd';toast('请修改临时密码后再使用系统','warn');}
      else location.hash='#/banks';
    }catch(e){fail(e.message);}
    finally{$('#lgBtn').disabled=false;}
  };
  $('#lgBtn').onclick=doLogin;
  $('#lgPwd').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});
});
route('#/register',()=>{
  if(!DB.settings.openRegister){renderRaw(`<div class="auth-page"><div class="auth-card"><h1>注册已关闭</h1><div class="sub">当前仅管理员可创建账号</div><a class="btn primary" href="#/login" style="justify-content:center">返回登录</a></div></div>`);return;}
  renderRaw(`<div class="auth-page"><div class="auth-card">
    <h1>注册账号</h1><div class="sub">3–32 位用户名，密码 8–64 位且含字母和数字</div>
    <div class="field"><label>用户名 *</label><input class="input" id="rgUser"><div class="hint">中文、字母、数字、下划线，不含空格</div></div>
    <div class="field"><label>昵称</label><input class="input" id="rgNick"></div>
    <div class="field"><label>密码 *</label><input class="input" id="rgPwd" type="password"></div>
    <div class="field"><label>确认密码 *</label><input class="input" id="rgPwd2" type="password"></div>
    <div class="field-err hidden" id="rgErr"></div>
    <button class="btn primary lg" style="width:100%;justify-content:center;margin-top:6px" id="rgBtn">注 册</button>
    <div class="small muted" style="text-align:center;margin-top:14px"><a href="#/login">已有账号，去登录</a></div>
  </div></div>`);
  $('#rgBtn').onclick=async()=>{
    const name=$('#rgUser').value.trim(),nick=$('#rgNick').value.trim(),p1=$('#rgPwd').value,p2=$('#rgPwd2').value;const err=$('#rgErr');
    const fail=m=>{err.textContent=m;err.classList.remove('hidden');};
    if(!/^[一-龥A-Za-z0-9_]{3,32}$/.test(name))return fail('用户名需 3–32 位，仅含中文、字母、数字、下划线');
    if(p1.length<8||p1.length>64)return fail('密码长度需 8–64 位');
    if(!/[A-Za-z]/.test(p1)||!/[0-9]/.test(p1))return fail('密码需至少包含 1 个字母和 1 个数字');
    if(p1===name)return fail('密码不能与用户名相同');
    if(p1!==p2)return fail('两次输入的密码不一致');
    if(nick&&(nick.length<1||nick.length>30))return fail('昵称 1–30 个字符');
    $('#rgBtn').disabled=true;
    try{
      const r=await apiPost('auth',{action:'register',username:name,nickname:nick,pwd:hashPwd(p1)});
      if(!r.ok)return fail(r.error||'注册失败');
      toast('注册成功，请登录','ok');location.hash='#/login';
    }catch(e){fail(e.message);}
    finally{$('#rgBtn').disabled=false;}
  };
});
route('#/changepwd',()=>{
  const u=currentUser();if(!u){location.hash='#/login';return;}
  renderRaw(`<div class="auth-page"><div class="auth-card">
    <h1>修改密码</h1><div class="sub">${u.mustChangePwd?'管理员已重置你的密码，请先设置新密码':'修改成功后需重新登录'}</div>
    ${u.mustChangePwd?'':`<div class="field"><label>旧密码</label><input class="input" id="cpOld" type="password"></div>`}
    <div class="field"><label>新密码</label><input class="input" id="cpNew" type="password"></div>
    <div class="field"><label>确认新密码</label><input class="input" id="cpNew2" type="password"></div>
    <div class="field-err hidden" id="cpErr"></div>
    <button class="btn primary lg" style="width:100%;justify-content:center" id="cpBtn">确认修改</button>
  </div></div>`);
  $('#cpBtn').onclick=async()=>{
    const err=$('#cpErr');const fail=m=>{err.textContent=m;err.classList.remove('hidden');};
    const p1=$('#cpNew').value,p2=$('#cpNew2').value;
    if(p1.length<8||p1.length>64||!/[A-Za-z]/.test(p1)||!/[0-9]/.test(p1))return fail('新密码需 8–64 位且含字母和数字');
    if(p1===u.username)return fail('密码不能与用户名相同');
    if(p1!==p2)return fail('两次输入不一致');
    $('#cpBtn').disabled=true;
    try{
      const r=await apiPost('auth',{action:'changepwd',old:u.mustChangePwd?'':hashPwd($('#cpOld').value),pwd:hashPwd(p1)});
      if(!r.ok)return fail(r.error||'修改失败');
      toast('密码已修改，请重新登录','ok');
      setTimeout(()=>{location.hash='#/login';location.reload();},600);
    }catch(e){fail(e.message);$('#cpBtn').disabled=false;}
  };
});
route('#/settings',()=>{
  if(!requireAuth())return;
  const u=currentUser();
  render(`<h1 class="page-title">账号设置</h1><div class="page-sub">查看账号信息、修改密码</div>
    <div class="card"><h3 style="margin-bottom:12px">账号信息</h3>
      <table style="min-width:0"><tbody>
      <tr><td style="width:110px"><strong>用户名</strong></td><td>${esc(u.username)}</td></tr>
      <tr><td><strong>昵称</strong></td><td>${esc(u.nickname||'-')}</td></tr>
      <tr><td><strong>角色</strong></td><td>${u.role==='admin'?'<span class="tag accent">管理员</span>':'<span class="tag">普通用户</span>'}</td></tr>
      <tr><td><strong>存储用量</strong></td><td>${fmtSize(userStorageBytes(u.id))} / ${DB.settings.quotaMB} MB</td></tr>
      <tr><td><strong>注册时间</strong></td><td>${fmtTime(u.createdAt)}</td></tr>
      </tbody></table>
    </div>
    <div class="card"><h3 style="margin-bottom:12px">修改昵称</h3>
      <div class="inline-fields"><div class="field"><input class="input" id="setNick" value="${esc(u.nickname||'')}" maxlength="30"></div></div>
      <button class="btn primary" id="saveNick">保存昵称</button>
    </div>
    <div class="card"><h3 style="margin-bottom:12px">修改密码</h3>
      <button class="btn" id="goCp">前往修改密码</button>
    </div>`,'#/settings');
  $('#saveNick').onclick=()=>{const n=$('#setNick').value.trim();if(!n)return toast('昵称不能为空','err');u.nickname=n;saveDB();toast('已保存','ok');dispatch();};
  $('#goCp').onclick=()=>{location.hash='#/changepwd';};
});
