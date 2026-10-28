'use strict';
/* ================= 练习与错题本 ================= */
let PS=null; // {mode,bankId,filters,qids,idx,answers:{qid:{content,correct}},startTs}
const PKEY='shutibao_practice';
const RECITE_ONLY_KEY='shutibao_recite_only';
function psMode(m){return m==='recite'?'recite':(m==='one'?'one':'practice');}
/* 进度按「来源(scope) + 模式(刷题/背题)」分开存储：bank=题库练习，wrong=错题练习，one=单题，fav=收藏练习 */
function psScope(s){return s||'bank';}
function psKey(m,scope){
  const sc=psScope(scope);
  return PKEY+'_'+currentUser().id+'_'+(sc==='bank'?'':sc+'_')+psMode(m);
}
function savePS(){if(!PS||!currentUser())return;localStorage.setItem(psKey(PS.mode,PS.scope),JSON.stringify(PS));}
function loadPS(m,scope){try{return JSON.parse(localStorage.getItem(psKey(m,scope)));}catch(e){return null;}}
function clearPS(m,scope){
  if(!currentUser())return;
  localStorage.removeItem(psKey(m||(PS?PS.mode:'practice'),scope||(PS?PS.scope:'bank')));
}
/* 题库维度的续练进度：刷题/背题各自独立 */
function progressFor(bankId,mode,scope){
  const p=loadPS(mode,scope||'bank');
  if(!p||!Array.isArray(p.qids)||!p.qids.length)return null;
  if(bankId&&p.bankId!==bankId)return null;
  return p;
}
/* ---- 生成每题的选项乱序映射（不改动原题 answer/options，只保存展示顺序） ----
   single/multi: qid -> [原始 options 下标数组]，展示位置 i 对应 q.options[arr[i]]，展示字母为 'A'+i
   judge: qid -> ['正确','错误'] 或反序
   判分时把用户点的展示字母/值映射回原始答案字母，保证 gradeAnswer 与错题本语义不变 */
function genOptMap(qids){
  const m={};
  qids.forEach(qid=>{
    const q=questionById(qid); if(!q)return;
    if(q.type==='single'||q.type==='multi'){
      m[qid]=shuffle([...Array((q.options||[]).length).keys()]);
    }else if(q.type==='judge'){
      m[qid]=Math.random()<0.5?['正确','错误']:['错误','正确'];
    }
  });
  return m;
}
/* ---- 五维筛选 ---- */
function matchFilters(q,userId,f){
  if(f.type&&f.type!=='全部'&&q.type!==f.type)return false;
  if(f.diff&&f.diff!=='全部'&&q.difficulty!==f.diff)return false;
  if(f.chap&&f.chap!=='全部'&&!chapterMatch(q.chapter,f.chap))return false;
  if(f.judge&&f.judge!=='不限'&&q.type==='judge'&&q.answer!==f.judge)return false;
  if(f.result&&f.result!=='全部'){
    const a=latestAnswer(userId,q.id);
    if(f.result==='未做'&&a)return false;
    if(f.result==='答对'&&(!a||a.correct!==true))return false;
    if(f.result==='答错'&&(!a||a.correct!==false))return false;
  }
  return true;
}
function filterPanelHTML(bankIds,f,showJudge){
  const chaps=allChapters(bankIds);
  return `<div class="filter-grid">
    <div class="field" style="margin:0"><label class="small">题型</label><select class="input" id="fType">
      <option>全部</option>${TYPE_KEYS.map(t=>`<option value="${t}" ${f.type===t?'selected':''}>${TYPES[t]}</option>`).join('')}</select></div>
    <div class="field" style="margin:0"><label class="small">答题结果</label><select class="input" id="fResult">
      ${['全部','答对','答错','未做'].map(r=>`<option ${f.result===r?'selected':''}>${r}</option>`).join('')}</select></div>
    <div class="field" style="margin:0"><label class="small">判断题答案</label><select class="input" id="fJudge" ${showJudge?'':'disabled'}>
      ${['不限','正确','错误'].map(r=>`<option ${f.judge===r?'selected':''}>${r}</option>`).join('')}</select></div>
    <div class="field" style="margin:0"><label class="small">章节</label><select class="input" id="fChap">
      <option>全部</option>${chaps.map(c=>`<option ${f.chap===esc(c)?'selected':''}>${esc(c)}</option>`).join('')}</select></div>
    <div class="field" style="margin:0"><label class="small">难度</label><select class="input" id="fDiff">
      <option>全部</option>${DIFF_KEYS.map(d=>`<option value="${d}" ${f.diff===d?'selected':''}>${DIFFS[d]}</option>`).join('')}</select></div>
  </div>`;
}
function readFilters(){
  return {type:$('#fType').value,result:$('#fResult').value,judge:$('#fJudge').value,chap:$('#fChap').value,diff:$('#fDiff').value};
}
/* ---- 练习设置 ---- */
route('#/practice/setup/:bankId',bankId=>{
  if(!requireAuth())return;
  const b=bankById(bankId);
  if(!b||!canReadBank(b)){toast('题库不存在或分享已失效','err');location.hash='#/banks';return;}
  const u=currentUser();
  const pProg=progressFor(bankId,'practice');
  const rProg=progressFor(bankId,'recite');
  const f={type:'全部',result:'全部',judge:'不限',chap:'全部',diff:'全部'};
  const resumeHTML=(pProg||rProg)?`<div class="card" style="margin-bottom:14px">
      <h4 style="margin-bottom:8px">继续上次进度</h4>
      ${pProg?`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)">
        <span class="small">刷题：第 <strong>${pProg.idx+1}</strong> / ${pProg.qids.length} 题 · 已答 ${Object.keys(pProg.answers||{}).length} 题</span>
        <button class="btn sm primary" data-resume="practice">继续刷题</button></div>`:''}
      ${rProg?`<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:7px 0">
        <span class="small">背题：第 <strong>${rProg.idx+1}</strong> / ${rProg.qids.length} 题</span>
        <button class="btn sm" data-resume="recite">继续背题</button></div>`:''}
    </div>`:'';
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/bank/${bankId}'">← 返回题库</button></div>
    <h1 class="page-title">开始练习</h1><div class="page-sub">${esc(b.name)} · 共 ${bankQuestions(bankId).length} 题</div>
    ${resumeHTML}
    <div class="card">
      <h4 style="margin-bottom:10px">练习方式</h4>
      <div class="check-row" id="modeRow">
        <label><input type="radio" name="pmode" value="seq" checked> 顺序练习</label>
        <label><input type="radio" name="pmode" value="rand"> 随机练习</label>
        <label><input type="radio" name="pmode" value="special"> 专项练习</label>
        <label><input type="radio" name="pmode" value="recite"> 背题模式</label>
      </div>
      <div class="hint" style="margin-top:6px">进入练习后也可随时在顶部切换「刷题 / 背题」；两种模式分别记录进度</div>
      <div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
        <label class="small" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="autoNext"> 答对自动进入下一题</label>
        <label class="small" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="shuffleOpts"> 选项乱序</label>
        <label class="switch"><input type="checkbox" id="reciteOnly"><span class="track"></span><span>背题模式只显示正确选项</span></label>
      </div>
      <h4 style="margin:16px 0 10px">筛选条件（且关系）</h4>
      ${filterPanelHTML([bankId],f,true)}
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <span>匹配题量：<strong id="matchN" style="color:var(--brand);font-size:18px">0</strong></span>
        <span style="flex:1"></span>
        <button class="btn primary lg" id="startP" disabled>开始练习</button>
      </div>
    </div>`,'#/banks');
  $$('[data-resume]').forEach(btn=>btn.onclick=()=>{
    const p=loadPS(btn.dataset.resume);if(!p)return;
    PS=p;location.hash='#/practice/run';
  });
  const update=()=>{
    const ff=readFilters();
    $('#fJudge').disabled=ff.type!=='judge'&&ff.type!=='全部';
    const qs=bankQuestions(bankId).filter(q=>matchFilters(q,u.id,ff));
    $('#matchN').textContent=qs.length;
    $('#startP').disabled=!qs.length;
  };
  ['fType','fResult','fJudge','fChap','fDiff'].forEach(id=>$('#'+id).onchange=update);update();
  $('#autoNext').checked=localStorage.getItem('shutibao_autonext')==='1';
  $('#reciteOnly').checked=localStorage.getItem(RECITE_ONLY_KEY)==='1';
  $('#startP').onclick=()=>{
    const ff=readFilters();const mode=document.querySelector('input[name=pmode]:checked').value;
    const autoNext=$('#autoNext').checked; const shuffleOpts=$('#shuffleOpts').checked;
    localStorage.setItem('shutibao_autonext',autoNext?'1':'0');
    localStorage.setItem(RECITE_ONLY_KEY,$('#reciteOnly').checked?'1':'0');
    let qs=bankQuestions(bankId).filter(q=>matchFilters(q,u.id,ff));
    if(mode==='rand')qs=shuffle(qs);else qs.sort((a,c)=>a.order-c.order);
    const qids=qs.map(q=>q.id);
    PS={mode,scope:'bank',back:'#/bank/'+bankId,bankId,filters:ff,qids,idx:0,answers:{},startTs:nowTs(),autoNext,shuffleOpts,optMap:shuffleOpts?genOptMap(qids):null};
    savePS();location.hash='#/practice/run';
  };
});
/* ---- 错题练习设置 ---- */
route('#/practice/wrong',()=>{
  if(!requireAuth())return;
  refreshWrongValidity();
  const u=currentUser();
  const f={type:'全部',result:'全部',judge:'不限',chap:'全部',diff:'全部'};
  const wbIds=DB.wrongBook.filter(w=>w.userId===u.id&&w.status==='unmastered').map(w=>w.questionId);
  const qs0=wbIds.map(questionById).filter(Boolean);
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/wrongbook'">← 返回错题本</button></div>
    <h1 class="page-title">错题练习</h1><div class="page-sub">范围为「未掌握」错题，连续答对 ${DB.settings.wrongThreshold||2} 次标记为已掌握</div>
    <div class="card">
      ${filterPanelHTML([...new Set(qs0.map(q=>q.bankId))],f,true)}
      <div style="margin-top:10px"><label class="small" style="display:inline-flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" id="shuffleOpts"> 选项乱序</label></div>
      <div style="margin-top:14px;display:flex;align-items:center;gap:12px">
        <span>匹配题量：<strong id="matchN" style="color:var(--brand);font-size:18px">0</strong></span>
        <span style="flex:1"></span>
        <button class="btn primary lg" id="startP" disabled>开始错题练习</button>
      </div>
    </div>`,'#/wrongbook');
  const update=()=>{
    const ff=readFilters();
    $('#fJudge').disabled=ff.type!=='judge'&&ff.type!=='全部';
    $('#matchN').textContent=qs0.filter(q=>matchFilters(q,u.id,ff)).length;
    $('#startP').disabled=!+$('#matchN').textContent;
  };
  ['fType','fResult','fJudge','fChap','fDiff'].forEach(id=>$('#'+id).onchange=update);update();
  $('#startP').onclick=()=>{
    const ff=readFilters();
    const shuffleOpts=$('#shuffleOpts').checked;
    const ws=DB.wrongBook.filter(w=>w.userId===u.id&&w.status==='unmastered').sort((a,b)=>b.lastWrongTs-a.lastWrongTs);
    const qs=ws.map(w=>questionById(w.questionId)).filter(q=>q&&matchFilters(q,u.id,ff));
    const qids=qs.map(q=>q.id);
    PS={mode:'wrong',scope:'wrong',back:'#/wrongbook',bankId:null,filters:ff,qids,idx:0,answers:{},startTs:nowTs(),autoNext:localStorage.getItem('shutibao_autonext')==='1',shuffleOpts,optMap:shuffleOpts?genOptMap(qids):null};
    savePS();location.hash='#/practice/run';
  };
});
/* ---- 单题练习（搜题入口） ---- */
route('#/practice/one/:qid',qid=>{
  if(!requireAuth())return;
  const q=questionById(qid);
  if(!q||!canReadBank(bankById(q.bankId))){toast('题目不可用','err');location.hash='#/search';return;}
  PS={mode:'one',scope:'one',back:'#/bank/'+q.bankId,bankId:q.bankId,filters:{},qids:[qid],idx:0,answers:{},startTs:nowTs()};
  location.hash='#/practice/run';
});
/* ---- 收藏夹：按题库分组，可整组刷题/背题 ---- */
route('#/favorites',()=>{
  if(!requireAuth())return;
  const favs=myFavorites().filter(f=>{
    const q=questionById(f.questionId);const b=q&&bankById(q.bankId);
    return q&&b&&canReadBank(b);
  });
  const groups=[];const byBank={};
  favs.forEach(f=>{
    const q=questionById(f.questionId);const b=bankById(q.bankId);
    if(!byBank[q.bankId]){byBank[q.bankId]={bank:b,items:[]};groups.push(byBank[q.bankId]);}
    byBank[q.bankId].items.push({f,q});
  });
  const groupHTML=groups.map(g=>{
    const bid=g.bank.id;
    const pProg=progressFor(bid,'practice','fav');
    const rProg=progressFor(bid,'recite','fav');
    return `<div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="min-width:0">
          <h4 style="margin:0">${esc(g.bank.name)}</h4>
          <div class="small muted">收藏 ${g.items.length} 题 · ${isOwner(g.bank)?'自有':'共享'} · 点击题库名可查看题库</div>
        </div>
        <div class="btn-row" style="margin:0">
          <button class="btn sm primary" data-fav-start="${bid}" data-mode="practice">${pProg?`继续刷题（${pProg.idx+1}/${pProg.qids.length}）`:'刷题'}</button>
          <button class="btn sm" data-fav-start="${bid}" data-mode="recite">${rProg?`继续背题（${rProg.idx+1}/${rProg.qids.length}）`:'背题'}</button>
          <button class="btn sm ghost" data-locbank="${bid}">题库</button>
        </div>
      </div>
      <div style="margin-top:10px">
        ${g.items.map(({f,q})=>`<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid var(--line)">
          <div style="min-width:0">
            <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px">${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag gray">${esc(q.chapter||'未设置章节')}</span><span class="tag gray">收藏于 ${fmtTime(f.createdAt)}</span></div>
            <div style="font-weight:600">${esc(q.stem.slice(0,120))}${q.stem.length>120?'…':''}</div>
          </div>
          <div class="btn-row nowrap" style="margin:0">
            <button class="btn ghost sm" data-one="${q.id}">练这题</button>
            <button class="btn ghost sm" data-unfav="${q.id}">★</button>
          </div>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
  render(`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><h1 class="page-title">收藏题目</h1><div class="page-sub">共 ${favs.length} 题 · ${groups.length} 个题库 · 可按题库整组刷题/背题</div></div>
      ${favs.length?`<div class="btn-row" style="margin:0">
        <button class="btn sm primary" data-fav-start="" data-mode="practice">全部刷题</button>
        <button class="btn sm" data-fav-start="" data-mode="recite">全部背题</button>
      </div>`:''}
    </div>
    ${groups.length?groupHTML:`<div class="card empty"><div class="big">⭐</div><p>还没有收藏题目，可在刷题、背题、搜题、题库详情中点击「☆ 收藏」</p></div>`}`,'#/favorites');
  $$('[data-fav-start]').forEach(b=>b.onclick=()=>startFavPractice(b.dataset.favStart||null,b.dataset.mode==='recite'));
  $$('[data-one]').forEach(b=>b.onclick=()=>location.hash='#/practice/one/'+b.dataset.one);
  $$('[data-locbank]').forEach(b=>b.onclick=()=>location.hash='#/bank/'+b.dataset.locbank);
  $$('[data-unfav]').forEach(b=>b.onclick=()=>{
    const q=questionById(b.dataset.unfav);if(!q)return;
    toggleFav(q);toast('已取消收藏','ok');dispatch();
  });
});
/* 收藏练习：bankId 为空表示全部收藏；recite=true 进入背题 */
function startFavPractice(bankId,recite){
  const mode=recite?'recite':'practice';
  const saved=loadPS(mode,'fav');
  const canResume=saved&&Array.isArray(saved.qids)&&saved.qids.length&&(bankId?saved.bankId===bankId:!saved.bankId);
  if(canResume){PS=saved;location.hash='#/practice/run';return;}
  const qids=myFavorites().filter(f=>{
    const q=questionById(f.questionId);const b=q&&bankById(q.bankId);
    return q&&b&&canReadBank(b)&&(!bankId||q.bankId===bankId);
  }).map(f=>f.questionId);
  if(!qids.length){toast('没有可练习的收藏题目','warn');return;}
  PS={mode:recite?'recite':'fav',scope:'fav',retMode:'fav',back:'#/favorites',bankId:bankId||null,
      filters:{},qids,idx:0,answers:{},startTs:nowTs(),autoNext:false,shuffleOpts:false,optMap:null};
  savePS();location.hash='#/practice/run';
}
/* ---- 练习运行 ---- */
route('#/practice/run',()=>{
  if(!requireAuth())return;
  if(!PS)PS=loadPS('practice')||loadPS('practice','wrong')||loadPS('practice','fav')||loadPS('practice','one')
    ||loadPS('recite')||loadPS('recite','fav')||loadPS('recite','wrong')||loadPS('recite','one');
  if(!PS||!PS.qids.length){toast('没有进行中的练习','warn');location.hash='#/banks';return;}
  const backHash=PS.back||(PS.mode==='wrong'?'#/wrongbook':(PS.bankId?'#/bank/'+PS.bankId:'#/banks'));
  const qid=PS.qids[PS.idx];const q=questionById(qid);
  if(!q||!canReadBank(bankById(q.bankId))){
    if(PS.idx>=PS.qids.length-1){finishPractice();return;}
    toast(PS.bankId?'题库已删除或分享已失效，练习结束':'题目不可用','err');finishPractice();return;
  }
  const answered=PS.answers[qid];
  const bank=bankById(q.bankId);
  if(PS.mode==='recite'){renderRecite(q,bank);return;}
  const correctAnswerText=q=>q.type==='judge'?q.answer:q.type==='blank'?splitAccepted(q.answer).join(' / '):q.answer;
  render(`<div class="btn-row" style="margin-bottom:10px;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <button class="btn ghost" id="pExit">← 退出练习</button>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <button class="btn sm" id="pModeToggle">切换到背题模式</button>
        <button class="btn sm ghost" id="pFav">${isFav(qid)?'★ 已收藏':'☆ 收藏'}</button>
        <span class="small muted">${esc(bank?bank.name:'')}${PS.shuffleOpts?' · 选项乱序':''}</span>
      </div>
    </div>
    <div class="progress-line"><i style="width:${(PS.idx)/PS.qids.length*100}%"></i></div>
    <div class="small muted" style="margin-bottom:10px">第 ${PS.idx+1} / ${PS.qids.length} 题 · 已答 ${Object.keys(PS.answers).length}</div>
    <div class="q-card">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap">${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag gray">${esc(q.chapter||'未设置章节')}</span></div>
      <div class="q-stem">${esc(q.stem)}</div>
      <div id="ansArea"></div>
      <div id="fbArea"></div>
      <div class="btn-row" style="margin-top:16px">
        ${answered?'':`<button class="btn" id="pSkip">跳过</button><button class="btn primary" id="pSubmit">提交</button>`}
        ${answered?`<button class="btn primary" id="pNext">${PS.idx<PS.qids.length-1?'下一题':'完成练习'}</button>`:''}
      </div>
    </div>
    ${PS.qids.length>1?`<div class="card" style="margin-top:14px">
      <div class="small muted" style="margin-bottom:8px">答题卡 <span class="muted">（点击题号可跳转）</span></div>
      <div class="exam-nav">${PS.qids.map((id,i)=>`<button class="${PS.answers[id]?'done':''} ${PS.idx===i?'cur':''}" data-jump="${i}">${i+1}</button>`).join('')}</div>
    </div>`:''}`,backHash);
  // 答题卡跳转
  $$('[data-jump]').forEach(b=>b.onclick=()=>{PS.idx=+b.dataset.jump;savePS();dispatch();});
  // 答题卡自动滚动到当前题
  const nav=$('.exam-nav');const curBtn=nav&&nav.querySelector('button.cur');
  if(nav&&curBtn){const nr=nav.getBoundingClientRect(),br=curBtn.getBoundingClientRect();
    if(br.top<nr.top)nav.scrollTop-=nr.top-br.top+8;
    else if(br.bottom>nr.bottom)nav.scrollTop+=br.bottom-nr.bottom+8;}
  // 作答区
  const area=$('#ansArea');
  let sel=answered?answered.content:null;
  let selDisp=answered?(answered.disp||answered.content):null; // 展示字母/值（用于回显高亮）
  const optOrder=(PS.shuffleOpts&&PS.optMap&&PS.optMap[qid])||null;
  if(q.type==='single'||q.type==='multi'){
    const idxs=optOrder||q.options.map((_,i)=>i); // 展示位置 -> 原始下标
    const renderOpts=()=>{
      area.innerHTML=idxs.map((origIdx,pos)=>{
        const o=q.options[origIdx];
        const dispK=String.fromCharCode(65+pos); // 展示字母 A/B/C...
        const chosen=answered?String(selDisp||'').includes(dispK):String(sel||'').includes(o.k);
        let cls='opt';
        if(answered){
          if(String(q.answer).includes(o.k))cls+=' right';
          if(chosen&&!String(q.answer).includes(o.k))cls+=' wrong';
        }else if(chosen)cls+=' sel';
        return `<div class="${cls}" data-dispk="${dispK}" data-origk="${o.k}"><span class="k">${dispK}</span><span>${esc(o.t)}</span></div>`;
      }).join('');
      if(!answered){
        $$('#ansArea .opt').forEach(el=>el.onclick=()=>{
          const origK=el.dataset.origk, dispK=el.dataset.dispk;
          if(q.type==='single'){sel=origK;selDisp=dispK;}
          else{sel=sel||'';selDisp=selDisp||'';
            if(sel.includes(origK)){sel=sel.replace(origK,'');selDisp=selDisp.replace(dispK,'');}
            else{sel=[...sel+origK].sort().join('');selDisp=[...selDisp+dispK].sort().join('');}
          }
          renderOpts();
          if(q.type==='single')setTimeout(doSubmit,0); // 单选：点选后自动确认
        });
      }
    };
    renderOpts();
  }else if(q.type==='judge'){
    const order=optOrder||['正确','错误'];
    const renderJ=()=>{
      area.innerHTML=order.map(v=>{
        let cls='opt';
        if(answered){if(q.answer===v)cls+=' right';if(sel===v&&q.answer!==v)cls+=' wrong';}
        else if(sel===v)cls+=' sel';
        return `<div class="${cls}" data-v="${v}"><span class="k">${v==='正确'?'✓':'✗'}</span><span>${v}</span></div>`;
      }).join('');
      if(!answered)$$('#ansArea .opt').forEach(el=>el.onclick=()=>{sel=el.dataset.v;renderJ();setTimeout(doSubmit,0);}); // 判断：点选后自动确认
    };
    renderJ();
  }else{
    area.innerHTML=`<textarea class="input" id="ansText" placeholder="${q.type==='blank'?'请输入答案':'请输入你的作答，提交后对照参考答案自评'}" ${answered?'disabled':''}>${esc(answered?answered.content:'')}</textarea>`;
  }
  // 反馈区
  if(answered)showFeedback(q,answered);
  function showFeedback(q,a){
    const fb=$('#fbArea');
    if(q.type==='essay'){
      fb.innerHTML=`<div class="analysis-box"><strong>参考答案：</strong><br>${esc(q.answer)}</div>
        ${a.correct===null?`<div class="analysis-box"><strong>你的作答：</strong><br>${esc(a.content||'（未作答）')}</div>
        <div class="btn-row" style="margin-top:10px"><span class="small muted">请自评：</span>
          <button class="btn sm" id="selfOk">已掌握</button><button class="btn sm danger" id="selfBad">未掌握并加入错题本</button></div>`:''}
        ${q.analysis?`<div class="analysis-box"><strong>解析：</strong><br>${esc(q.analysis)}</div>`:''}`;
      const ok=$('#selfOk');if(ok)ok.onclick=()=>{PS.answers[q.id]={content:a.content,correct:null,self:'已掌握'};recordAnswer(q,a.content,null,'practice');savePS();showFeedback(q,{...a,correct:null});toast('已记录自评：已掌握','ok');$('#selfOk').parentElement.remove();};
      const bad=$('#selfBad');if(bad)bad.onclick=()=>{recordAnswer(q,a.content,false,'practice');savePS();toast('已加入错题本','ok');bad.parentElement.remove();};
    }else{
      const right=a.correct===true;
      fb.innerHTML=`<div class="feedback ${right?'ok':'bad'}"><strong>${right?'✓ 回答正确':'✗ 回答错误'}</strong>
        ${right?'':`<div style="margin-top:4px">正确答案：<strong>${esc(correctAnswerText(q))}</strong></div>`}</div>
        <div class="analysis-box"><strong>解析：</strong>${esc(q.analysis||'暂无解析')}</div>`;
    }
  }
  $('#pExit').onclick=()=>{
    if(Object.keys(PS.answers).length&&Object.keys(PS.answers).length<PS.qids.length){savePS();toast('进度已保存，可继续练习','ok');}
    else clearPS();
    PS=null;location.hash=backHash;
  };
  const skip=$('#pSkip');if(skip)skip.onclick=()=>{ // 跳过=未做
    if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
  };
  function doSubmit(){
    let content=sel;
    if(q.type==='blank'||q.type==='essay')content=$('#ansText').value;
    if(!content||!String(content).trim())return toast('请先作答','warn');
    const correct=gradeAnswer(q,content);
    const a={content,correct,disp:(q.type==='single'||q.type==='multi')?selDisp:content};
    PS.answers[q.id]=a;
    if(q.type!=='essay'){
      recordAnswer(q,content,correct,'practice');
      if(correct&&PS.mode==='wrong'){
        const w=DB.wrongBook.find(x=>x.userId===currentUser().id&&x.questionId===q.id);
        if(w){wrongCorrect(w);saveDB();if(w.status==='mastered')toast('连续答对达标，已标记为「已掌握」','ok');}
      }
    }
    savePS();
    // 答对自动下一题：单选/判断始终生效，其他题型按「答对自动下一题」开关
    if(correct===true&&(PS.autoNext||q.type==='single'||q.type==='judge')){
      const idx0=PS.idx,qid0=q.id;
      setTimeout(()=>{
        if(!PS||PS.idx!==idx0||!PS.answers[qid0])return;
        if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
      },700);
    }
    // 锁定并重绘
    dispatch();
  }
  const sub=$('#pSubmit');if(sub)sub.onclick=doSubmit;
  const nx=$('#pNext');if(nx)nx.onclick=()=>{
    if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
  };
  const mt=$('#pModeToggle');if(mt)mt.onclick=switchPracticeMode;
  const fav=$('#pFav');if(fav)fav.onclick=()=>{const on=toggleFav(q);toast(on?'已收藏':'已取消收藏','ok');dispatch();};
});
/* ---- 刷题 / 背题模式切换（同一会话保留题序与进度，分别存储） ---- */
function switchPracticeMode(){
  if(!PS)return;
  savePS();
  if(PS.mode!=='recite')PS.retMode=PS.mode;
  PS.mode=PS.mode==='recite'?(PS.retMode||'seq'):'recite';
  if(!PS.answers)PS.answers={};
  savePS();
  toast(PS.mode==='recite'?'已切换到背题模式':'已切换到刷题模式','ok');
  dispatch();
}
/* ---- 背题模式：直接展示答案与解析，不判分、不记录 ---- */
function renderRecite(q,bank){
  const bid=PS.bankId;
  const last=PS.idx>=PS.qids.length-1;
  const onlyCorrect=localStorage.getItem(RECITE_ONLY_KEY)==='1';
  const ansText=q.type==='judge'?q.answer:q.type==='blank'?splitAccepted(q.answer).join(' / '):(q.answer||'');
  const backHash=PS.back||(bid?'#/bank/'+bid:'#/banks');
  const optionHTML=(q.type==='single'||q.type==='multi')
    ? q.options.filter(o=>!onlyCorrect||String(q.answer).includes(o.k)).map(o=>`<div class="opt${String(q.answer).includes(o.k)?' right':''}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('')
    : '';
  render(`<div class="btn-row" style="margin-bottom:10px;justify-content:space-between;gap:10px">
      <button class="btn ghost" id="pExit">← 退出背题</button>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <button class="btn sm" id="pModeToggle">切换到刷题模式</button>
        <button class="btn sm ghost" id="pFav">${isFav(q.id)?'★ 已收藏':'☆ 收藏'}</button>
        <label class="switch"><input type="checkbox" id="reciteOnlyToggle" ${onlyCorrect?'checked':''}><span class="track"></span><span>仅显示正确选项</span></label>
        <span class="small muted">${esc(bank?bank.name:'')} · 背题模式</span>
      </div>
    </div>
    <div class="progress-line"><i style="width:${(PS.idx+1)/PS.qids.length*100}%"></i></div>
    <div class="small muted" style="margin-bottom:10px">第 ${PS.idx+1} / ${PS.qids.length} 题 · 已直接展示答案，不判分${onlyCorrect?' · 仅显示正确选项':''}</div>
    <div class="q-card">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap">${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag gray">${esc(q.chapter||'未设置章节')}</span></div>
      <div class="q-stem">${esc(q.stem)}</div>
      ${optionHTML}
      <div class="feedback ok" style="margin-top:10px"><strong>答案：${esc(ansText||'（略）')}</strong></div>
      <div class="analysis-box"><strong>解析：</strong>${esc(q.analysis||'暂无解析')}</div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" id="pPrev" ${PS.idx===0?'disabled':''}>上一题</button>
        <span style="flex:1"></span>
        <button class="btn primary" id="pNext">${last?'完成背题':'下一题'}</button>
      </div>
    </div>`,backHash);
  $('#pExit').onclick=()=>{savePS();PS=null;location.hash=backHash;};
  const mt=$('#pModeToggle');if(mt)mt.onclick=switchPracticeMode;
  const fav=$('#pFav');if(fav)fav.onclick=()=>{const on=toggleFav(q);toast(on?'已收藏':'已取消收藏','ok');dispatch();};
  $('#reciteOnlyToggle').onchange=e=>{localStorage.setItem(RECITE_ONLY_KEY,e.target.checked?'1':'0');dispatch();};
  $('#pPrev').onclick=()=>{if(PS.idx>0){PS.idx--;savePS();dispatch();}};
  $('#pNext').onclick=()=>{
    if(!last){PS.idx++;savePS();dispatch();}
    else{const n=PS.qids.length;clearPS();PS=null;toast(`背题完成，共浏览 ${n} 题`,'ok');location.hash=backHash;}
  };
}
function finishPractice(){
  const u=currentUser();const used=Math.round((nowTs()-PS.startTs)/1000);
  const entries=Object.entries(PS.answers).map(([qid,a])=>({q:questionById(qid),a})).filter(x=>x.q);
  const graded=entries.filter(x=>x.q.type!=='essay');
  const rightN=graded.filter(x=>x.a.correct===true).length;
  const wrongN=graded.filter(x=>x.a.correct===false).length;
  const undone=PS.qids.length-entries.length;
  const acc=graded.length?Math.round(rightN/graded.length*1000)/10:0;
  const wrongQids=entries.filter(x=>x.a.correct===false).map(x=>x.q.id);
  const backHash=PS.back||(PS.mode==='wrong'?'#/wrongbook':(PS.bankId?'#/bank/'+PS.bankId:'#/banks'));
  render(`<h1 class="page-title">练习报告</h1><div class="page-sub">用时 ${Math.floor(used/60)} 分 ${used%60} 秒</div>
    <div class="stat-row">
      <div class="stat"><b>${PS.qids.length}</b><span>总题量</span></div>
      <div class="stat"><b style="color:var(--green)">${rightN}</b><span>答对</span></div>
      <div class="stat"><b style="color:var(--red)">${wrongN}</b><span>答错</span></div>
      <div class="stat"><b>${undone}</b><span>未做</span></div>
      <div class="stat"><b style="color:var(--brand)">${acc}%</b><span>正确率</span></div>
    </div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>#</th><th>题干</th><th>题型</th><th>结果</th></tr></thead><tbody>
      ${PS.qids.map((qid,i)=>{const q=questionById(qid);const a=PS.answers[qid];
        const res=!a?'<span class="tag gray">未做</span>':q.type==='essay'?`<span class="tag amber">${a.self||'待自评'}</span>`:a.correct?'<span class="tag green">答对</span>':'<span class="tag red">答错</span>';
        return `<tr><td>${i+1}</td><td style="max-width:400px">${q?esc(q.stem.slice(0,50)):'原题已删除'}${q&&q.stem.length>50?'…':''}</td><td>${q?typeTag(q.type):''}</td><td>${res}</td></tr>`;}).join('')}
    </tbody></table></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" id="reWrong" ${wrongQids.length?'':'disabled'}>重练错题（${wrongQids.length}）</button>
      <button class="btn" onclick="location.hash='${backHash}'">返回</button>
    </div></div>`,backHash);
  clearPS();PS=null;
  $('#reWrong').onclick=()=>{
    PS={mode:'wrong',scope:'wrong',back:'#/wrongbook',bankId:null,filters:{},qids:wrongQids,idx:0,answers:{},startTs:nowTs()};
    savePS();location.hash='#/practice/run';
  };
}
/* ================= 错题本 ================= */
let wbStatus='unmastered',wbType='全部',wbBank='全部',wbPage=1,wbSel=new Set();
route('#/wrongbook',()=>{
  if(!requireAuth())return;
  refreshWrongValidity();
  const u=currentUser();
  let list=DB.wrongBook.filter(w=>w.userId===u.id);
  const counts={unmastered:list.filter(w=>w.status==='unmastered').length,mastered:list.filter(w=>w.status==='mastered').length,invalid:list.filter(w=>w.status==='invalid').length};
  list=list.filter(w=>w.status===wbStatus);
  const wbBankIds=[...new Set(list.map(w=>{const q=questionById(w.questionId);return q?q.bankId:null;}).filter(Boolean))];
  if(wbBank!=='全部'&&!wbBankIds.includes(wbBank))wbBank='全部';
  if(wbType!=='全部')list=list.filter(w=>{const q=questionById(w.questionId);return q&&q.type===wbType;});
  if(wbBank!=='全部')list=list.filter(w=>{const q=questionById(w.questionId);return q&&q.bankId===wbBank;});
  list.sort((a,b)=>b.lastWrongTs-a.lastWrongTs);
  const per=15,pages=Math.ceil(list.length/per);wbPage=Math.min(wbPage,Math.max(1,pages||1));
  const pageList=list.slice((wbPage-1)*per,wbPage*per);
  const pageIds=pageList.map(w=>w.id);
  /* 清理已不存在的选中项 */
  wbSel=new Set([...wbSel].filter(id=>DB.wrongBook.some(w=>w.id===id&&w.userId===u.id)));
  render(`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><h1 class="page-title">错题本</h1><div class="page-sub">答错自动收录；连续答对 ${DB.settings.wrongThreshold||2} 次标记已掌握</div></div>
      <button class="btn primary" id="wbPractice" ${counts.unmastered?'':'disabled'}>开始错题练习（${counts.unmastered}）</button>
    </div>
    <div class="tabs">
      <button class="tab ${wbStatus==='unmastered'?'active':''}" data-s="unmastered">未掌握（${counts.unmastered}）</button>
      <button class="tab ${wbStatus==='mastered'?'active':''}" data-s="mastered">已掌握（${counts.mastered}）</button>
      <button class="tab ${wbStatus==='invalid'?'active':''}" data-s="invalid">已失效（${counts.invalid}）</button>
    </div>
    <div class="card">
      <div class="filter-grid" style="margin-bottom:12px">
        <select class="input" id="wbType" style="max-width:180px"><option>全部</option>${TYPE_KEYS.map(t=>`<option value="${t}" ${wbType===t?'selected':''}>${TYPES[t]}</option>`).join('')}</select>
        <select class="input" id="wbBank" style="max-width:240px"><option>全部</option>${wbBankIds.map(id=>{const b=bankById(id);return b?`<option value="${id}" ${wbBank===id?'selected':''}>${esc(b.name)}</option>`:'';}).join('')}</select>
      </div>
      ${pageList.length?`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <span class="small muted">已选 <strong id="wbSelN" style="color:var(--brand)">0</strong> 题</span>
        <button class="btn sm danger" id="wbBatchRm" disabled>移除选中</button>
        <button class="btn sm ghost" id="wbBatchClear" disabled>清空选择</button>
        <span class="small muted">勾选表格首列可多选，表头勾选框可全选本页</span>
      </div>
      <div class="table-wrap"><table><thead><tr><th style="width:36px"><input type="checkbox" id="wbAll" title="全选本页"></th><th>题干</th><th>题型</th><th>错次数</th><th>连对</th><th>最近答错</th><th>操作</th></tr></thead><tbody>
        ${pageList.map(w=>{const q=questionById(w.questionId);const b=q&&bankById(q.bankId);
          return `<tr>
            <td><input type="checkbox" class="wb-ck" data-id="${w.id}" ${wbSel.has(w.id)?'checked':''}></td>
            <td style="max-width:340px">${q?esc(q.stem.slice(0,50))+(q.stem.length>50?'…':''):'<span class="muted">原题已删除</span>'}${b?`<div class="small muted">${esc(b.name)}</div>`:''}</td>
            <td>${q?typeTag(q.type):'-'}</td><td>${w.wrongCount}</td><td>${w.streak}/${DB.settings.wrongThreshold||2}</td>
            <td class="small">${fmtTime(w.lastWrongTs).slice(0,10)}</td>
            <td class="nowrap">
              ${q&&w.status!=='invalid'?`<button class="btn ghost sm" data-wbgo="${q.id}">练这题</button>`:''}
              ${w.status==='unmastered'?`<button class="btn ghost sm" data-wbmaster="${w.id}">标记已掌握</button>`:''}
              ${w.status==='mastered'?`<button class="btn ghost sm" data-wbunmaster="${w.id}">恢复未掌握</button>`:''}
              <button class="btn ghost sm danger" data-wbrm="${w.id}">移除</button>
            </td></tr>`;}).join('')}
      </tbody></table></div><div>${pager(list.length,wbPage,per,p=>{wbPage=p;dispatch();})}</div>`
      :`<div class="empty"><div class="big">✅</div><p>${wbStatus==='unmastered'?'暂无未掌握错题，保持住！':wbStatus==='mastered'?'暂无已掌握错题':'暂无已失效记录'}</p></div>`}
    </div>`,'#/wrongbook');
  $('#wbPractice').onclick=()=>location.hash='#/practice/wrong';
  $$('.tab[data-s]').forEach(t=>t.onclick=()=>{wbStatus=t.dataset.s;wbPage=1;wbSel.clear();dispatch();});
  $('#wbType').onchange=e=>{wbType=e.target.value;wbPage=1;wbSel.clear();dispatch();};
  $('#wbBank').onchange=e=>{wbBank=e.target.value;wbPage=1;wbSel.clear();dispatch();};
  $$('[data-wbgo]').forEach(b=>b.onclick=()=>location.hash='#/practice/one/'+b.dataset.wbgo);
  $$('[data-wbmaster]').forEach(b=>b.onclick=()=>{const w=DB.wrongBook.find(x=>x.id===b.dataset.wbmaster);w.status='mastered';saveDB();dispatch();});
  $$('[data-wbunmaster]').forEach(b=>b.onclick=()=>{const w=DB.wrongBook.find(x=>x.id===b.dataset.wbunmaster);w.status='unmastered';w.streak=0;saveDB();dispatch();});
  $$('[data-wbrm]').forEach(b=>b.onclick=()=>{DB.wrongBook=DB.wrongBook.filter(x=>x.id!==b.dataset.wbrm);wbSel.delete(b.dataset.wbrm);saveDB();toast('已移除','ok');dispatch();});
  /* ---- 批量选择与移除 ---- */
  const syncSelUI=()=>{
    const n=wbSel.size;
    const sn=$('#wbSelN');if(sn)sn.textContent=n;
    const rm=$('#wbBatchRm');if(rm)rm.disabled=!n;
    const cl=$('#wbBatchClear');if(cl)cl.disabled=!n;
    const all=$('#wbAll');if(all)all.checked=pageIds.length>0&&pageIds.every(id=>wbSel.has(id));
  };
  $$('.wb-ck').forEach(cb=>cb.onchange=()=>{
    if(cb.checked)wbSel.add(cb.dataset.id);else wbSel.delete(cb.dataset.id);
    syncSelUI();
  });
  const allBox=$('#wbAll');if(allBox)allBox.onchange=()=>{
    if(allBox.checked)pageIds.forEach(id=>wbSel.add(id));else pageIds.forEach(id=>wbSel.delete(id));
    $$('.wb-ck').forEach(cb=>cb.checked=wbSel.has(cb.dataset.id));
    syncSelUI();
  };
  const clr=$('#wbBatchClear');if(clr)clr.onclick=()=>{wbSel.clear();$$('.wb-ck').forEach(cb=>cb.checked=false);syncSelUI();};
  const brm=$('#wbBatchRm');if(brm)brm.onclick=()=>{
    const ids=[...wbSel];
    if(!ids.length)return;
    confirmBox('批量移除错题',`确认从错题本移除选中的 <strong>${ids.length}</strong> 条记录？移除后不可恢复。`,()=>{
      const set=new Set(ids);
      DB.wrongBook=DB.wrongBook.filter(x=>!(set.has(x.id)&&x.userId===u.id));
      wbSel.clear();saveDB();toast(`已移除 ${ids.length} 条错题记录`,'ok');dispatch();
    },'移除',true);
  };
  syncSelUI();
});
