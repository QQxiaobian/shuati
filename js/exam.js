'use strict';
/* ================= 模拟考试 ================= */
let EX={banks:[],counts:{single:5,multi:2,judge:5,blank:2},scores:{single:1,multi:2,judge:1,blank:2},chaps:[],diffs:[],duration:90,passPct:60,name:''};
let examTimer=null;
route('#/exam/setup',()=>{
  if(!requireAuth())return;
  const urlBank=(location.hash.match(/bank=([^&]+)/)||[])[1];
  const readable=readableBanks().filter(b=>bankQuestions(b.id).length>0);
  EX={banks:urlBank?[urlBank]:[],counts:{single:5,multi:2,judge:5,blank:2},scores:{single:1,multi:2,judge:1,blank:2},chaps:[],diffs:[],duration:90,passPct:60,name:'模拟试卷 '+fmtTime(nowTs()).slice(5)};
  render(`<h1 class="page-title">生成模拟试卷</h1><div class="page-sub">从自有与共享题库中抽题，生成固定快照试卷；各题型题量与每题分值均可自定义，多选全对得分</div>
    <div class="card">
      <div class="field"><label>试卷名称</label><input class="input" id="exName" value="${esc(EX.name)}" maxlength="60"></div>
      <div class="field"><label>题库范围（可多选）</label>
        <div class="check-row" id="exBanks">${readable.length?readable.map(b=>`<label><input type="checkbox" value="${b.id}" ${EX.banks.includes(b.id)?'checked':''}> ${esc(b.name)}（${bankQuestions(b.id).length}）</label>`).join(''):'<span class="muted small">暂无有题目的题库</span>'}</div>
      </div>
      <div class="field"><label>题型、题量与每题分值（可用量实时统计）</label>
        <div class="inline-fields" id="exCounts">
          ${['single','multi','judge','blank'].map(t=>`<div class="field"><label class="small">${TYPES[t]} <span class="muted" id="av_${t}"></span></label>
            <div style="display:flex;align-items:center;gap:4px">
              <input class="input ex-count" data-t="${t}" type="number" min="0" value="${EX.counts[t]}" style="width:64px" title="题量">
              <span class="small muted nowrap">题 ×</span>
              <input class="input ex-score" data-t="${t}" type="number" min="0.5" step="0.5" value="${EX.scores[t]}" style="width:64px" title="每题分值">
              <span class="small muted nowrap">分</span>
            </div></div>`).join('')}
        </div>
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
      <div id="exGap"></div>
      <div class="modal-foot" style="justify-content:flex-end"><button class="btn primary lg" id="exGen">生成试卷</button></div>
    </div>`,'#/exam/setup');
  const updateAvail=()=>{
    EX.banks=$$('#exBanks input:checked').map(i=>i.value);
    const pool=poolQuestions();
    ['single','multi','judge','blank'].forEach(t=>{
      const n=pool.filter(q=>q.type===t).length;const el=$('#av_'+t);if(el)el.textContent=`(可用 ${n})`;
    });
    return pool;
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
  const refreshChaps=()=>{
    EX.banks=$$('#exBanks input:checked').map(i=>i.value);
    const chaps=allChapters(EX.banks);
    $('#exChap').innerHTML=chaps.map(c=>`<option>${esc(c)}</option>`).join('');
    updateAvail();
  };
  const updateScoreSum=()=>{
    const total=['single','multi','judge','blank'].reduce((a,t)=>a+(EX.counts[t]||0)*(EX.scores[t]||1),0);
    const el=$('#exScoreSum');if(el)el.textContent=total>0?`预计满分：${Math.round(total*10)/10} 分（及格线按总分的百分比折算）`:'';
  };
  $$('#exBanks input').forEach(i=>i.onchange=refreshChaps);
  $$('.ex-count').forEach(i=>i.oninput=()=>{EX.counts[i.dataset.t]=Math.max(0,+i.value||0);updateScoreSum();});
  $$('.ex-score').forEach(i=>i.oninput=()=>{EX.scores[i.dataset.t]=Math.max(0.5,+i.value||1);updateScoreSum();});
  refreshChaps();updateScoreSum();
  $('#exChap').onchange=updateAvail;$('#exDiff').onchange=updateAvail;
  $('#exGen').onclick=async()=>{
    EX.name=$('#exName').value.trim()||EX.name;
    EX.duration=Math.min(300,Math.max(1,+$('#exDur').value||90));
    EX.passPct=Math.min(100,Math.max(1,+$('#exPass').value||60));
    if(!EX.banks.length)return toast('请至少选择 1 个题库','err');
    const totalWanted=Object.values(EX.counts).reduce((a,b)=>a+b,0);
    if(totalWanted<1)return toast('总题量至少为 1 题','err');
    const selChaps=[...($('#exChap')?$('#exChap').selectedOptions:[])].map(o=>o.value);
    const selDiffs=[...($('#exDiff')?$('#exDiff').selectedOptions:[])].map(o=>o.value);
    $('#exGen').disabled=true;
    try{
      await flushSave();
      const r=await apiPost('exam/create',{name:EX.name,banks:EX.banks,counts:EX.counts,scores:EX.scores,chaps:selChaps,diffs:selDiffs,duration:EX.duration,passPct:EX.passPct});
      if(!r.ok){
        if(r.gaps){
          $('#exGap').innerHTML=`<div class="feedback bad" style="margin-top:10px"><strong>题量不足，无法生成：</strong>${r.gaps.map(g=>`${TYPES[g.t]} 需求 ${g.want} / 可用 ${g.have} / 缺口 ${g.want-g.have}`).join('；')}。请减少题量或放宽筛选。</div>`;
          return;
        }
        return toast(r.error||'生成失败','err');
      }
      $('#exGap').innerHTML='';
      DB.papers.push(r.paper);DB.examRecords.push(r.record);baseline();
      toast('试卷已生成，开始考试','ok');location.hash='#/exam/run/'+r.record.id;
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
  if(rec.status!=='ongoing'){location.hash='#/exam/result/'+rid;return;}
  if(rec.deadline<=nowTs()){submitExam(rec,true).then(()=>location.hash='#/exam/result/'+rid).catch(()=>{});return;}
  let cur=+(sessionStorage.getItem('exam_cur_'+rid)||0);
  const q=paper.questions[cur];
  const ans=rec.answers[q.qid];
  render(`<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px">
      <div><strong style="font-size:16px">${esc(paper.name)}</strong><div class="small muted">共 ${paper.questions.length} 题 · 满分 ${paper.totalScore??paper.total} 分 · 及格 ${paper.passScore} 分</div></div>
      <div class="timer" id="exTimer">--:--</div>
    </div>
    <div class="progress-line"><i style="width:${cur/paper.total*100}%"></i></div>
    <div class="q-card">
      <div class="meta" style="display:flex;gap:6px;flex-wrap:wrap"><span class="tag gray">第 ${cur+1} 题</span>${typeTag(q.type)}${diffTag(q.difficulty)}<span class="tag amber">${q.score} 分</span></div>
      <div class="q-stem">${esc(q.stem)}</div>
      <div id="exAns"></div>
      <div class="btn-row" style="margin-top:16px">
        <button class="btn" id="exPrev" ${cur===0?'disabled':''}>上一题</button>
        <button class="btn" id="exNext" ${cur===paper.total-1?'disabled':''}>下一题</button>
        <span style="flex:1"></span>
        <button class="btn accent" id="exSubmit">交卷</button>
      </div>
    </div>
    <div class="card" style="margin-top:14px"><strong class="small">题目导航</strong><span class="small muted">（已答 ${Object.keys(rec.answers).length} / 未答 ${paper.total-Object.keys(rec.answers).length}）</span>
      <div class="exam-nav">${paper.questions.map((qq,i)=>`<button class="${rec.answers[qq.qid]?'done':''} ${i===cur?'cur':''}" data-jump="${i}">${i+1}</button>`).join('')}</div>
    </div>`,'#/exam/setup');
  // 作答区（逐题保存，可修改）
  const area=$('#exAns');
  const saveAns=c=>{if(c&&String(c).trim())rec.answers[q.qid]={content:c,ts:nowTs()};else delete rec.answers[q.qid];saveDB();};
  if(q.type==='single'||q.type==='multi'){
    let sel=ans?ans.content:'';
    const r=()=>{area.innerHTML=q.options.map(o=>`<div class="opt${String(sel).includes(o.k)?' sel':''}" data-k="${o.k}"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('');
      $$('#exAns .opt').forEach(el=>el.onclick=()=>{const k=el.dataset.k;
        if(q.type==='single')sel=k;else sel=sel.includes(k)?sel.replace(k,''):[...sel+k].sort().join('');
        saveAns(sel);r();refreshNav();});};
    r();
  }else if(q.type==='judge'){
    let sel=ans?ans.content:'';
    const r=()=>{area.innerHTML=['正确','错误'].map(v=>`<div class="opt${sel===v?' sel':''}" data-v="${v}"><span class="k">${v==='正确'?'✓':'✗'}</span><span>${v}</span></div>`).join('');
      $$('#exAns .opt').forEach(el=>el.onclick=()=>{sel=el.dataset.v;saveAns(sel);r();refreshNav();});};
    r();
  }else{
    area.innerHTML=`<textarea class="input" id="exText">${esc(ans?ans.content:'')}</textarea>`;
    $('#exText').oninput=e=>saveAns(e.target.value);
    $('#exText').onchange=e=>{saveAns(e.target.value);refreshNav();};
  }
  function refreshNav(){
    $$('.exam-nav button').forEach((b,i)=>b.classList.toggle('done',!!rec.answers[paper.questions[i].qid]));
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
    const undone=paper.total-Object.keys(rec.answers).length;
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
  const rec=DB.examRecords.find(r=>r.id===rid&&r.userId===currentUser().id);
  if(!rec){toast('考试记录不存在','err');location.hash='#/exams';return;}
  if(rec.status==='ongoing'){location.hash='#/exam/run/'+rid;return;}
  const paper=DB.papers.find(p=>p.id===rec.paperId);
  const used=Math.round(((rec.submittedAt||nowTs())-rec.startedAt)/1000);
  let rightN=0;const per={};
  paper.questions.forEach(q=>{
    const a=rec.answers[q.qid];
    const right=a?gradeAnswer({type:q.type,answer:q.answer},a.content):false;
    if(right)rightN++;
    per[q.type]=per[q.type]||{total:0,right:0,wrong:0,undone:0};
    per[q.type].total++;if(!a)per[q.type].undone++;else if(right)per[q.type].right++;else per[q.type].wrong++;
  });
  const acc=paper.total?Math.round(rightN/paper.total*1000)/10:0;
  const pass=rec.score>=paper.passScore;
  const ansText=(q,c)=>{
    if(!c)return '<span class="muted">未作答</span>';
    if(q.type==='judge')return esc(c);
    if(q.type==='blank')return esc(c);
    return esc(c);
  };
  render(`<h1 class="page-title">成绩报告</h1><div class="page-sub">${esc(paper.name)} · ${rec.status==='timeout'?'<span class="tag red">已超时交卷</span>':'<span class="tag green">已交卷</span>'} · 用时 ${Math.floor(used/60)} 分 ${used%60} 秒</div>
    <div class="stat-row">
      <div class="stat"><b style="color:${pass?'var(--green)':'var(--red)'}">${rec.score}</b><span>得分 / ${paper.totalScore??paper.total} 分</span></div>
      <div class="stat"><b>${acc}%</b><span>正确率</span></div>
      <div class="stat"><b style="color:${pass?'var(--green)':'var(--red)'}">${pass?'及格':'未及格'}</b><span>及格线 ${paper.passScore} 分</span></div>
      <div class="stat"><b style="color:var(--green)">${rightN}</b><span>答对</span></div>
      <div class="stat"><b style="color:var(--red)">${paper.total-rightN}</b><span>答错/未答</span></div>
    </div>
    <div class="card"><h4 style="margin-bottom:8px">题型拆分</h4>
      <div class="table-wrap"><table><thead><tr><th>题型</th><th>题量</th><th>答对</th><th>答错</th><th>未答</th><th>得分</th></tr></thead><tbody>
      ${Object.entries(per).map(([t,p])=>{const sq=paper.questions.find(x=>x.type===t);const sc=sq?sq.score:1;
        return `<tr><td>${TYPES[t]}</td><td>${p.total}</td><td>${p.right}</td><td>${p.wrong}</td><td>${p.undone}</td><td>${Math.round(p.right*sc*10)/10} / ${Math.round(p.total*sc*10)/10}</td></tr>`;}).join('')}
      </tbody></table></div></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <h4>逐题解析</h4><label class="small" style="cursor:pointer"><input type="checkbox" id="onlyWrong"> 只看错题</label></div>
      <div id="qList"></div></div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn primary" id="reExam">再考一次（重新抽题）</button>
      <button class="btn" id="exExpQ">导出试卷（无答案）</button>
      <button class="btn" id="exExpA">导出试卷（含答案解析）</button>
      <button class="btn" onclick="location.hash='#/exams'">返回考试记录</button>
    </div>`,'#/exams');
  const renderList=(onlyWrong)=>{
    $('#qList').innerHTML=paper.questions.map((q,i)=>{
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
  $('#exExpQ').onclick=()=>exportPaper(paper,false);
  $('#exExpA').onclick=()=>exportPaper(paper,true);
  $('#reExam').onclick=()=>{
    EX=null;location.hash='#/exam/setup';
    toast('请按原配置重新生成试卷（重新随机抽题）','ok');
  };
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
/* ---- 考试记录 ---- */
route('#/exams',()=>{
  if(!requireAuth())return;
  const u=currentUser();
  const recs=DB.examRecords.filter(r=>r.userId===u.id).sort((a,b)=>b.startedAt-a.startedAt);
  render(`<h1 class="page-title">考试记录</h1><div class="page-sub">按时间倒序；进行中的考试可继续作答</div>
    <div class="card">${recs.length?`<div class="table-wrap"><table><thead><tr><th>试卷</th><th>得分</th><th>状态</th><th>用时</th><th>开始时间</th><th>操作</th></tr></thead><tbody>
      ${recs.map(r=>{const p=DB.papers.find(x=>x.id===r.paperId);
        const used=r.submittedAt?Math.round((r.submittedAt-r.startedAt)/1000):Math.round((nowTs()-r.startedAt)/1000);
        const st=r.status==='ongoing'?'<span class="tag amber">进行中</span>':r.status==='timeout'?'<span class="tag red">已超时交卷</span>':'<span class="tag green">已交卷</span>';
        return `<tr><td>${esc(p?p.name:'（试卷已删除）')}</td>
          <td>${r.score===null?'-':`<strong style="color:${r.score>=(p?p.passScore:0)?'var(--green)':'var(--red)'}">${r.score}</strong> / ${p?(p.totalScore??p.total):'-'}`}</td>
          <td>${st}</td><td class="small">${Math.floor(used/60)} 分 ${used%60} 秒</td><td class="small">${fmtTime(r.startedAt)}</td>
          <td class="nowrap">${r.status==='ongoing'?`<button class="btn sm primary" data-cont="${r.id}">继续考试</button>`:`<button class="btn sm" data-view="${r.id}">查看结果</button>`}</td></tr>`;}).join('')}
    </tbody></table></div>`:`<div class="empty"><div class="big">📝</div><p>还没有考试记录</p><button class="btn primary" onclick="location.hash='#/exam/setup'">去生成一份试卷</button></div>`}
    </div>`,'#/exams');
  $$('[data-cont]').forEach(b=>b.onclick=()=>location.hash='#/exam/run/'+b.dataset.cont);
  $$('[data-view]').forEach(b=>b.onclick=()=>location.hash='#/exam/result/'+b.dataset.view);
});
