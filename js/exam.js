'use strict';
/* ================= 模拟考试 ================= */
let EX={banks:[],counts:{single:5,multi:2,judge:5,blank:2},scores:{single:1,multi:2,judge:1,blank:2},chaps:[],diffs:[],duration:90,passPct:60,name:''};
let examTimer=null;
route('#/exam/setup',()=>{
  if(!requireAuth())return;
  const urlBank=(location.hash.match(/bank=([^&]+)/)||[])[1];
  const readable=readableBanks().filter(b=>bankQuestions(b.id).length>0);
  EX={banks:urlBank?[urlBank]:[],counts:{single:5,multi:2,judge:5,blank:2},scores:{single:1,multi:2,judge:1,blank:2},chaps:[],diffs:[],duration:90,passPct:60,name:'模拟试卷 '+fmtTime(nowTs()).slice(5)};
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/papers'">← 返回试卷列表</button></div>
    <h1 class="page-title">生成模拟试卷</h1><div class="page-sub">从自有与共享题库中抽题，生成固定快照试卷；各题型题量与每题分值均可自定义，多选全对得分</div>
    <div class="card">
      <div class="field"><label>试卷名称</label><input class="input" id="exName" value="${esc(EX.name)}" maxlength="60"></div>
      <div class="field"><label>题库范围（可多选）</label>
        <div class="check-row" id="exBanks">${readable.length?readable.map(b=>`<label><input type="checkbox" value="${b.id}" ${EX.banks.includes(b.id)?'checked':''}> ${esc(b.name)}（${bankQuestions(b.id).length}）</label>`).join(''):'<span class="muted small">暂无有题目的题库</span>'}</div>
      </div>
      <div class="field"><label>题型、题量与每题分值（仅显示所选题库中实际存在的题型）</label>
        <div class="inline-fields" id="exCounts"></div>
        <div class="hint" id="exScoreSum"></div>
        <div class="hint">简答题不进入自动判分试卷</div>
      </div>
      <div class="inline-fields">
        <div class="field"><label>章节范围</label><select class="input" id="exChap" multiple size="4"></select><div class="hint">按住 Ctrl 多选；不选即全部</div></div>
        <div class="field"><label>难度范围</label><select class="input" id="exDiff" multiple size="4">${DIFF_KEYS.map(d=>`<option value="${d}">${DIFFS[d]}</option>`).join('')}</select><div class="hint">不选即全部</div></div>
      </div>
      <div class="inline-fields">
        <div class="field"><label>考试时长（分钟，1–300）</label><input class="input" id="exDur" type="number" min="1" max="300" value="90"></div>
        <div class="field"><label>及格线（总分百分比）</label><input class="input" id="exPass" type="number" min="1" max="100" value="60"></div>
      </div>
      <div style="margin-top:10px"><label class="switch"><input type="checkbox" id="exShuffle"><span class="track"></span><span>选项乱序（生成时打乱每题的单选/多选选项顺序）</span></label></div>
      <div style="margin-top:10px"><label class="switch"><input type="checkbox" id="exRand"><span class="track"></span><span>开启「重考随机抽题」（再考时按相同配置重新随机抽题）</span></label></div>
      <div id="exGap"></div>
      <div class="modal-foot" style="justify-content:flex-end"><button class="btn primary lg" id="exGen">生成试卷</button></div>
    </div>`,'#/papers');
  const ALL_TYPES=['single','multi','judge','blank'];
  const DEF_COUNTS={single:5,multi:2,judge:5,blank:2};
  const DEF_SCORES={single:1,multi:2,judge:1,blank:2};
  const readCountInputs=()=>{ // 同步输入框到 EX，供切换题库/筛选时保留用户已填数值
    $$('.ex-count').forEach(i=>{EX.counts[i.dataset.t]=Math.max(0,+i.value||0);});
    $$('.ex-score').forEach(i=>{EX.scores[i.dataset.t]=Math.max(0.5,+i.value||1);});
  };
  const updateScoreSum=()=>{
    const total=ALL_TYPES.reduce((a,t)=>a+(EX.counts[t]||0)*(EX.scores[t]||1),0);
    const el=$('#exScoreSum');if(el)el.textContent=total>0?`预计满分：${Math.round(total*10)/10} 分（及格线按总分的百分比折算）`:'';
  };
  /* 题型行按当前题库实际拥有的题型渲染，题库没有的题型不出现 */
  const renderTypeRows=pool=>{
    const by={};ALL_TYPES.forEach(t=>by[t]=pool.filter(q=>q.type===t).length);
    const types=ALL_TYPES.filter(t=>by[t]>0);
    ALL_TYPES.forEach(t=>{if(by[t]<=0)EX.counts[t]=0;});
    const box=$('#exCounts');if(!box)return;
    if(!types.length){
      box.innerHTML='<div class="hint">所选题库中暂无可用于自动判分的题目（简答题不参与抽题）</div>';
      updateScoreSum();return;
    }
    box.innerHTML=types.map(t=>{
      const maxN=by[t];
      const cnt=Math.min(EX.counts[t]??DEF_COUNTS[t],maxN);
      EX.counts[t]=cnt;
      const sc=EX.scores[t]??DEF_SCORES[t];
      return `<div class="field"><label class="small">${TYPES[t]} <span class="muted">(可用 ${maxN})</span></label>
        <div style="display:flex;align-items:center;gap:4px">
          <input class="input ex-count" data-t="${t}" type="number" min="0" max="${maxN}" value="${cnt}" style="width:64px" title="题量">
          <span class="small muted nowrap">题 ×</span>
          <input class="input ex-score" data-t="${t}" type="number" min="0.5" step="0.5" value="${sc}" style="width:64px" title="每题分值">
          <span class="small muted nowrap">分</span>
        </div></div>`;
    }).join('');
    $$('.ex-count').forEach(i=>i.oninput=()=>{EX.counts[i.dataset.t]=Math.max(0,+i.value||0);updateScoreSum();});
    $$('.ex-score').forEach(i=>i.oninput=()=>{EX.scores[i.dataset.t]=Math.max(0.5,+i.value||1);updateScoreSum();});
    updateScoreSum();
  };
  const poolQuestions=()=>{
    const selChaps=[...($('#exChap')?$('#exChap').selectedOptions:[])].map(o=>o.value);
    const selDiffs=[...($('#exDiff')?$('#exDiff').selectedOptions:[])].map(o=>o.value);
    let pool=[];
    EX.banks.forEach(bid=>{if(canReadBank(bankById(bid)))pool=pool.concat(bankQuestions(bid));});
    pool=pool.filter(q=>q.type!=='essay');
    if(selChaps.length)pool=pool.filter(q=>selChaps.some(c=>chapterMatch(q.chapter,c)));
    if(selDiffs.length)pool=pool.filter(q=>selDiffs.includes(q.difficulty));
    const seen=new Set();pool=pool.filter(q=>{const k=dedupeKey(q);if(seen.has(k))return false;seen.add(k);return true;});
    return pool;
  };
  const updateAvail=()=>{
    EX.banks=$$('#exBanks input:checked').map(i=>i.value);
    readCountInputs();
    const pool=poolQuestions();
    renderTypeRows(pool);
    return pool;
  };
  const refreshChaps=()=>{
    EX.banks=$$('#exBanks input:checked').map(i=>i.value);
    const chaps=allChapters(EX.banks);
    $('#exChap').innerHTML=chaps.map(c=>`<option>${esc(c)}</option>`).join('');
    updateAvail();
  };
  $$('#exBanks input').forEach(i=>i.onchange=refreshChaps);
  refreshChaps();updateScoreSum();
  $('#exChap').onchange=updateAvail;$('#exDiff').onchange=updateAvail;
  $('#exGen').onclick=async()=>{
    EX.name=$('#exName').value.trim()||EX.name;
    EX.duration=Math.min(300,Math.max(1,+$('#exDur').value||90));
    EX.passPct=Math.min(100,Math.max(1,+$('#exPass').value||60));
    readCountInputs(); // 以界面当前题型题量为准（不存在的题型已被置 0）
    if(!EX.banks.length)return toast('请至少选择 1 个题库','err');
    const totalWanted=Object.values(EX.counts).reduce((a,b)=>a+b,0);
    if(totalWanted<1)return toast('总题量至少为 1 题','err');
    const selChaps=[...($('#exChap')?$('#exChap').selectedOptions:[])].map(o=>o.value);
    const selDiffs=[...($('#exDiff')?$('#exDiff').selectedOptions:[])].map(o=>o.value);
    $('#exGen').disabled=true;
    try{
      await flushSave();
      const r=await apiPost('exam/create',{name:EX.name,banks:EX.banks,counts:EX.counts,scores:EX.scores,chaps:selChaps,diffs:selDiffs,duration:EX.duration,passPct:EX.passPct,randomOnRetake:$('#exRand').checked,shuffleOpts:$('#exShuffle').checked});
      if(!r.ok){
        if(r.gaps){
          $('#exGap').innerHTML=`<div class="feedback bad" style="margin-top:10px"><strong>题量不足，无法生成：</strong>${r.gaps.map(g=>`${TYPES[g.t]} 需求 ${g.want} / 可用 ${g.have} / 缺口 ${g.want-g.have}`).join('；')}。请减少题量或放宽筛选。</div>`;
          return;
        }
        return toast(r.error||'生成失败','err');
      }
      $('#exGap').innerHTML='';
      DB.papers.push(r.paper);baseline();
      toast('试卷已生成，可在试卷列表中开始考试','ok');location.hash='#/papers';
    }catch(e){toast(e.message,'err');}
    finally{$('#exGen').disabled=false;}
  };
});
/* ---- 考试运行 ---- */
route('#/exam/run/:rid',rid=>{
  if(!requireAuth())return;
  const rec=DB.examRecords.find(r=>r.id===rid&&r.userId===currentUser().id);
  if(!rec){toast('考试记录不存在','err');location.hash='#/exams';return;}
  const paper=DB.papers.find(p=>p.id===rec.paperId);
  if(!paper){toast('试卷已删除','err');location.hash='#/papers';return;}
  if(rec.status!=='ongoing'){location.hash='#/exam/result/'+rid;return;}
  if(rec.deadline<=nowTs()){submitExam(rec,true).then(()=>location.hash='#/exam/result/'+rid).catch(()=>{});return;}
  // 随机重考：本次考试使用记录里的抽题快照；否则沿用试卷快照
  const qs=(Array.isArray(rec.questions)&&rec.questions.length)?rec.questions:paper.questions;
  const total=qs.length;
  let cur=+(sessionStorage.getItem('exam_cur_'+rid)||0);
  if(cur<0||cur>=total)cur=0;
  const q=qs[cur];
  const ans=rec.answers[q.qid];
  render(`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div><strong style="font-size:16px">${esc(paper.name)}</strong><div class="small muted">共 ${total} 题 · 满分 ${paper.totalScore??paper.total} 分 · 及格 ${paper.passScore} 分${Array.isArray(rec.questions)&&rec.questions.length?' · 本次随机抽题':''}</div></div>
      <div class="timer" id="exTimer">--:--</div>
    </div>
    <div class="progress-line"><i style="width:${cur/total*100}%"></i></div>
    <div class="q-card">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap"><span class="tag gray">第 ${cur+1} 题</span>${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag amber">${q.score} 分</span></div>
      <div class="q-stem">${esc(q.stem)}</div>
      <div id="exAns"></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" id="exPrev" ${cur===0?'disabled':''}>上一题</button>
        <button class="btn" id="exNext" ${cur===total-1?'disabled':''}>下一题</button>
        <span style="flex:1"></span>
        <button class="btn accent" id="exSubmit">交卷</button>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><strong class="small">题目导航</strong><span class="small muted">（已答 ${Object.keys(rec.answers).length} / 未答 ${total-Object.keys(rec.answers).length}）</span>
      <div class="exam-nav">${qs.map((qq,i)=>`<button class="${rec.answers[qq.qid]?'done':''} ${i===cur?'cur':''}" data-jump="${i}">${i+1}</button>`).join('')}</div>
    </div>`,'#/papers');
  // 作答区（逐题保存，可修改）
  const area=$('#exAns');
  const saveAns=c=>{if(c&&String(c).trim())rec.answers[q.qid]={content:c,ts:nowTs()};else delete rec.answers[q.qid];saveDB();};
  const autoNext=()=>{ // 单选/判断点选后自动确认并进入下一题
    if(cur>=total-1)return;
    setTimeout(()=>{sessionStorage.setItem('exam_cur_'+rid,cur+1);dispatch();},260);
  };
  if(q.type==='single'||q.type==='multi'){
    let sel=ans?ans.content:'';
    const r=()=>{area.innerHTML=q.options.map(o=>`<div class="opt${String(sel).includes(o.k)?' sel':''}" data-k="${o.k}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('');
      $$('#exAns .opt').forEach(el=>el.onclick=()=>{const k=el.dataset.k;
        if(q.type==='single')sel=k;else sel=sel.includes(k)?sel.replace(k,''):[...sel+k].sort().join('');
        saveAns(sel);r();refreshNav();
        if(q.type==='single')autoNext();});};
    r();
  }else if(q.type==='judge'){
    let sel=ans?ans.content:'';
    const r=()=>{area.innerHTML=['正确','错误'].map(v=>`<div class="opt${sel===v?' sel':''}" data-v="${v}"><span class="k">${v==='正确'?'✓':'✗'}</span><span>${v}</span></div>`).join('');
      $$('#exAns .opt').forEach(el=>el.onclick=()=>{sel=el.dataset.v;saveAns(sel);r();refreshNav();autoNext();});};
    r();
  }else{
    area.innerHTML=`<textarea class="input" id="exText">${esc(ans?ans.content:'')}</textarea>`;
    $('#exText').oninput=e=>saveAns(e.target.value);
    $('#exText').onchange=e=>{saveAns(e.target.value);refreshNav();};
  }
  function refreshNav(){
    $$('.exam-nav button').forEach((b,i)=>b.classList.toggle('done',!!rec.answers[qs[i].qid]));
  }
  $$('[data-jump]').forEach(b=>b.onclick=()=>{sessionStorage.setItem('exam_cur_'+rid,b.dataset.jump);dispatch();});
  // 答题卡自动滚动到当前题
  const nav=$('.exam-nav');const curBtn=nav&&nav.querySelector('button.cur');
  if(nav&&curBtn){const nr=nav.getBoundingClientRect(),br=curBtn.getBoundingClientRect();
    if(br.top<nr.top)nav.scrollTop-=nr.top-br.top+8;
    else if(br.bottom>nr.bottom)nav.scrollTop+=br.bottom-nr.bottom+8;}
  $('#exPrev').onclick=()=>{sessionStorage.setItem('exam_cur_'+rid,cur-1);dispatch();};
  $('#exNext').onclick=()=>{sessionStorage.setItem('exam_cur_'+rid,cur+1);dispatch();};
  $('#exSubmit').onclick=()=>{
    const undone=total-Object.keys(rec.answers).length;
    confirmBox('确认交卷？',`未作答 <strong>${undone}</strong> 题，交卷后不可修改答案。`,async()=>{await submitExam(rec,false).catch(()=>{});location.hash='#/exam/result/'+rid;},'确认交卷');
  };
  if(examTimer)clearInterval(examTimer);
  examTimer=setInterval(()=>{
    const left=rec.deadline-nowTs();
    const el=$('#exTimer');if(!el){clearInterval(examTimer);return;}
    if(left<=0){clearInterval(examTimer);submitExam(rec,true).then(()=>{toast('时间到，已自动交卷','warn');location.hash='#/exam/result/'+rid;}).catch(()=>{});return;}
    const m=Math.floor(left/60000),s=Math.floor(left%60000/1000);
    el.textContent=`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    el.style.color=left<300000?'var(--red)':'var(--accent)';
  },1000);
});
async function submitExam(rec,timeout){
  if(rec.status!=='ongoing')return; // 幂等：重复交卷不产生新结果
  rec.status=timeout?'timeout':'submitted'; // 先本地锁定，防止重复点击
  try{
    await flushSave(); // 确保最新作答已上传，服务端按最新答案判分
    const r=await apiPost('exam/submit',{recordId:rec.id});
    if(!r.ok)throw new Error(r.error||'交卷失败');
    await fullSync(); // 拉回判分结果与完整试卷（含答案解析，供成绩报告使用）
  }catch(e){
    rec.status='ongoing';
    toast('交卷失败：'+e.message+'，请重试','err');
    if(examTimer){clearInterval(examTimer);examTimer=null;}
    dispatch();
    throw e;
  }
  if(examTimer){clearInterval(examTimer);examTimer=null;}
}
/* ---- 成绩报告 ---- */
route('#/exam/result/:rid',rid=>{
  if(!requireAuth())return;
  const me=currentUser();
  const rec=DB.examRecords.find(r=>r.id===rid&&(r.userId===me.id||(paperById(r.paperId)||{}).userId===me.id));
  if(!rec){toast('考试记录不存在','err');location.hash='#/exams';return;}
  if(rec.status==='ongoing'){
    if(rec.userId===me.id){location.hash='#/exam/run/'+rid;return;}
    toast('该考生仍在考试中，暂无成绩','warn');location.hash='#/exams';return;
  }
  const paper=paperById(rec.paperId);
  if(!paper){toast('试卷已删除','err');location.hash='#/exams';return;}
  const qs=(Array.isArray(rec.questions)&&rec.questions.length)?rec.questions:paper.questions;
  const total=qs.length;
  const used=Math.round(((rec.submittedAt||nowTs())-rec.startedAt)/1000);
  let rightN=0;const per={};
  qs.forEach(q=>{
    const a=rec.answers[q.qid];
    const right=a?gradeAnswer({type:q.type,answer:q.answer},a.content):false;
    if(right)rightN++;
    per[q.type]=per[q.type]||{total:0,right:0,wrong:0,undone:0};
    per[q.type].total++;if(!a)per[q.type].undone++;else if(right)per[q.type].right++;else per[q.type].wrong++;
  });
  const acc=total?Math.round(rightN/total*1000)/10:0;
  const pass=rec.score>=paper.passScore;
  const randOn=!!(paper.config&&paper.config.randomOnRetake);
  const ansText=(q,c)=>{
    if(!c)return '<span class="muted">未作答</span>';
    if(q.type==='judge')return esc(c);
    if(q.type==='blank')return esc(c);
    return esc(c);
  };
  render(`<h1 class="page-title">成绩报告</h1><div class="page-sub">${esc(paper.name)} · ${rec.status==='timeout'?'<span class="tag red">已超时交卷</span>':'<span class="tag green">已交卷</span>'} · 用时 ${Math.floor(used/60)} 分 ${used%60} 秒${Array.isArray(rec.questions)&&rec.questions.length?' · 本次随机抽题':''}</div>
    <div class="stat-row">
      <div class="stat"><b style="color:${pass?'var(--green)':'var(--red)'}">${rec.score}</b><span>得分 / ${paper.totalScore??paper.total} 分</span></div>
      <div class="stat"><b>${acc}%</b><span>正确率</span></div>
      <div class="stat"><b style="color:${pass?'var(--green)':'var(--red)'}">${pass?'及格':'未及格'}</b><span>及格线 ${paper.passScore} 分</span></div>
      <div class="stat"><b style="color:var(--green)">${rightN}</b><span>答对</span></div>
      <div class="stat"><b style="color:var(--red)">${total-rightN}</b><span>答错/未答</span></div>
    </div>
    <div class="card"><h4 style="margin-bottom:8px">题型拆分</h4>
      <div class="table-wrap"><table><thead><tr><th>题型</th><th>题量</th><th>答对</th><th>答错</th><th>未答</th><th>得分</th></tr></thead><tbody>
      ${Object.entries(per).map(([t,p])=>{const sq=qs.find(x=>x.type===t);const sc=sq?sq.score:1;
        return `<tr><td>${TYPES[t]}</td><td>${p.total}</td><td>${p.right}</td><td>${p.wrong}</td><td>${p.undone}</td><td>${Math.round(p.right*sc*10)/10} / ${Math.round(p.total*sc*10)/10}</td></tr>`;}).join('')}
      </tbody></table></div></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h4>逐题解析</h4><label class="small" style="cursor:pointer"><input type="checkbox" id="onlyWrong"> 只看错题</label></div>
      <div id="qList"></div></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" id="reExam">再考一次${randOn?'（重新随机抽题）':'（同一试卷）'}</button>
      <button class="btn" id="exExpQ">导出试卷（无答案）</button>
      <button class="btn" id="exExpA">导出试卷（含答案解析）</button>
      <button class="btn" onclick="location.hash='#/exams'">返回考试记录</button>
    </div>`,'#/exams');
  const renderList=(onlyWrong)=>{
    $('#qList').innerHTML=qs.map((q,i)=>{
      const a=rec.answers[q.qid];
      const right=a?gradeAnswer({type:q.type,answer:q.answer},a.content):false;
      if(onlyWrong&&right)return'';
      return `<div style="border-top:1px solid var(--line);padding:12px 0">
        <div class="meta" style="display:flex;gap:6px;margin-bottom:6px"><span class="tag gray">第 ${i+1} 题</span>${typeTag(q.type)}${right?'<span class="tag green">答对</span>':'<span class="tag red">答错</span>'}</div>
        <div style="font-weight:600;margin-bottom:6px">${esc(q.stem)}</div>
        ${(q.options||[]).map(o=>`<div class="small" style="padding:2px 0;${String(q.answer).includes(o.k)?'color:var(--green);font-weight:600':''}">${o.k}. ${esc(o.t)}</div>`).join('')}
        <div class="small" style="margin-top:6px">我的答案：${ansText(q,a?a.content:null)} ｜ 正确答案：<strong>${esc(q.answer)}</strong></div>
        <div class="small muted" style="margin-top:4px">解析：${esc(q.analysis||'暂无解析')}</div>
      </div>`;}).join('')||'<p class="muted small">全部答对，没有错题 🎉</p>';
  };
  renderList(false);
  $('#onlyWrong').onchange=e=>renderList(e.target.checked);
  const exportSrc={...paper,questions:qs,total};
  $('#exExpQ').onclick=()=>exportPaper(exportSrc,false);
  $('#exExpA').onclick=()=>exportPaper(exportSrc,true);
  $('#reExam').onclick=()=>{startTemplateExam(paper.id).catch(e=>toast(e.message,'err'));};
});
/* ---- 导出试卷为 Word（.doc）；withAnswer=true 时答案与解析紧跟每题之后 ---- */
function exportPaper(paper,withAnswer){
  const total=paper.totalScore??paper.total;
  const qHtml=paper.questions.map((q,i)=>{
    let body=`<div class="q"><div class="stem">${i+1}. ${esc(q.stem)} <span class="meta">[${TYPES[q.type]} · ${q.score} 分]</span></div>`;
    if(q.type==='single'||q.type==='multi')body+=q.options.map(o=>`<div class="opt">${o.k}. ${esc(o.t)}</div>`).join('');
    else if(!withAnswer)body+=q.type==='judge'?`<div class="opt">（　　）</div>`:`<div class="opt">答：____________________________</div>`;
    if(withAnswer){
      const ans=q.type==='blank'?splitAccepted(q.answer).join(' / '):q.answer;
      body+=`<div class="ans">答案：<strong>${esc(ans||'（略）')}</strong></div>`;
      if(q.analysis)body+=`<div class="ana">解析：${esc(q.analysis)}</div>`;
    }
    return body+'</div>';
  }).join('');
  const html=`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(paper.name)}</title><style>
body{font-family:"Microsoft YaHei",sans-serif;color:#222;line-height:1.7}
h1{font-size:20pt;text-align:center;margin-bottom:4pt}.info{text-align:center;color:#666;font-size:10.5pt;margin-bottom:18pt}
.q{margin-bottom:14pt}.stem{font-weight:600}.meta{font-weight:400;color:#888;font-size:9pt}.opt{padding-left:1.5em}
.ans{color:#1a7f37;padding-left:1.5em}.ana{color:#555;font-size:10.5pt;padding-left:1.5em}
</style></head><body><h1>${esc(paper.name)}</h1>
<div class="info">共 ${paper.questions.length} 题 · 满分 ${total} 分 · 及格 ${paper.passScore} 分 · 时长 ${paper.config.duration} 分钟</div>
${qHtml}</body></html>`;
  const blob=new Blob(['\ufeff'+html],{type:'application/msword'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${paper.name.replace(/[\\/:*?"<>|]/g,'_')}${withAnswer?'（含答案解析）':'（无答案）'}.doc`;
  a.click();URL.revokeObjectURL(a.href);
  toast('试卷已导出为 Word 文档','ok');
}
/* ---- 试卷列表 ---- */
let paperTab='mine';
route('#/papers',()=>{
  if(!requireAuth())return;
  const u=currentUser();
  const mine=myPapers().sort((a,b)=>b.createdAt-a.createdAt);
  const shared=sharedPapers().sort((a,b)=>b.createdAt-a.createdAt);
  const list=paperTab==='mine'?mine:shared;
  const cards=list.map(p=>{
    const own=p.userId===u.id;
    const owner=DB.users.find(x=>x.id===p.userId);
    const myRecs=DB.examRecords.filter(r=>r.paperId===p.id&&r.userId===u.id);
    const allRecs=DB.examRecords.filter(r=>r.paperId===p.id);
    const sh=DB.paperShares.filter(s=>s.paperId===p.id&&s.status==='active').length;
    const ongoing=myRecs.find(r=>r.status==='ongoing');
    const randOn=!!(p.config&&p.config.randomOnRetake);
    return `<div class="bank-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h4>${esc(p.name)}</h4>${own?'<span class="tag">我创建</span>':`<span class="tag accent">来自 ${esc(owner?owner.nickname||owner.username:'未知')}</span>`}</div>
      <div class="meta"><span class="tag gray">${p.total} 题</span><span class="tag gray">满分 ${p.totalScore??p.total}</span><span class="tag gray">${(p.config&&p.config.duration)||90} 分钟</span>${randOn?'<span class="tag accent">重考随机抽题</span>':''}${p.config&&p.config.shuffleOpts?'<span class="tag">选项乱序</span>':''}${own&&sh?`<span class="tag green">已共享 ${sh}</span>`:''}</div>
      <div class="small muted">创建于 ${fmtTime(p.createdAt)} ｜ 我的考试 ${myRecs.length} 次${own?` ｜ 全部记录 ${allRecs.length} 条`:''}</div>
      <div class="btn-row">
        <button class="btn primary sm" data-start="${p.id}">${ongoing?'继续考试':'开始考试'}</button>
        <button class="btn sm" data-records="${p.id}">考试记录${own&&allRecs.length?`（${allRecs.length}）`:''}</button>
        ${own?`<button class="btn sm" data-share="${p.id}">共享</button><button class="btn ghost sm danger" data-delpaper="${p.id}">删除</button>`
          :`<button class="btn ghost sm danger" data-remove="${p.id}">移除</button>`}
      </div>
      ${own?`<label class="switch" style="margin-top:8px"><input type="checkbox" data-rand="${p.id}" ${randOn?'checked':''}><span class="track"></span><span class="small">重考/共享重考时随机抽题</span></label>`:''}
    </div>`;
  }).join('');
  render(`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div><h1 class="page-title">模拟考试</h1><div class="page-sub">试卷创建后在此展示，可直接按模板开考；共享试卷可被他人考试，创建者可查看每个人的记录</div></div>
      <button class="btn primary" id="newPaper">＋ 新建试卷</button>
    </div>
    <div class="tabs">
      <button class="tab ${paperTab==='mine'?'active':''}" data-t="mine">我的试卷（${mine.length}）</button>
      <button class="tab ${paperTab==='shared'?'active':''}" data-t="shared">共享给我（${shared.length}）</button>
    </div>
    ${list.length?`<div class="grid-cards">${cards}</div>`
      :`<div class="card empty"><div class="big">📝</div><p>${paperTab==='mine'?'还没有试卷，先生成一份吧':'别人共享给你的试卷会出现在这里'}</p>${paperTab==='mine'?'<div class="btn-row" style="justify-content:center"><button class="btn primary" onclick="location.hash=\'#/exam/setup\'">生成试卷</button></div>':''}</div>`}`,'#/papers');
  $$('.tab[data-t]').forEach(t=>t.onclick=()=>{paperTab=t.dataset.t;dispatch();});
  $('#newPaper').onclick=()=>{location.hash='#/exam/setup';};
  $$('[data-start]').forEach(b=>b.onclick=()=>startTemplateExam(b.dataset.start).catch(e=>toast(e.message,'err')));
  $$('[data-rand]').forEach(cb=>cb.onchange=()=>{
    const p=paperById(cb.dataset.rand);if(!p)return;
    p.config=p.config||{};p.config.randomOnRetake=cb.checked;
    saveDB();toast(cb.checked?'已开启：重考时随机抽题':'已关闭：重考沿用同一套题','ok');dispatch();
  });
  $$('[data-records]').forEach(b=>b.onclick=()=>location.hash='#/exams/paper/'+b.dataset.records);
  $$('[data-share]').forEach(b=>b.onclick=()=>sharePaper(paperById(b.dataset.share)));
  $$('[data-delpaper]').forEach(b=>b.onclick=()=>{
    const p=paperById(b.dataset.delpaper);if(!p)return;
    confirmBox('删除试卷',`删除后不可恢复，相关考试记录将无法查看。确认删除「${esc(p.name)}」？`,()=>{
      DB.papers=DB.papers.filter(x=>x.id!==p.id);
      DB.paperShares=DB.paperShares.filter(s=>s.paperId!==p.id);
      saveDB();toast('试卷已删除','ok');dispatch();
    },'删除',true);
  });
  $$('[data-remove]').forEach(b=>b.onclick=()=>{
    const p=paperById(b.dataset.remove);if(!p)return;
    confirmBox('移除共享','移除后该试卷将从你的列表消失（不影响创建者）。',()=>{
      const s=paperShareFor(p,currentUser().id);if(s)s.status='removed';
      saveDB();toast('已移除共享','ok');dispatch();
    },'移除',true);
  });
});
async function startTemplateExam(paperId){
  await flushSave();
  const r=await apiPost('exam/create',{paperId});
  if(!r.ok){
    if(r.gaps)throw new Error('题量不足：'+r.gaps.map(g=>`${TYPES[g.t]} 需求 ${g.want}/可用 ${g.have}`).join('；'));
    throw new Error(r.error||'无法开始考试');
  }
  if(!DB.examRecords.some(x=>x.id===r.record.id))DB.examRecords.push(r.record);
  baseline();
  location.hash='#/exam/run/'+r.record.id;
}
/* ---- 试卷共享 ---- */
function sharePaper(paper){
  if(!paper)return;
  const shares=DB.paperShares.filter(s=>s.paperId===paper.id&&s.status==='active');
  const linkShare=shares.find(s=>s.linkToken);
  const linkUrl=linkShare?location.origin+location.pathname+'#/pshare/'+linkShare.linkToken:'';
  openModal(`<h3>共享试卷「${esc(paper.name)}」</h3>
    <div class="tabs"><button class="tab active" data-st="user">指定用户</button><button class="tab" data-st="link">分享链接</button></div>
    <div id="pShareUser">
      <div class="field"><label>搜索用户（用户名或昵称）</label>
        <div style="display:flex;gap:8px"><input class="input" id="psKw" placeholder="输入关键词搜索"><button class="btn" id="psSearch">搜索</button></div>
      </div>
      <div id="psResults"></div>
    </div>
    <div id="pShareLink" class="hidden">
      ${linkShare?`<div class="field"><label>分享链接（访问者需登录后接受）</label>
        <div style="display:flex;gap:8px"><input class="input" readonly value="${esc(linkUrl)}" id="psLinkInput"><button class="btn" id="psCopy">复制</button></div></div>
        <div class="btn-row"><button class="btn sm" id="psReset">重置链接</button><button class="btn sm danger" id="psRevoke">撤销链接</button></div>
        <div class="hint" style="margin-top:6px">重置后旧链接立即失效；已接受共享的用户不受影响。</div>`
      :`<p class="small muted">尚未生成分享链接。</p><button class="btn primary" id="psGen">生成链接</button>`}
    </div>
    <h4 style="margin-top:18px">当前共享（${shares.length}）</h4>
    <div>${shares.length?shares.map(s=>{
      const t=s.targetUserId?(DB.users.find(x=>x.id===s.targetUserId)||{}):null;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span>${s.linkToken?'🔗 链接分享':'👤 '+esc(t?(t.nickname||t.username):'用户')}<span class="muted small"> · ${fmtTime(s.createdAt).slice(0,10)}</span></span>
        <button class="btn ghost sm danger" data-prevoke="${s.id}">撤销</button></div>`;}).join(''):'<p class="small muted">暂无共享</p>'}</div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">关闭</button></div>`,true);
  $$('[data-st]').forEach(t=>t.onclick=()=>{
    $$('[data-st]').forEach(x=>x.classList.toggle('active',x===t));
    $('#pShareUser').classList.toggle('hidden',t.dataset.st!=='user');
    $('#pShareLink').classList.toggle('hidden',t.dataset.st!=='link');
  });
  $('#psSearch').onclick=()=>{
    const kw=$('#psKw').value.trim().toLowerCase();if(!kw)return;
    const me=currentUser();
    const found=DB.users.filter(x=>x.id!==me.id&&x.status==='active'&&(x.username.toLowerCase().includes(kw)||(x.nickname||'').toLowerCase().includes(kw)));
    $('#psResults').innerHTML=found.length?found.map(f=>{
      const already=DB.paperShares.some(s=>s.paperId===paper.id&&s.targetUserId===f.id&&s.status==='active');
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span>${esc(f.nickname||f.username)} <span class="muted small">@${esc(f.username)}</span></span>
        ${already?'<span class="tag green">已共享</span>':`<button class="btn sm primary" data-pshareto="${f.id}">共享</button>`}</div>`;}).join('')
      :'<p class="small muted">未找到匹配用户</p>';
    $$('[data-pshareto]').forEach(b=>b.onclick=()=>{
      DB.paperShares.push({id:uid(),paperId:paper.id,ownerId:currentUser().id,targetUserId:b.dataset.pshareto,status:'active',createdAt:nowTs()});
      saveDB();toast('已共享','ok');closeModal();sharePaper(paper);
    });
  };
  const gen=$('#psGen');if(gen)gen.onclick=()=>{
    DB.paperShares.push({id:uid(),paperId:paper.id,ownerId:currentUser().id,linkToken:uid()+uid(),status:'active',createdAt:nowTs()});
    saveDB();closeModal();sharePaper(paper);toast('链接已生成','ok');
  };
  const cp=$('#psCopy');if(cp)cp.onclick=()=>{$('#psLinkInput').select();navigator.clipboard?.writeText($('#psLinkInput').value);toast('已复制','ok');};
  const rs=$('#psReset');if(rs)rs.onclick=()=>{linkShare.linkToken=uid()+uid();saveDB();closeModal();sharePaper(paper);toast('链接已重置，旧链接已失效','ok');};
  const rv=$('#psRevoke');if(rv)rv.onclick=()=>{linkShare.status='revoked';saveDB();closeModal();sharePaper(paper);toast('链接已撤销','ok');};
  $$('[data-prevoke]').forEach(b=>b.onclick=()=>{
    const s=DB.paperShares.find(x=>x.id===b.dataset.prevoke);if(s)s.status='revoked';
    saveDB();toast('共享已撤销','ok');closeModal();sharePaper(paper);
  });
}
route('#/pshare/:token',token=>{
  if(!requireAuth())return;
  const s=DB.paperShares.find(x=>x.linkToken===token&&x.status==='active');
  const u=currentUser();
  if(!s){render(`<div class="card empty"><div class="big">🔗</div><p>链接已失效或不存在</p><button class="btn" onclick="location.hash='#/papers'">返回试卷列表</button></div>`,'#/papers');return;}
  const paper=paperById(s.paperId);const owner=DB.users.find(x=>x.id===s.ownerId);
  if(!paper||!owner||owner.status!=='active'){render(`<div class="card empty"><div class="big">🔗</div><p>共享已失效</p><button class="btn" onclick="location.hash='#/papers'">返回试卷列表</button></div>`,'#/papers');return;}
  if(paper.userId===u.id){toast('这是你自己的试卷','warn');location.hash='#/papers';return;}
  const accepted=DB.paperShares.some(x=>x.paperId===paper.id&&x.targetUserId===u.id&&x.status==='active');
  render(`<div class="card" style="max-width:560px;margin:60px auto;text-align:center">
    <div class="brand-mark" style="margin:0 auto 14px">卷</div>
    <h2 style="font-size:20px">${esc(paper.name)}</h2>
    <div class="meta" style="display:flex;gap:6px;justify-content:center;margin:10px 0"><span class="tag gray">${paper.total} 题</span><span class="tag gray">满分 ${paper.totalScore??paper.total}</span><span class="tag">来自 ${esc(owner.nickname||owner.username)}</span></div>
    ${accepted?`<p class="small" style="color:var(--green)">你已接受该试卷共享</p><button class="btn primary" onclick="location.hash='#/papers'">前往试卷列表</button>`
      :`<button class="btn primary lg" id="acceptPaperShare">接受共享</button>`}
  </div>`,'#/papers');
  const b=$('#acceptPaperShare');if(b)b.onclick=()=>{
    DB.paperShares.push({id:uid(),paperId:paper.id,ownerId:s.ownerId,targetUserId:u.id,viaLink:token,status:'active',createdAt:nowTs()});
    saveDB();toast('已加入「共享给我」','ok');location.hash='#/papers';
  };
});
/* ---- 考试记录 ---- */
let examTab='mine';
function examRowsHTML(recs,showUser){
  if(!recs.length)return'';
  return `<div class="table-wrap"><table><thead><tr><th>试卷</th>${showUser?'<th>考生</th>':''}<th>得分</th><th>状态</th><th>用时</th><th>开始时间</th><th>操作</th></tr></thead><tbody>
    ${recs.map(r=>{
      const p=paperById(r.paperId);
      const usr=DB.users.find(x=>x.id===r.userId);
      const mine=r.userId===currentUser().id;
      const used=r.submittedAt?Math.round((r.submittedAt-r.startedAt)/1000):Math.round((nowTs()-r.startedAt)/1000);
      const st=r.status==='ongoing'?'<span class="tag amber">进行中</span>':r.status==='timeout'?'<span class="tag red">已超时交卷</span>':'<span class="tag green">已交卷</span>';
      return `<tr><td>${esc(p?p.name:'（试卷已删除）')}</td>
        ${showUser?`<td>${esc(usr?(usr.nickname||usr.username):'未知用户')}${mine?' <span class="tag gray">我</span>':''}</td>`:''}
        <td>${r.score===null||r.score===undefined?'-':`<strong style="color:${r.score>=(p?p.passScore:0)?'var(--green)':'var(--red)'}">${r.score}</strong> / ${p?(p.totalScore??p.total):'-'}`}</td>
        <td>${st}</td><td class="small">${Math.floor(used/60)} 分 ${used%60} 秒</td><td class="small">${fmtTime(r.startedAt)}</td>
        <td class="nowrap">${r.status==='ongoing'&&mine?`<button class="btn sm primary" data-cont="${r.id}">继续考试</button>`:`<button class="btn sm" data-view="${r.id}">查看结果</button>`}</td></tr>`;
    }).join('')}
    </tbody></table></div>`;
}
function bindExamRows(){
  $$('[data-cont]').forEach(b=>b.onclick=()=>location.hash='#/exam/run/'+b.dataset.cont);
  $$('[data-view]').forEach(b=>b.onclick=()=>location.hash='#/exam/result/'+b.dataset.view);
}
route('#/exams',()=>{
  if(!requireAuth())return;
  const u=currentUser();
  const mineRecs=DB.examRecords.filter(r=>r.userId===u.id);
  const myPids=new Set(myPapers().map(p=>p.id));
  const allRecs=DB.examRecords.filter(r=>myPids.has(r.paperId));
  const recs=(examTab==='mine'?mineRecs:allRecs).sort((a,b)=>b.startedAt-a.startedAt);
  render(`<h1 class="page-title">考试记录</h1><div class="page-sub">按时间倒序；进行中的考试可继续作答；「我出的试卷」可查看每个考生的成绩</div>
    <div class="tabs">
      <button class="tab ${examTab==='mine'?'active':''}" data-t="mine">我的考试（${mineRecs.length}）</button>
      <button class="tab ${examTab==='all'?'active':''}" data-t="all">我出的试卷（${allRecs.length}）</button>
    </div>
    <div class="card">${recs.length?examRowsHTML(recs,examTab==='all'):`<div class="empty"><div class="big">📝</div><p>${examTab==='mine'?'还没有考试记录':'你创建的试卷还没有人考试'}</p><button class="btn primary" onclick="location.hash='#/papers'">前往试卷列表</button></div>`}</div>`,'#/exams');
  $$('.tab[data-t]').forEach(t=>t.onclick=()=>{examTab=t.dataset.t;dispatch();});
  bindExamRows();
});
route('#/exams/paper/:pid',pid=>{
  if(!requireAuth())return;
  const u=currentUser();
  const p=paperById(pid);
  if(!p){toast('试卷不存在','err');location.hash='#/papers';return;}
  const own=p.userId===u.id;
  const recs=DB.examRecords.filter(r=>r.paperId===pid&&(own||r.userId===u.id)).sort((a,b)=>b.startedAt-a.startedAt);
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/papers'">← 返回试卷列表</button></div>
    <h1 class="page-title">${esc(p.name)}</h1>
    <div class="page-sub">${p.total} 题 · 满分 ${p.totalScore??p.total} 分 · ${(p.config&&p.config.duration)||90} 分钟 · ${own?'可查看所有考生的记录':'仅显示你自己的记录'}</div>
    <div class="card">${recs.length?examRowsHTML(recs,own):`<div class="empty"><div class="big">📝</div><p>还没有考试记录</p>${own?'':`<button class="btn primary" id="goExam">开始考试</button>`}</div>`}</div>`,'#/papers');
  bindExamRows();
  const g=$('#goExam');if(g)g.onclick=()=>startTemplateExam(p.id).catch(e=>toast(e.message,'err'));
});
