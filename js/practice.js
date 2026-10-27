'use strict';
/* ================= 练习与错题本 ================= */
let PS=null; // {mode,bankId,filters,qids,idx,answers:{qid:{content,correct}},startTs}
const PKEY='shutibao_practice';
const RECITE_ONLY_KEY='shutibao_recite_only';
function savePS(){if(PS)localStorage.setItem(PKEY+'_'+currentUser().id,JSON.stringify(PS));}
function loadPS(){try{return JSON.parse(localStorage.getItem(PKEY+'_'+currentUser().id));}catch(e){return null;}}
function clearPS(){localStorage.removeItem(PKEY+'_'+currentUser().id);}
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
  const old=loadPS();
  if(old&&old.mode==='recite')clearPS(); // 背题模式不续练
  else if(old&&old.bankId===bankId&&old.qids.length&&Object.keys(old.answers).length<old.qids.length){
    confirmBox('继续上次练习？',`上次练习进行到第 ${old.idx+1} / ${old.qids.length} 题。`,()=>{PS=old;location.hash='#/practice/run';},'继续练习');
    render(`<div class="card empty"><div class="big">▶️</div><p>检测到未完成的练习</p><div class="btn-row" style="justify-content:center"><button class="btn" onclick="clearPS();dispatch()">放弃，重新设置</button></div></div>`,'#/banks');
    return;
  }
  const f={type:'全部',result:'全部',judge:'不限',chap:'全部',diff:'全部'};
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/bank/${bankId}'">← 返回题库</button></div>
    <h1 class="page-title">开始练习</h1><div class="page-sub">${esc(b.name)} · 共 ${bankQuestions(bankId).length} 题</div>
    <div class="card">
      <h4 style="margin-bottom:10px">练习方式</h4>
      <div class="check-row" id="modeRow">
        <label><input type="radio" name="pmode" value="seq" checked> 顺序练习</label>
        <label><input type="radio" name="pmode" value="rand"> 随机练习</label>
        <label><input type="radio" name="pmode" value="special"> 专项练习</label>
        <label><input type="radio" name="pmode" value="recite"> 背题模式</label>
      </div>
      <div class="hint" style="margin-top:6px">背题模式：直接展示答案与解析，不判分、不记录答题历史</div>
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
    PS={mode,bankId,filters:ff,qids,idx:0,answers:{},startTs:nowTs(),autoNext,shuffleOpts,optMap:shuffleOpts?genOptMap(qids):null};
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
    PS={mode:'wrong',bankId:null,filters:ff,qids,idx:0,answers:{},startTs:nowTs(),autoNext:localStorage.getItem('shutibao_autonext')==='1',shuffleOpts,optMap:shuffleOpts?genOptMap(qids):null};
    savePS();location.hash='#/practice/run';
  };
});
/* ---- 单题练习（搜题入口） ---- */
route('#/practice/one/:qid',qid=>{
  if(!requireAuth())return;
  const q=questionById(qid);
  if(!q||!canReadBank(bankById(q.bankId))){toast('题目不可用','err');location.hash='#/search';return;}
  PS={mode:'one',bankId:q.bankId,filters:{},qids:[qid],idx:0,answers:{},startTs:nowTs()};
  location.hash='#/practice/run';
});
/* ---- 练习运行 ---- */
route('#/practice/run',()=>{
  if(!requireAuth())return;
  if(!PS)PS=loadPS();
  if(!PS||!PS.qids.length){toast('没有进行中的练习','warn');location.hash='#/banks';return;}
  const qid=PS.qids[PS.idx];const q=questionById(qid);
  if(!q||!canReadBank(bankById(q.bankId))){
    if(PS.idx>=PS.qids.length-1){finishPractice();return;}
    toast(PS.bankId?'题库已删除或分享已失效，练习结束':'题目不可用','err');finishPractice();return;
  }
  const answered=PS.answers[qid];
  const bank=bankById(q.bankId);
  if(PS.mode==='recite'){renderRecite(q,bank);return;}
  const correctAnswerText=q=>q.type==='judge'?q.answer:q.type==='blank'?splitAccepted(q.answer).join(' / '):q.answer;
  render(`<div class="btn-row" style="margin-bottom:10px;justify-content:space-between">
      <button class="btn ghost" id="pExit">← 退出练习</button>
      <span class="small muted">${esc(bank?bank.name:'')}${PS.shuffleOpts?' · 选项乱序':''}</span>
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
    </div>`:''}`,PS.mode==='wrong'?'#/wrongbook':'#/banks');
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
      if(!answered)$$('#ansArea .opt').forEach(el=>el.onclick=()=>{sel=el.dataset.v;renderJ();});
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
    location.hash=PS.mode==='wrong'?'#/wrongbook':(PS.bankId?'#/bank/'+PS.bankId:'#/banks');
  };
  const skip=$('#pSkip');if(skip)skip.onclick=()=>{ // 跳过=未做
    if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
  };
  const sub=$('#pSubmit');if(sub)sub.onclick=()=>{
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
    // 答对自动下一题：短暂展示 √ 反馈后跳转；期间用户手动操作则取消
    if(correct===true&&PS.autoNext){
      const idx0=PS.idx,qid0=q.id;
      setTimeout(()=>{
        if(!PS||PS.idx!==idx0||!PS.answers[qid0])return;
        if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
      },700);
    }
    // 锁定并重绘
    dispatch();
  };
  const nx=$('#pNext');if(nx)nx.onclick=()=>{
    if(PS.idx<PS.qids.length-1){PS.idx++;savePS();dispatch();}else finishPractice();
  };
});
/* ---- 背题模式：直接展示答案与解析，不判分、不记录 ---- */
function renderRecite(q,bank){
  const bid=PS.bankId;
  const last=PS.idx>=PS.qids.length-1;
  const onlyCorrect=localStorage.getItem(RECITE_ONLY_KEY)==='1';
  const ansText=q.type==='judge'?q.answer:q.type==='blank'?splitAccepted(q.answer).join(' / '):(q.answer||'');
  const backHash=bid?'#/bank/'+bid:'#/banks';
  const optionHTML=(q.type==='single'||q.type==='multi')
    ? q.options.filter(o=>!onlyCorrect||String(q.answer).includes(o.k)).map(o=>`<div class="opt${String(q.answer).includes(o.k)?' right':''}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('')
    : '';
  render(`<div class="btn-row" style="margin-bottom:10px;justify-content:space-between;gap:10px">
      <button class="btn ghost" id="pExit">← 退出背题</button>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
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
  $('#pExit').onclick=()=>{clearPS();PS=null;location.hash=backHash;};
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
      <button class="btn" onclick="location.hash='${PS.mode==='wrong'?'#/wrongbook':(PS.bankId?'#/bank/'+PS.bankId:'#/banks')}'">返回</button>
    </div></div>`,PS.mode==='wrong'?'#/wrongbook':'#/banks');
  clearPS();PS=null;
  $('#reWrong').onclick=()=>{
    PS={mode:'seq',bankId:null,filters:{},qids:wrongQids,idx:0,answers:{},startTs:nowTs()};
    savePS();location.hash='#/practice/run';
  };
}
/* ================= 错题本 ================= */
let wbStatus='unmastered',wbType='全部',wbBank='全部',wbPage=1;
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
      ${pageList.length?`<div class="table-wrap"><table><thead><tr><th>题干</th><th>题型</th><th>错次数</th><th>连对</th><th>最近答错</th><th>操作</th></tr></thead><tbody>
        ${pageList.map(w=>{const q=questionById(w.questionId);const b=q&&bankById(q.bankId);
          return `<tr>
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
  $$('.tab[data-s]').forEach(t=>t.onclick=()=>{wbStatus=t.dataset.s;wbPage=1;dispatch();});
  $('#wbType').onchange=e=>{wbType=e.target.value;wbPage=1;dispatch();};
  $('#wbBank').onchange=e=>{wbBank=e.target.value;wbPage=1;dispatch();};
  $$('[data-wbgo]').forEach(b=>b.onclick=()=>location.hash='#/practice/one/'+b.dataset.wbgo);
  $$('[data-wbmaster]').forEach(b=>b.onclick=()=>{const w=DB.wrongBook.find(x=>x.id===b.dataset.wbmaster);w.status='mastered';saveDB();dispatch();});
  $$('[data-wbunmaster]').forEach(b=>b.onclick=()=>{const w=DB.wrongBook.find(x=>x.id===b.dataset.wbunmaster);w.status='unmastered';w.streak=0;saveDB();dispatch();});
  $$('[data-wbrm]').forEach(b=>b.onclick=()=>{DB.wrongBook=DB.wrongBook.filter(x=>x.id!==b.dataset.wbrm);saveDB();toast('已移除','ok');dispatch();});
});
