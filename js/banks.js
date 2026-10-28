'use strict';
/* ================= 题库首页（我的/共享/内置） ================= */
let homeTab='mine',homeKw='',homeSort='updated',builtinCat='全部',builtinKw='';
route('#/banks',()=>{
  if(!requireAuth())return;
  const u=currentUser();
  const tabs=`<div class="tabs">
    <button class="tab ${homeTab==='mine'?'active':''}" data-t="mine">我的题库</button>
    <button class="tab ${homeTab==='shared'?'active':''}" data-t="shared">共享给我</button>
    <button class="tab ${homeTab==='builtin'?'active':''}" data-t="builtin">内置题库</button>
  </div>`;
  let body='';
  if(homeTab==='mine'){
    let list=myBanks();
    if(homeKw)list=list.filter(b=>b.name.toLowerCase().includes(homeKw.toLowerCase()));
    list.sort((a,b)=>homeSort==='count'?bankQuestions(b.id).length-bankQuestions(a.id).length:b.updatedAt-a.updatedAt);
    const cards=list.map(b=>{
      const n=bankQuestions(b.id).length;
      const lastA=DB.answers.filter(a=>a.userId===u.id&&a.bankId===b.id).pop();
      const sh=DB.shares.filter(s=>s.bankId===b.id&&s.status==='active').length;
      const pp=progressFor(b.id,'practice'),rp=progressFor(b.id,'recite');
      return `<div class="bank-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><h4>${esc(b.name)}</h4>${srcTag(b.source)}</div>
        <div class="meta"><span class="tag gray">${n} 题</span>${sh?`<span class="tag green">已分享 ${sh}</span>`:''}<span class="tag gray">更新 ${fmtTime(b.updatedAt).slice(0,10)}</span></div>
        ${lastA?`<div class="small muted">最近练习：${fmtTime(lastA.ts)}</div>`:'<div class="small muted">尚未练习</div>'}
        <div class="btn-row"><button class="btn primary sm" data-act="practice" data-id="${b.id}" ${n?'':'disabled'}>开始练习</button>
        ${pp?`<button class="btn sm" data-resume-p="${b.id}">继续刷题 ${pp.idx+1}/${pp.qids.length}</button>`:''}
        ${rp?`<button class="btn sm" data-resume-r="${b.id}">继续背题 ${rp.idx+1}/${rp.qids.length}</button>`:''}
        <button class="btn sm" data-act="detail" data-id="${b.id}">详情</button></div>
      </div>`;}).join('');
    body=`<div class="btn-row" style="margin-bottom:14px">
        <button class="btn primary" id="btnImport">📥 导入表格</button>
        <button class="btn" id="btnNewBank">＋ 新建空题库</button>
        <span style="flex:1"></span>
        <input class="input" id="homeKw" style="width:200px" placeholder="搜索题库名称" value="${esc(homeKw)}">
        <select class="input" id="homeSort" style="width:130px"><option value="updated" ${homeSort==='updated'?'selected':''}>按更新时间</option><option value="count" ${homeSort==='count'?'selected':''}>按题量</option></select>
      </div>
      ${list.length?`<div class="grid-cards">${cards}</div>`:`<div class="card empty"><div class="big">📭</div><p>还没有题库，从导入表格或手动新建开始吧</p><div class="btn-row" style="justify-content:center"><button class="btn primary" onclick="location.hash='#/import'">导入表格</button><button class="btn" id="btnNewBank2">手动新建</button></div></div>`}`;
  }else if(homeTab==='shared'){
    const list=sharedBanks();
    const cards=list.map(b=>{
      const owner=DB.users.find(x=>x.id===b.ownerId);
      const s=shareFor(b,u.id);
      return `<div class="bank-card">
        <h4>${esc(b.name)}</h4>
        <div class="meta"><span class="tag gray">${bankQuestions(b.id).length} 题</span><span class="tag">来自 ${esc(owner?owner.nickname||owner.username:'未知')}</span><span class="tag gray">分享于 ${fmtTime(s?s.createdAt:0).slice(0,10)}</span></div>
        <div class="btn-row"><button class="btn primary sm" data-act="practice" data-id="${b.id}">开始练习</button>
        <button class="btn sm" data-act="detail" data-id="${b.id}">查看</button>
        <button class="btn ghost sm danger" data-act="unshare" data-id="${b.id}">移除共享</button></div>
      </div>`;}).join('');
    body=list.length?`<div class="grid-cards">${cards}</div>`:`<div class="card empty"><div class="big">🤝</div><p>别人分享给你的题库会出现在这里</p></div>`;
  }else{
    const cats=['全部',...DB.builtinCategories];
    let list=DB.builtinBanks.filter(b=>b.status==='up');
    if(builtinCat!=='全部')list=list.filter(b=>(b.category||'未分类')===builtinCat);
    if(builtinKw)list=list.filter(b=>b.name.toLowerCase().includes(builtinKw.toLowerCase()));
    const cards=list.map(b=>{
      const samples=b.questions.slice(0,3).map(q=>`<li class="small muted" style="margin:2px 0">${esc(q.stem.slice(0,40))}${q.stem.length>40?'…':''}</li>`).join('');
      return `<div class="bank-card">
        <div style="display:flex;justify-content:space-between"><h4>${esc(b.name)}</h4><span class="tag">${esc(b.category||'未分类')}</span></div>
        <div class="meta"><span class="tag gray">${b.questions.length} 题</span><span class="tag gray">更新 ${fmtTime(b.updatedAt).slice(0,10)}</span></div>
        <div class="small muted">${esc(b.intro||'')}</div>
        <ul style="list-style:none;padding-left:0;margin:4px 0">${samples}</ul>
        <div class="btn-row"><button class="btn primary sm" data-act="copyBuiltin" data-id="${b.id}">导入到我的题库</button></div>
      </div>`;}).join('');
    body=`<div class="btn-row" style="margin-bottom:14px">
        ${cats.map(c=>`<button class="sheet-tab ${builtinCat===c?'cur':''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        <span style="flex:1"></span>
        <input class="input" id="builtinKw" style="width:200px" placeholder="搜索内置题库" value="${esc(builtinKw)}">
      </div>
      ${list.length?`<div class="grid-cards">${cards}</div>`:`<div class="card empty"><div class="big">🗃️</div><p>管理员尚未上架内置题库</p></div>`}`;
  }
  render(`<h1 class="page-title">题库</h1><div class="page-sub">导入、创建与访问题库；共享题库为只读</div>${tabs}${body}`,'#/banks');
  $$('.tab[data-t]').forEach(b=>b.onclick=()=>{homeTab=b.dataset.t;dispatch();});
  $$('[data-cat]').forEach(b=>b.onclick=()=>{builtinCat=b.dataset.cat;dispatch();});
  const kw=$('#homeKw');if(kw)kw.onchange=()=>{homeKw=kw.value;dispatch();};
  const st=$('#homeSort');if(st)st.onchange=()=>{homeSort=st.value;dispatch();};
  const bk=$('#builtinKw');if(bk)bk.onchange=()=>{builtinKw=bk.value;dispatch();};
  const bi=$('#btnImport');if(bi)bi.onclick=()=>{location.hash='#/import';};
  const nb=$('#btnNewBank');if(nb)nb.onclick=newBankDialog;
  const nb2=$('#btnNewBank2');if(nb2)nb2.onclick=newBankDialog;
  $$('[data-act]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.id,act=b.dataset.act;
    if(act==='practice')location.hash='#/practice/setup/'+id;
    if(act==='detail')location.hash='#/bank/'+id;
    if(act==='unshare'){
      confirmBox('移除共享','移除后该题库将从你的列表消失（不影响所有者），错题与考试记录保留但题目不可打开。',()=>{
        const u=currentUser();const s=shareFor(bankById(id),u.id);
        if(s)s.status='removed';
        DB.wrongBook.filter(w=>w.userId===u.id&&w.bankId===id).forEach(w=>w.status='invalid');
        saveDB();toast('已移除共享','ok');dispatch();
      },'移除',true);
    }
    if(act==='copyBuiltin')copyBuiltin(id);
  });
  $$('[data-resume-p]').forEach(b=>b.onclick=()=>{const p=loadPS('practice');if(!p)return;PS=p;location.hash='#/practice/run';});
  $$('[data-resume-r]').forEach(b=>b.onclick=()=>{const p=loadPS('recite');if(!p)return;PS=p;location.hash='#/practice/run';});
});
function newBankDialog(){
  openModal(`<h3>新建空题库</h3>
    <div class="field"><label>题库名称 *</label><input class="input" id="nbName" maxlength="60"></div>
    <div class="field"><label>简介</label><textarea class="input" id="nbIntro" maxlength="300"></textarea></div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="nbOk">创建</button></div>`);
  $('#nbOk').onclick=()=>{
    const name=$('#nbName').value.trim();if(!name)return toast('请输入题库名称','err');
    const b={id:uid(),name,intro:$('#nbIntro').value.trim(),ownerId:currentUser().id,source:'manual',createdAt:nowTs(),updatedAt:nowTs()};
    DB.banks.push(b);saveDB();closeModal();toast('题库已创建','ok');location.hash='#/bank/'+b.id;
  };
}
function copyBuiltin(bid){
  const u=currentUser();const bb=DB.builtinBanks.find(x=>x.id===bid);if(!bb)return;
  const dup=DB.banks.some(b=>b.ownerId===u.id&&b.builtinFrom===bid);
  const doCopy=()=>{
    const size=JSON.stringify(bb.questions).length*2;
    if(quotaLeft(u.id)<size)return toast(`存储空间不足：需要约 ${fmtSize(size)}，剩余 ${fmtSize(Math.max(0,quotaLeft(u.id)))}`,'err');
    let name=bb.name;let i=2;
    while(DB.banks.some(b=>b.ownerId===u.id&&b.name===name)){name=`${bb.name}(${i++})`;}
    const bank={id:uid(),name,intro:bb.intro,ownerId:u.id,source:'builtin_copy',builtinFrom:bid,createdAt:nowTs(),updatedAt:nowTs()};
    DB.banks.push(bank);
    bb.questions.forEach((q,idx)=>DB.questions.push({id:uid(),bankId:bank.id,type:q.type,stem:q.stem,options:q.options.map(o=>({...o})),answer:q.answer,analysis:q.analysis,chapter:q.chapter,difficulty:q.difficulty,order:idx,createdAt:nowTs(),updatedAt:nowTs()}));
    saveDB();closeModal();toast(`已导入「${name}」，共 ${bb.questions.length} 题`,'ok');dispatch();
  };
  if(dup)confirmBox('已导入过该题库','你之前已导入过该内置题库，再次导入将创建新副本。是否继续？',doCopy,'继续导入');
  else doCopy();
}
/* ================= 题库详情 ================= */
let dqType='全部',dqChap='全部',dqDiff='全部',dqPage=1;
route('#/bank/:id',id=>{
  if(!requireAuth())return;
  const b=bankById(id);
  if(!b||!canReadBank(b)){render(`<div class="card empty"><div class="big">🚫</div><p>题库不存在或分享已失效</p><button class="btn" onclick="location.hash='#/banks'">返回题库</button></div>`,'#/banks');return;}
  const own=isOwner(b);
  let qs=bankQuestions(id).sort((a,c)=>a.order-c.order);
  if(dqType!=='全部')qs=qs.filter(q=>q.type===dqType);
  if(dqChap!=='全部')qs=qs.filter(q=>chapterMatch(q.chapter,dqChap));
  if(dqDiff!=='全部')qs=qs.filter(q=>q.difficulty===dqDiff);
  const per=20,pages=Math.ceil(qs.length/per);dqPage=Math.min(dqPage,Math.max(1,pages));
  const pageQs=qs.slice((dqPage-1)*per,dqPage*per);
  const allQ=bankQuestions(id);
  const chaps=bankChapters(id);
  const owner=DB.users.find(x=>x.id===b.ownerId);
  const pProg=progressFor(id,'practice'),rProg=progressFor(id,'recite');
  const rows=pageQs.map(q=>`<tr>
    <td style="max-width:380px"><a data-locate="${q.id}" style="color:var(--ink)">${esc(q.stem.slice(0,60))}${q.stem.length>60?'…':''}</a>
      <button class="btn ghost sm" data-favq="${q.id}" title="收藏/取消收藏">${isFav(q.id)?'★':'☆'}</button></td>
    <td>${typeTag(q.type)}</td>
    <td class="small">${esc((q.chapter||'未设置章节').split('/').pop())}</td>
    <td>${diffTag(q.difficulty)}</td>
    <td>${q.answer?'<span class="tag green">完整</span>':'<span class="tag red">缺答案</span>'}</td>
    ${own?`<td class="nowrap"><button class="btn ghost sm" data-edit="${q.id}">编辑</button><button class="btn ghost sm danger" data-del="${q.id}">删除</button></td>`:''}
  </tr>`).join('');
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="location.hash='#/banks'">← 返回</button></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div>
          <h2 style="font-size:20px">${esc(b.name)} ${srcTag(b.source)}</h2>
          <div class="small muted" style="margin-top:4px">${esc(b.intro||'暂无简介')}</div>
          <div class="meta" style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
            <span class="tag gray">${allQ.length} 题</span><span class="tag gray">${chaps.length} 个章节</span>
            ${own?`<span class="tag gray">占用 ${fmtSize(userStorageBytes(currentUser().id))}</span>`:`<span class="tag">来自 ${esc(owner?owner.nickname||owner.username:'未知')}（只读）</span>`}
            <span class="tag gray">更新 ${fmtTime(b.updatedAt)}</span>
          </div>
        </div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="bkPractice" ${allQ.length?'':'disabled'}>开始练习</button>
        ${pProg?`<button class="btn" id="bkResumeP">继续刷题（${pProg.idx+1}/${pProg.qids.length}）</button>`:''}
        ${rProg?`<button class="btn" id="bkResumeR">继续背题（${rProg.idx+1}/${rProg.qids.length}）</button>`:''}
        <button class="btn" id="bkExam" ${allQ.length?'':'disabled'}>模拟考试</button>
        ${own?`<button class="btn" id="bkShare" ${DB.settings.shareEnabled?'':'disabled'}>分享</button>
        <button class="btn" id="bkEdit">编辑信息</button>
        <button class="btn" id="bkAddQ">＋ 新增题目</button>
        <button class="btn" id="bkImport">继续导入</button>
        <button class="btn danger" id="bkDel">删除题库</button>`:''}
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="filter-grid" style="margin-bottom:12px">
        <select class="input" id="fqType"><option>全部</option>${TYPE_KEYS.map(t=>`<option value="${t}" ${dqType===t?'selected':''}>${TYPES[t]}</option>`).join('')}</select>
        <select class="input" id="fqChap"><option>全部</option>${chaps.map(c=>`<option ${dqChap===esc(c)?'selected':''}>${esc(c)}</option>`).join('')}</select>
        <select class="input" id="fqDiff"><option>全部</option>${DIFF_KEYS.map(d=>`<option value="${d}" ${dqDiff===d?'selected':''}>${DIFFS[d]}</option>`).join('')}</select>
      </div>
      ${allQ.length===0?`<div class="empty"><div class="big">📄</div><p>暂无题目</p>${own?'<div class="btn-row" style="justify-content:center"><button class="btn primary" onclick="location.hash=\'#/import\'">继续导入</button><button class="btn" id="bkAddQ2">手动新增题目</button></div>':''}</div>`
      :qs.length===0?`<div class="empty"><p>当前筛选条件下没有题目</p></div>`
      :`<div class="table-wrap"><table><thead><tr><th>题干</th><th>题型</th><th>章节</th><th>难度</th><th>答案</th>${own?'<th>操作</th>':''}</tr></thead><tbody>${rows}</tbody></table></div>
        <div id="pgBox">${pager(qs.length,dqPage,per,p=>{dqPage=p;dispatch();})}</div>`}
    </div>`,'#/banks');
  $('#bkPractice').onclick=()=>location.hash='#/practice/setup/'+id;
  $('#bkExam').onclick=()=>location.hash='#/exam/setup?bank='+id;
  const rp=$('#bkResumeP');if(rp)rp.onclick=()=>{const p=loadPS('practice');if(!p)return;PS=p;location.hash='#/practice/run';};
  const rr=$('#bkResumeR');if(rr)rr.onclick=()=>{const p=loadPS('recite');if(!p)return;PS=p;location.hash='#/practice/run';};
  $$('[data-favq]').forEach(x=>x.onclick=()=>{
    const q=questionById(x.dataset.favq);if(!q)return;
    const on=toggleFav(q);toast(on?'已收藏':'已取消收藏','ok');dispatch();
  });
  if(own){
    $('#bkEdit').onclick=()=>{
      openModal(`<h3>编辑题库信息</h3>
        <div class="field"><label>题库名称 *</label><input class="input" id="ebName" value="${esc(b.name)}" maxlength="60"></div>
        <div class="field"><label>简介</label><textarea class="input" id="ebIntro" maxlength="300">${esc(b.intro||'')}</textarea></div>
        <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="ebOk">保存</button></div>`);
      $('#ebOk').onclick=()=>{const n=$('#ebName').value.trim();if(!n)return toast('名称不能为空','err');b.name=n;b.intro=$('#ebIntro').value.trim();b.updatedAt=nowTs();saveDB();closeModal();toast('已保存','ok');dispatch();};
    };
    $('#bkShare').onclick=()=>shareDialog(b);
    $('#bkAddQ').onclick=()=>questionForm(id,null);
    const q2=$('#bkAddQ2');if(q2)q2.onclick=()=>questionForm(id,null);
    $('#bkImport').onclick=()=>location.hash='#/import';
    $('#bkDel').onclick=()=>{
      openModal(`<h3>删除题库</h3>
        <p class="small" style="color:var(--red)">删除后不可恢复：该题库的全部分享将立即失效，相关错题标记为已失效。请输入题库名称 <strong>${esc(b.name)}</strong> 确认。</p>
        <div class="field" style="margin-top:12px"><input class="input" id="delConfirm" placeholder="输入题库名称"></div>
        <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="delOk">永久删除</button></div>`);
      $('#delOk').onclick=()=>{
        if($('#delConfirm').value.trim()!==b.name)return toast('名称不一致，未删除','err');
        DB.questions=DB.questions.filter(q=>q.bankId!==id);
        DB.banks=DB.banks.filter(x=>x.id!==id);
        DB.shares.filter(s=>s.bankId===id).forEach(s=>s.status='invalid');
        DB.wrongBook.filter(w=>w.bankId===id).forEach(w=>w.status='invalid');
        saveDB();closeModal();toast('题库已删除','ok');location.hash='#/banks';
      };
    };
    $$('[data-edit]').forEach(x=>x.onclick=()=>questionForm(id,x.dataset.edit));
    $$('[data-del]').forEach(x=>x.onclick=()=>{
      const q=questionById(x.dataset.del);
      confirmBox('删除题目','删除后该题将从题库移除，相关错题变为「已失效」，已生成的试卷快照不受影响。',()=>{
        DB.questions=DB.questions.filter(y=>y.id!==q.id);
        DB.wrongBook.filter(w=>w.questionId===q.id).forEach(w=>w.status='invalid');
        b.updatedAt=nowTs();saveDB();toast('题目已删除','ok');dispatch();
      },'删除',true);
    });
  }
  $$('[data-locate]').forEach(x=>x.onclick=()=>{
    const q=questionById(x.dataset.locate);
    openModal(`<h3>${typeTag(q.type)} ${diffTag(q.difficulty)}</h3>
      <div class="q-stem">${esc(q.stem)}</div>
      ${(q.options||[]).map(o=>`<div class="opt" style="cursor:default"><span class="k">${o.k}</span><span>${esc(o.t)}</span></div>`).join('')}
      <div class="analysis-box"><strong>答案：</strong>${esc(q.answer)}<br><strong>解析：</strong>${esc(q.analysis||'暂无解析')}<br><strong>章节：</strong>${esc(q.chapter||'未设置章节')}</div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">关闭</button></div>`);
  });
  const ft=$('#fqType'),fc=$('#fqChap'),fd=$('#fqDiff');
  if(ft){ft.onchange=()=>{dqType=ft.value;dqPage=1;dispatch();};fc.onchange=()=>{dqChap=fc.value;dqPage=1;dispatch();};fd.onchange=()=>{dqDiff=fd.value;dqPage=1;dispatch();};}
});
/* ================= 题目表单（新增/编辑） ================= */
function questionForm(bankId,qid){
  const q=qid?questionById(qid):null;
  const type=q?q.type:'single';
  const opts=q?q.options:[{k:'A',t:''},{k:'B',t:''},{k:'C',t:''},{k:'D',t:''}];
  const m=openModal(`<h3>${q?'编辑题目':'新增题目'}</h3>
    <div class="field"><label>题型 *</label><select class="input" id="qfType">${TYPE_KEYS.map(t=>`<option value="${t}" ${type===t?'selected':''}>${TYPES[t]}</option>`).join('')}</select></div>
    <div class="field"><label>题干 *</label><textarea class="input" id="qfStem" style="min-height:90px">${esc(q?q.stem:'')}</textarea></div>
    <div class="field" id="qfOptsBox"><label>选项（A–F，至少 2 个）</label>
      <div id="qfOpts">${opts.map(o=>`<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center"><span style="width:18px;font-weight:700;color:var(--brand)" class="optK">${o.k}</span><input class="input optT" value="${esc(o.t)}" placeholder="选项内容"><button class="btn ghost sm danger optRm" type="button">✕</button></div>`).join('')}</div>
      <button class="btn sm" id="qfAddOpt" type="button">＋ 添加选项</button>
    </div>
    <div class="field" id="qfAnsBox"><label>答案 * <span class="hint" id="qfAnsHint"></span></label><input class="input" id="qfAns" value="${esc(q?q.answer:'')}"></div>
    <div class="field"><label>解析</label><textarea class="input" id="qfAnalysis">${esc(q?q.analysis:'')}</textarea></div>
    <div class="inline-fields">
      <div class="field"><label>章节</label><input class="input" id="qfChap" value="${esc(q?q.chapter==='未设置章节'?'':q.chapter:'')}" placeholder="如 第一章/第一节"></div>
      <div class="field"><label>难度</label><select class="input" id="qfDiff">${DIFF_KEYS.map(d=>`<option value="${d}" ${q&&q.difficulty===d?'selected':''}>${DIFFS[d]}</option>`).join('')}</select></div>
    </div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="qfOk">保存</button></div>`,true);
  const syncType=()=>{
    const t=$('#qfType').value;
    $('#qfOptsBox').style.display=(t==='single'||t==='multi')?'':'none';
    const hints={single:'填选项字母，如 A',multi:'填多个字母，如 ABD',judge:'填 正确 或 错误',blank:'多个可接受答案用 | 分隔',essay:'填参考答案（练习时用户自评）'};
    $('#qfAnsHint').textContent=hints[t];
    if(t==='judge'&&!['正确','错误'].includes($('#qfAns').value))$('#qfAns').value='正确';
  };
  $('#qfType').onchange=syncType;syncType();
  const relabel=()=>{$$('#qfOpts .optK').forEach((k,i)=>k.textContent='ABCDEF'[i]);};
  m.querySelectorAll('.optRm').forEach(b=>b.onclick=()=>{if($$('#qfOpts .optT').length<=2)return toast('至少保留 2 个选项','err');b.parentElement.remove();relabel();});
  $('#qfAddOpt').onclick=()=>{
    if($$('#qfOpts .optT').length>=6)return toast('最多 6 个选项（A–F）','err');
    const d=document.createElement('div');d.style.cssText='display:flex;gap:8px;margin-bottom:6px;align-items:center';
    d.innerHTML=`<span style="width:18px;font-weight:700;color:var(--brand)" class="optK"></span><input class="input optT" placeholder="选项内容"><button class="btn ghost sm danger optRm" type="button">✕</button>`;
    d.querySelector('.optRm').onclick=()=>{d.remove();relabel();};
    $('#qfOpts').appendChild(d);relabel();
  };
  $('#qfOk').onclick=()=>{
    const t=$('#qfType').value,stem=$('#qfStem').value.trim();
    if(!stem)return toast('题干不能为空','err');
    if(stem.length>5000)return toast('题干不能超过 5000 字符','err');
    let options=[],answer=$('#qfAns').value.trim();
    if(t==='single'||t==='multi'){
      options=$$('#qfOpts .optT').map((inp,i)=>({k:'ABCDEF'[i],t:inp.value.trim()})).filter(o=>o.t);
      if(options.length<2)return toast('单选题/多选题至少需要 2 个选项','err');
      const ts=options.map(o=>o.t);if(new Set(ts).size!==ts.length)return toast('选项内容不能重复','err');
      const letters=parseChoiceLetters(answer);
      if(!letters)return toast('答案必须是选项字母','err');
      if(t==='single'&&letters.length!==1)return toast('单选题只能有 1 个答案','err');
      if(t==='multi'&&letters.length<2)return toast('多选题答案至少需要 2 个选项','err');
      if(letters.some(l=>!options.find(o=>o.k===l)))return toast(`答案 ${answer} 不存在于选项 A–F 中`,'err');
      answer=letters.join('');
    }else if(t==='judge'){
      const j=normalizeJudge(answer);if(!j)return toast('无法识别判断题答案，请使用 正确/错误/对/错/√/×','err');answer=j;
    }else{
      if(!answer)return toast('答案不能为空','err');
    }
    const obj={type:t,stem,options,answer,analysis:$('#qfAnalysis').value.trim(),chapter:normalizeChapter($('#qfChap').value),difficulty:$('#qfDiff').value,updatedAt:nowTs()};
    // 手动新增重复提示（不强制阻止）
    const key=dedupeKey(obj);
    const dup=DB.questions.some(x=>x.bankId===bankId&&x.id!==qid&&dedupeKey(x)===key);
    const save=()=>{
      if(q)Object.assign(q,obj);
      else{const maxOrder=Math.max(-1,...bankQuestions(bankId).map(x=>x.order||0));DB.questions.push({id:uid(),bankId,order:maxOrder+1,createdAt:nowTs(),...obj});}
      bankById(bankId).updatedAt=nowTs();saveDB();closeModal();toast('题目已保存','ok');dispatch();
    };
    if(dup)confirmBox('可能重复','题库中已存在相同题干、题型与答案的题目，是否仍要保存？',save,'仍要保存');
    else save();
  };
}
/* ================= 分享 ================= */
function shareDialog(bank){
  const shares=DB.shares.filter(s=>s.bankId===bank.id&&s.status==='active');
  const linkShare=shares.find(s=>s.linkToken);
  const linkUrl=linkShare?location.origin+location.pathname+'#/share/'+linkShare.linkToken:'';
  const m=openModal(`<h3>分享「${esc(bank.name)}」</h3>
    <div class="tabs"><button class="tab active" data-st="user">指定用户</button><button class="tab" data-st="link">分享链接</button></div>
    <div id="shareUser">
      <div class="field"><label>搜索用户（用户名或昵称）</label>
        <div style="display:flex;gap:8px"><input class="input" id="shKw" placeholder="输入关键词搜索"><button class="btn" id="shSearch">搜索</button></div>
      </div>
      <div id="shResults"></div>
    </div>
    <div id="shareLink" class="hidden">
      ${linkShare?`<div class="field"><label>分享链接（访问者需登录后接受）</label>
        <div style="display:flex;gap:8px"><input class="input" readonly value="${esc(linkUrl)}" id="shLinkInput"><button class="btn" id="shCopy">复制</button></div></div>
        <div class="btn-row"><button class="btn sm" id="shReset">重置链接</button><button class="btn sm danger" id="shRevokeLink">撤销链接</button></div>
        <div class="hint" style="margin-top:6px">重置后旧链接立即失效；已接受分享的用户不受影响。</div>`
      :`<p class="small muted">尚未生成分享链接。</p><button class="btn primary" id="shGen">生成链接</button>`}
    </div>
    <h4 style="margin-top:18px">当前分享（${shares.length}）</h4>
    <div>${shares.length?shares.map(s=>{
      const t=s.targetUserId?(DB.users.find(u=>u.id===s.targetUserId)||{}):null;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span>${s.linkToken?'🔗 链接分享':'👤 '+esc(t?(t.nickname||t.username):'用户')}<span class="muted small"> · ${fmtTime(s.createdAt).slice(0,10)}</span></span>
        <button class="btn ghost sm danger" data-revoke="${s.id}">撤销</button></div>`;}).join(''):'<p class="small muted">暂无分享</p>'}</div>
    <div class="modal-foot"><button class="btn" onclick="closeModal()">关闭</button></div>`,true);
  m.querySelectorAll('[data-st]').forEach(t=>t.onclick=()=>{
    m.querySelectorAll('[data-st]').forEach(x=>x.classList.toggle('active',x===t));
    $('#shareUser').classList.toggle('hidden',t.dataset.st!=='user');
    $('#shareLink').classList.toggle('hidden',t.dataset.st!=='link');
  });
  $('#shSearch').onclick=()=>{
    const kw=$('#shKw').value.trim().toLowerCase();if(!kw)return;
    const u=currentUser();
    const found=DB.users.filter(x=>x.id!==u.id&&x.status==='active'&&(x.username.toLowerCase().includes(kw)||(x.nickname||'').toLowerCase().includes(kw)));
    $('#shResults').innerHTML=found.length?found.map(f=>{
      const already=DB.shares.some(s=>s.bankId===bank.id&&s.targetUserId===f.id&&s.status==='active');
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px">
        <span>${esc(f.nickname||f.username)} <span class="muted small">@${esc(f.username)}</span></span>
        ${already?'<span class="tag green">已分享</span>':`<button class="btn sm primary" data-shareto="${f.id}">分享</button>`}</div>`;}).join('')
      :'<p class="small muted">未找到匹配用户</p>';
    $$('#shResults [data-shareto]').forEach(b=>b.onclick=()=>{
      DB.shares.push({id:uid(),bankId:bank.id,ownerId:currentUser().id,targetUserId:b.dataset.shareto,status:'active',createdAt:nowTs()});
      saveDB();toast('已分享','ok');closeModal();shareDialog(bank);
    });
  };
  const gen=$('#shGen');if(gen)gen.onclick=()=>{
    DB.shares.push({id:uid(),bankId:bank.id,ownerId:currentUser().id,linkToken:uid()+uid(),status:'active',createdAt:nowTs()});
    saveDB();closeModal();shareDialog(bank);toast('链接已生成','ok');
  };
  const cp=$('#shCopy');if(cp)cp.onclick=()=>{$('#shLinkInput').select();navigator.clipboard?.writeText($('#shLinkInput').value);toast('已复制','ok');};
  const rs=$('#shReset');if(rs)rs.onclick=()=>{linkShare.linkToken=uid()+uid();saveDB();closeModal();shareDialog(bank);toast('链接已重置，旧链接已失效','ok');};
  const rv=$('#shRevokeLink');if(rv)rv.onclick=()=>{linkShare.status='revoked';saveDB();closeModal();shareDialog(bank);toast('链接已撤销','ok');};
  $$('[data-revoke]').forEach(b=>b.onclick=()=>{
    const s=DB.shares.find(x=>x.id===b.dataset.revoke);s.status='revoked';
    if(s.targetUserId)DB.wrongBook.filter(w=>w.userId===s.targetUserId&&w.bankId===bank.id).forEach(w=>w.status='invalid');
    saveDB();toast('分享已撤销','ok');closeModal();shareDialog(bank);
  });
}
route('#/share/:token',token=>{
  if(!requireAuth())return;
  const s=DB.shares.find(x=>x.linkToken===token);
  const u=currentUser();
  if(!s||s.status!=='active'){
    render(`<div class="card empty"><div class="big">🔗</div><p>链接已失效或不存在</p><button class="btn" onclick="location.hash='#/banks'">返回题库</button></div>`,'#/banks');return;
  }
  const bank=bankById(s.bankId);const owner=DB.users.find(x=>x.id===s.ownerId);
  if(!bank||!owner||owner.status!=='active'){
    render(`<div class="card empty"><div class="big">🔗</div><p>分享已失效</p><button class="btn" onclick="location.hash='#/banks'">返回题库</button></div>`,'#/banks');return;
  }
  if(bank.ownerId===u.id){toast('这是你自己的题库','warn');location.hash='#/bank/'+bank.id;return;}
  const accepted=DB.shares.some(x=>x.bankId===bank.id&&x.targetUserId===u.id&&x.status==='active');
  render(`<div class="card" style="max-width:560px;margin:60px auto;text-align:center">
    <div class="brand-mark" style="margin:0 auto 14px">刷</div>
    <h2 style="font-size:20px">${esc(bank.name)}</h2>
    <p class="muted small" style="margin:8px 0">${esc(bank.intro||'')}</p>
    <div class="meta" style="display:flex;gap:6px;justify-content:center;margin:10px 0"><span class="tag gray">${bankQuestions(bank.id).length} 题</span><span class="tag">来自 ${esc(owner.nickname||owner.username)}</span></div>
    ${accepted?`<p class="small" style="color:var(--green)">你已接受该分享</p><button class="btn primary" onclick="location.hash='#/bank/${bank.id}'">打开题库</button>`
      :`<button class="btn primary lg" id="acceptShare">接受分享</button>`}
  </div>`,'#/banks');
  const b=$('#acceptShare');if(b)b.onclick=()=>{
    DB.shares.push({id:uid(),bankId:bank.id,ownerId:s.ownerId,targetUserId:u.id,viaLink:token,status:'active',createdAt:nowTs()});
    saveDB();toast('已加入「共享给我」','ok');location.hash='#/bank/'+bank.id;
  };
});
