'use strict';
/* ================= 搜题 ================= */
let SQ={kw:'',bank:'全部',type:'全部',chap:'全部',diff:'全部',page:1};
route('#/search',()=>{
  if(!requireAuth())return;
  const banks=readableBanks();
  const bankOpts=['全部',...banks.map(b=>b.id)];
  render(`<h1 class="page-title">搜题</h1><div class="page-sub">在自有与共享题库中搜索题干、选项、解析；多个关键词以空格分隔（且关系）</div>
    <div class="filter-panel">
      <div style="display:flex;gap:10px;margin-bottom:12px">
        <input class="input" id="sqKw" placeholder="输入关键词（1–100 字符）" value="${esc(SQ.kw)}" maxlength="100" style="flex:1">
        <button class="btn primary" id="sqGo">搜索</button>
      </div>
      <div class="filter-grid">
        <select class="input" id="sqBank"><option value="全部">全部题库</option>${banks.map(b=>`<option value="${b.id}" ${SQ.bank===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}</select>
        <select class="input" id="sqType"><option>全部</option>${TYPE_KEYS.map(t=>`<option value="${t}" ${SQ.type===t?'selected':''}>${TYPES[t]}</option>`).join('')}</select>
        <select class="input" id="sqChap"><option>全部</option>${allChapters(banks.map(b=>b.id)).map(c=>`<option ${SQ.chap===esc(c)?'selected':''}>${esc(c)}</option>`).join('')}</select>
        <select class="input" id="sqDiff"><option>全部</option>${DIFF_KEYS.map(d=>`<option value="${d}" ${SQ.diff===d?'selected':''}>${DIFFS[d]}</option>`).join('')}</select>
      </div>
    </div>
    <div id="sqResults">${SQ.kw?searchResultsHTML():'<div class="card empty"><div class="big">🔍</div><p>输入关键词开始搜索</p></div>'}</div>`,'#/search');
  const go=()=>{
    const kw=$('#sqKw').value.trim();
    if(!kw){toast('请输入关键词','warn');return;}
    SQ={kw,bank:$('#sqBank').value,type:$('#sqType').value,chap:$('#sqChap').value,diff:$('#sqDiff').value,page:1};
    $('#sqResults').innerHTML=searchResultsHTML();bindResults();
  };
  $('#sqGo').onclick=go;
  $('#sqKw').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  ['sqBank','sqType','sqChap','sqDiff'].forEach(id=>$('#'+id).onchange=()=>{if(SQ.kw)go();});
  bindResults();
});
function doSearch(){
  const kws=SQ.kw.toLowerCase().split(/\s+/).filter(Boolean);
  let pool=[];
  readableBanks().forEach(b=>{bankQuestions(b.id).forEach(q=>pool.push({q,b,own:isOwner(b)}));});
  if(SQ.bank!=='全部')pool=pool.filter(x=>x.b.id===SQ.bank);
  pool=pool.filter(({q})=>{
    if(SQ.type!=='全部'&&q.type!==SQ.type)return false;
    if(SQ.diff!=='全部'&&q.difficulty!==SQ.diff)return false;
    if(SQ.chap!=='全部'&&!chapterMatch(q.chapter,SQ.chap))return false;
    const hay=(q.stem+' '+(q.options||[]).map(o=>o.t).join(' ')+' '+q.analysis).toLowerCase();
    return kws.every(k=>hay.includes(k));
  });
  return pool;
}
function hi(text){
  let h=esc(text);
  SQ.kw.trim().split(/\s+/).filter(Boolean).forEach(k=>{
    h=h.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),m=>`<span class="hl">${m}</span>`);
  });
  return h;
}
function searchResultsHTML(){
  const all=doSearch();
  if(!all.length)return `<div class="card empty"><div class="big">🈳</div><p>没有找到匹配题目，建议减少关键词或放宽筛选</p></div>`;
  const per=20,pages=Math.ceil(all.length/per);SQ.page=Math.min(SQ.page,Math.max(1,pages));
  const list=all.slice((SQ.page-1)*per,SQ.page*per);
  return `<p class="small muted" style="margin-bottom:10px">命中 <strong>${all.length}</strong> 题 ｜ 关键词「${esc(SQ.kw)}」</p>
    ${list.map(({q,b,own},i)=>`<div class="card" style="margin-bottom:10px">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag gray">${esc(q.chapter||'未设置章节')}</span><span class="tag ${own?'':'accent'}">${own?'自有':'共享'} · ${esc(b.name)}</span></div>
      <div style="font-weight:600">${hi(q.stem.slice(0,120))}${q.stem.length>120?'…':''}</div>
      ${(q.options||[]).slice(0,4).map(o=>`<div class="small muted">${o.k}. ${hi(o.t.slice(0,40))}</div>`).join('')}
      <div class="small" style="margin-top:8px"><div class="analysis-box"><strong>答案：</strong>${esc(q.type==='blank'?splitAccepted(q.answer).join(' / '):q.answer)}<br><strong>解析：</strong>${esc(q.analysis||'暂无解析')}</div></div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn sm primary" data-one="${q.id}">练这题</button>
        <button class="btn sm ghost" data-locbank="${b.id}">定位题库</button>
      </div>
    </div>`).join('')}
    ${pager(all.length,SQ.page,per,p=>{SQ.page=p;$('#sqResults').innerHTML=searchResultsHTML();bindResults();window.scrollTo(0,0);})}`;
}
function bindResults(){
  $$('[data-one]').forEach(b=>b.onclick=()=>location.hash='#/practice/one/'+b.dataset.one);
  $$('[data-locbank]').forEach(b=>b.onclick=()=>location.hash='#/bank/'+b.dataset.locbank);
}
