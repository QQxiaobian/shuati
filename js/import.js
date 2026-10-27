'use strict';
/* ================= 表格导入向导 ================= */
let IMP=null; // {fileName, sheets:[{name,aoa,include,bankName,headerRow,mapping,optMode}], target, step, results}
const MAP_FIELDS=[['stem','题干 *'],['type','题型'],['answer','答案 *'],['analysis','解析'],['chapter','章节'],['difficulty','难度']];
const OPT_LETTERS='ABCDEF';
route('#/import',()=>{
  if(!requireAuth())return;
  IMP={fileName:'',sheets:[],target:'mine',step:1,results:null,mergeSheets:false,mergedBankName:''};
  renderImport();
});
route('#/import-builtin',()=>{
  if(!requireAuth())return;
  if(!isAdmin()){toast('仅管理员可上传内置题库','err');location.hash='#/banks';return;}
  IMP={fileName:'',sheets:[],target:'builtin',step:1,results:null,mergeSheets:false,mergedBankName:''};
  renderImport();
});
function renderImport(){
  const steps=['上传并解析','逐个确认','逐行校验','确认导入'];
  render(`<div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" onclick="history.back()">← 返回</button></div>
    <h1 class="page-title">${IMP.target==='builtin'?'上传内置题库':'导入表格'}</h1>
    <div class="page-sub">支持 .xlsx / .xls / .csv，每个非空子表可生成一个独立题库</div>
    <div class="steps">${steps.map((s,i)=>`<div class="step ${IMP.step===i+1?'cur':''}"><b>${i+1}</b>${s}</div>`).join('')}</div>
    <div id="impBody"></div>`,'#/banks');
  const box=$('#impBody');
  if(IMP.step===1)impStep1(box);
  else if(IMP.step===2)impStep2(box);
  else if(IMP.step===3)impStep3(box);
  else impStep4(box);
}
/* ---- 步骤1：上传 ---- */
function impStep1(box){
  box.innerHTML=`<div class="card" style="text-align:center;padding:50px 30px">
    <div style="font-size:40px;margin-bottom:10px">📥</div>
    <p style="margin-bottom:6px"><strong>选择要上传的表格文件</strong></p>
    <p class="small muted" style="margin-bottom:18px">单文件不超过 ${DB.settings.maxFileMB} MB；子表不超过 ${DB.settings.maxSheets} 个；单子表不超过 ${DB.settings.maxRows} 行；单次导入不超过 ${DB.settings.maxPerImport} 题</p>
    <input type="file" id="impFile" accept=".xlsx,.xls,.csv" style="display:none">
    <button class="btn primary lg" onclick="document.getElementById('impFile').click()">选择文件</button>
    <div class="field-err hidden" id="impErr" style="margin-top:12px"></div>
  </div>
  <div class="card"><h4 style="margin-bottom:8px">表格要求</h4>
    <ul class="small muted" style="padding-left:1.3em">
      <li>每个子表一张连续数据表；标题行（表头）在第几步都可手动调整，系统会自动跳过文件大标题和重复表头行</li>
      <li>选项支持三种方式：A–F 各占一列；一列内用换行 / <code>|</code> / <code>A. B. C.</code> 分隔；或整道题（含答案、解析）写在一个单元格</li>
      <li>题型列可写：单选/多选/判断/填空/简答（问答/案例/计算等归入简答）；不填时系统自动推断</li>
      <li>答案写法兼容：<code>B</code>、<code>答案：B</code>、<code>正确/错误/对/错/√/×</code>、判断题答案是选项字母（A=正确）也能识别</li>
      <li>空行自动忽略；错误行可跳过，只导入有效行；无答案的问答类题目按简答导入</li>
    </ul></div>`;
  $('#impFile').onchange=e=>{
    const f=e.target.files[0];if(!f)return;
    const err=m=>{const el=$('#impErr');el.textContent=m;el.classList.remove('hidden');};
    if(f.size>DB.settings.maxFileMB*1048576)return err(`文件过大：${fmtSize(f.size)}，限制 ${DB.settings.maxFileMB} MB`);
    if(typeof XLSX==='undefined')return err('表格解析组件加载失败，请检查网络后刷新重试');
    const rd=new FileReader();
    rd.onload=ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:'array'});
        const sheets=[];
        wb.SheetNames.forEach(name=>{
          const aoa=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:'',raw:false});
          const nonEmpty=aoa.some(r=>r.some(c=>String(c).trim()!==''));
          if(nonEmpty)sheets.push({name,aoa,include:true,bankName:name,headerRow:guessHeaderRow(aoa),mapping:null,optMode:'split'});
        });
        if(!sheets.length)return err('文件中没有非空子表');
        if(sheets.length>DB.settings.maxSheets)return err(`子表数量 ${sheets.length} 超过限制 ${DB.settings.maxSheets} 个`);
        const tooBig=sheets.find(s=>s.aoa.length-1>DB.settings.maxRows);
        if(tooBig)return err(`子表「${tooBig.name}」共 ${tooBig.aoa.length-1} 行，超过 ${DB.settings.maxRows} 行限制，请拆分文件`);
        IMP.fileName=f.name;IMP.sheets=sheets;IMP.step=2;renderImport();
      }catch(ex){err('文件解析失败：文件已加密或不是有效的表格文件');}
    };
    rd.onerror=()=>err('文件读取失败，请重试');
    rd.readAsArrayBuffer(f);
  };
}
function firstNonEmptyRow(aoa){for(let i=0;i<aoa.length;i++){if(aoa[i].some(c=>String(c).trim()!==''))return i;}return 0;}
/* 标题行自动探测：在前 15 行中找“表头特征词”命中最多的一行（跳过文件大标题行） */
function guessHeaderRow(aoa){
  const scoreRow=r=>{
    let s=0;
    for(const c of r){
      const h=String(c??'').trim();
      if(!h)continue;
      if(/题干|题目|试题|题型|类型|答案|解析|章节|知识点|难度|难易|序号|候选项|选项|^列$/.test(h))s+=1;
      else if(/^[A-F]$/.test(h))s+=0.5;
    }
    return s;
  };
  let best=-1,bestScore=0;
  const lim=Math.min(aoa.length,15);
  for(let i=0;i<lim;i++){
    const nonEmpty=aoa[i].filter(c=>String(c).trim()!=='').length;
    const sc=scoreRow(aoa[i]);
    if(sc>bestScore||(sc===bestScore&&sc>0&&best>=0&&nonEmpty>aoa[best].filter(c=>String(c).trim()!=='').length)){bestScore=sc;best=i;}
  }
  return bestScore>=2?best:firstNonEmptyRow(aoa);
}
/* ---- 步骤2：子表确认 + 标题行 + 列映射 ---- */
let impCurSheet=0;
function guessMapping(header,aoa,headerRow){
  const m={stem:-1,type:-1,answer:-1,analysis:-1,chapter:-1,difficulty:-1,optSingle:-1};
  OPT_LETTERS.split('').forEach(L=>m['opt'+L]=-1);
  const take=(key,test)=>{for(let i=0;i<header.length;i++){const h=String(header[i]).trim();if(h&&test(h)){if(m[key]===-1){m[key]=i;return;}}}};
  take('stem',h=>/题干|题目|问题|试题/.test(h)&&!/类型|题型|答案|解析|关键词|关键字|制度|依据|编制|审核/.test(h));
  take('type',h=>/题型|类型/.test(h)&&!/是否/.test(h));
  take('answer',h=>/答案|正确答案|标准答案|参考答案/.test(h));
  take('analysis',h=>/解析|解释|说明/.test(h)&&!/制度|依据/.test(h));
  take('chapter',h=>/章节|分类|类别|知识点|科目|模块|专业/.test(h)&&!/难度|题型|是否/.test(h));
  take('difficulty',h=>/难度|难易|能力等级|等级/.test(h));
  OPT_LETTERS.split('').forEach(L=>take('opt'+L,h=>h===L||new RegExp('选项\\s*'+L+'|候选\\s*'+L+'|'+L+'\\s*[\\.、]?$').test(h)));
  if(m.optA===-1)take('optSingle',h=>/选项|选择/.test(h)&&!/题型|方式/.test(h));
  // 内容启发式兜底：题干列找平均文本最长的未映射列；答案列找短文本列
  if(aoa&&typeof headerRow==='number'){
    const mapped=new Set(Object.values(m).filter(v=>v>=0));
    const rows=aoa.slice(headerRow+1,headerRow+31).filter(r=>r.some(c=>String(c).trim()!==''));
    const colCount=Math.max(...aoa.map(r=>r.length),0);
    if(m.stem===-1&&rows.length){
      let best=-1,bestAvg=0;
      for(let c=0;c<colCount;c++){
        if(mapped.has(c))continue;
        const lens=rows.map(r=>String(r[c]??'').trim().length).filter(l=>l>0);
        if(!lens.length)continue;
        const avg=lens.reduce((a,b)=>a+b,0)/lens.length;
        if(avg>bestAvg){bestAvg=avg;best=c;}
      }
      if(best>=0&&bestAvg>10){m.stem=best;mapped.add(best);}
    }
    if(m.answer===-1&&rows.length){
      for(let c=0;c<colCount;c++){
        if(mapped.has(c))continue;
        const vals=rows.map(r=>String(r[c]??'').trim()).filter(Boolean);
        if(vals.length<3)continue;
        const short=vals.filter(v=>v.length<=8);
        const recognizable=short.filter(v=>normalizeJudge(v)||parseChoiceLetters(v));
        if(short.length/vals.length>=0.7&&recognizable.length/vals.length>=0.6){m.answer=c;mapped.add(c);break;}
      }
    }
    // 整题单格探测：某列 ≥30% 的行含两个以上 A. 样式标记，视为“题干+选项+答案在同一格”
    if(m.optA===-1&&m.optSingle===-1&&rows.length){
      for(let c=0;c<colCount;c++){
        const vals=rows.map(r=>String(r[c]??'')).filter(v=>v.trim());
        if(vals.length<3)continue;
        const hits=vals.filter(v=>{
          const s=toHalf(v);
          const marks=s.match(/[A-F][\.、．:：\)]\s*\S/g)||[];
          return marks.length>=2;
        }).length;
        if(hits/vals.length>=0.3){m.whole=c;break;}
      }
    }
  }
  return m;
}
/* 整题单格解析：从一格文本中拆出 题干 / A. B. 选项 / 答案 / 解析 */
function parseWholeQuestion(cell){
  let s=toHalf(cell).replace(/\r/g,'\n').replace(/[ \t]+/g,' ').trim();
  s=s.replace(/^[\(（【\[]?\d{1,4}[\)）】\]\.、．:：]?\s*/,''); // 去题号
  let ans='',analysis='';
  // 答案：支持 答案:B / 【答案】B / 正确答案：B / 答案：正确
  const am=s.match(/(?:【\s*(?:参考|正确|标准)?答案\s*】|(?:参考|正确|标准)?答案)\s*[:：]?\s*([A-F]{1,6}\b|正确|错误|对\b|错\b|√|×|✓|✗)/i);
  if(am){ans=am[1];s=(s.slice(0,am.index)+' '+s.slice(am.index+am[0].length)).trim();}
  // 解析：解析:... / 【解析】...（取到行尾）
  const xm=s.match(/(?:【\s*解析\s*】|解析)\s*[:：]?\s*([\s\S]+)$/);
  if(xm){analysis=xm[1].trim();s=s.slice(0,xm.index).trim();}
  // 选项：A. xxx B. xxx（兼容换行/空格分隔）
  const flat=s.replace(/\n+/g,' ');
  const marks=[];const re=/([A-F])[\.、．:：\)]\s*/g;let mm;
  while((mm=re.exec(flat))!==null)marks.push({k:mm[1],idx:mm.index,len:mm[0].length});
  let stem=flat,options=[];
  if(marks.length>=2){
    stem=flat.slice(0,marks[0].idx).trim();
    for(let i=0;i<marks.length;i++){
      const start=marks[i].idx+marks[i].len;
      const end=i+1<marks.length?marks[i+1].idx:flat.length;
      const t=flat.slice(start,end).trim();
      if(t)options.push({k:marks[i].k,t});
    }
    options=options.slice(0,6).map((o,i)=>({k:OPT_LETTERS[i],t:o.t}));
  }
  return {stem:stem.trim(),options,answer:ans.trim(),analysis};
}
function impStep2(box){
  const sheets=IMP.sheets;
  impCurSheet=Math.min(impCurSheet,sheets.length-1);
  // 初始化所有子表的列映射（避免未访问子表 mapping 为 null 导致下一步校验报错）
  sheets.forEach(s=>{
    if(!s.mapping){
      s.mapping=guessMapping(s.aoa[s.headerRow]||[],s.aoa,s.headerRow);
      if(typeof s.mapping.whole==='number'&&s.mapping.whole>=0){
        s.optMode='whole';
        if(s.mapping.stem<0)s.mapping.stem=s.mapping.whole;
      }
    }
  });
  const sh=sheets[impCurSheet];
  const colCount=Math.max(...sh.aoa.map(r=>r.length),1);
  const headers=sh.aoa[sh.headerRow]||[];
  const colName=i=>String(headers[i]||'').trim()||('第'+(i+1)+'列');
  const previewRows=sh.aoa.slice(Math.max(0,sh.headerRow-1),sh.headerRow+6);
  const mapSelect=(key,label)=>{
    const cur=sh.mapping[key];
    return `<div class="field" style="margin-bottom:8px"><label class="small">${label}</label>
      <select class="input map-sel" data-k="${key}"><option value="-1">— 忽略 —</option>
      ${Array.from({length:colCount},(_,i)=>`<option value="${i}" ${cur===i?'selected':''}>${esc(colName(i))}</option>`).join('')}</select></div>`;
  };
  box.innerHTML=`<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      <strong>文件：${esc(IMP.fileName)}</strong><span class="small muted">${sheets.length} 个非空子表</span>
    </div>
    <div style="margin-bottom:10px">
      <label style="display:inline-flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" id="mergeSheets" ${IMP.mergeSheets?'checked':''}>
        合并所有子表到一个题库（不同子表结构可分别配置列映射）
      </label>
      ${IMP.mergeSheets?`<div class="field" style="margin-top:8px;max-width:420px"><label>合并后题库名称</label><input class="input" id="mergedBankName" value="${esc(IMP.mergedBankName||IMP.fileName.replace(/\.[^.]+$/,''))}" maxlength="60"></div>`:''}
    </div>
    <div class="sheet-tabs">${sheets.map((s,i)=>`<button class="sheet-tab ${i===impCurSheet?'cur':''}" data-i="${i}">${s.include?'☑':'☐'} ${esc(s.name)}（${Math.max(0,s.aoa.length-1-s.headerRow)} 行）</button>`).join('')}</div>
    <label class="check-row" style="margin-bottom:12px"><label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="shInclude" ${sh.include?'checked':''}> 导入该子表，生成题库</label></label>
    <div class="inline-fields">
      <div class="field"><label>题库名称${IMP.mergeSheets?' <span class="small muted">（合并模式下忽略）</span>':''}</label><input class="input" id="shBankName" value="${esc(sh.bankName)}" maxlength="60" ${IMP.target==='builtin'||IMP.mergeSheets?'disabled':''}></div>
      <div class="field"><label>标题行（第几行）</label>
        <select class="input" id="shHeader">${sh.aoa.slice(0,20).map((r,i)=>`<option value="${i}" ${i===sh.headerRow?'selected':''}>第 ${i+1} 行：${esc(r.slice(0,4).map(c=>String(c).trim()).join(' | ').slice(0,50)||'（空行）')}</option>`).join('')}</select>
      </div>
      <div class="field"><label>选项模式</label>
        <select class="input" id="shOptMode"><option value="split" ${sh.optMode==='split'?'selected':''}>分列选项（A–F 各占一列）</option><option value="single" ${sh.optMode==='single'?'selected':''}>单列选项（一列内分隔）</option><option value="whole" ${sh.optMode==='whole'?'selected':''}>整题单格（题干+选项+答案在一格）</option></select>
      </div>
    </div>
    <h4 style="margin:14px 0 8px">列映射 <span class="small muted">系统已按表头自动匹配，可手动调整；同一列不能重复映射</span></h4>
    <div class="map-grid">${MAP_FIELDS.map(([k,l])=>mapSelect(k,l)).join('')}</div>
    <div id="optMapBox">${sh.optMode==='split'
      ?`<h4 style="margin:12px 0 8px">选项列（A–F）</h4><div class="map-grid">${OPT_LETTERS.split('').map(L=>mapSelect('opt'+L,'选项 '+L)).join('')}</div>`
      :sh.optMode==='single'
      ?`<div style="max-width:260px;margin-top:4px">${mapSelect('optSingle','选项列')}</div>`
      :`<p class="small muted" style="margin-top:6px">整题单格模式：系统将从「题干」所映射列的单元格中自动拆出题干、A. B. 选项、「答案：X」和「解析：…」，其余列映射（题型/章节/难度等）仍然有效。</p>`}
    </div>
    <h4 style="margin:16px 0 8px">数据预览</h4>
    <div class="table-wrap"><table class="preview-table"><tbody>
      ${previewRows.map((r,ri)=>{const abs=Math.max(0,sh.headerRow-1)+ri;return `<tr>${sh.aoa.length?`<td class="small muted">${abs+1}</td>`:''}${Array.from({length:colCount},(_,i)=>abs===sh.headerRow?`<th>${esc(String(r[i]??'').slice(0,30))}</th>`:`<td>${esc(String(r[i]??'').slice(0,30))}</td>`).join('')}</tr>`;}).join('')}
    </tbody></table></div>
    <div class="modal-foot" style="justify-content:space-between">
      <button class="btn" id="impBack1">上一步</button>
      <button class="btn primary" id="impNext2">下一步：逐行校验</button>
    </div>
  </div>`;
  $$('.sheet-tab[data-i]').forEach(b=>b.onclick=()=>{impCurSheet=+b.dataset.i;renderImport();});
  $('#mergeSheets').onchange=e=>{IMP.mergeSheets=e.target.checked;renderImport();};
  const mbn=$('#mergedBankName');if(mbn)mbn.oninput=e=>{IMP.mergedBankName=e.target.value;};
  $('#shInclude').onchange=e=>{sh.include=e.target.checked;renderImport();};
  $('#shBankName').oninput=e=>{sh.bankName=e.target.value;};
  $('#shHeader').onchange=e=>{sh.headerRow=+e.target.value;sh.mapping=guessMapping(sh.aoa[sh.headerRow]||[],sh.aoa,sh.headerRow);
    if(typeof sh.mapping.whole==='number'&&sh.mapping.whole>=0){sh.optMode='whole';if(sh.mapping.stem<0)sh.mapping.stem=sh.mapping.whole;}
    else sh.optMode='split';
    renderImport();};
  $('#shOptMode').onchange=e=>{sh.optMode=e.target.value;renderImport();};
  $$('.map-sel').forEach(sel=>sel.onchange=()=>{
    const k=sel.dataset.k,v=+sel.value;
    if(v>=0){ // 同一列不能重复映射
      for(const key of Object.keys(sh.mapping)){if(key!==k&&sh.mapping[key]===v){sh.mapping[key]=-1;}}
    }
    sh.mapping[k]=v;renderImport();
  });
  $('#impBack1').onclick=()=>{IMP.step=1;renderImport();};
  $('#impNext2').onclick=()=>{
    if(!IMP.sheets.some(s=>s.include))return toast('请至少勾选 1 个子表','err');
    for(const s of IMP.sheets){if(!s.include)continue;if(s.mapping.stem<0)return toast(`子表「${s.name}」未映射题干列`,'err');if(s.optMode!=='whole'&&s.mapping.answer<0)return toast(`子表「${s.name}」未映射答案列（若答案在题目格内，请将选项模式改为“整题单格”）`,'err');}
    runValidation();IMP.step=3;renderImport();
  };
}
/* ---- 解析选项 ---- */
function parseSingleCellOptions(cell){
  let s=toHalf(cell).trim();if(!s)return[];
  let parts=s.split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(parts.length<2)parts=s.split('|').map(x=>x.trim()).filter(Boolean);
  if(parts.length<2){
    const m=s.match(/([A-F])[\.、:：]?\s*/g);
    if(m&&m.length>=2){
      parts=[];const re=/([A-F])[\.、:：]?\s*/g;let last=0,match,prevKey=null;const segs=[];
      let mm;const all=[];while((mm=/([A-F])[\.、:：\)]\s*/g.exec(s))!==null)all.push({k:mm[1],idx:mm.index,len:mm[0].length});
      for(let i=0;i<all.length;i++){const start=all[i].idx+all[i].len;const end=i+1<all.length?all[i+1].idx:s.length;parts.push(s.slice(start,end).trim());}
    }
  }
  return parts.map(p=>p.replace(/^([A-F])[\.、:：\)]\s*/,'').trim()).filter(Boolean).slice(0,6).map((t,i)=>({k:OPT_LETTERS[i],t}));
}
/* ---- 步骤3：校验 ---- */
function validateSheetData(sh){
  const rows=sh.aoa.slice(sh.headerRow+1);
  const valid=[],errors=[],dups=[];const seen=new Set();
  const headerVals=new Set((sh.aoa[sh.headerRow]||[]).map(c=>String(c).trim()).filter(Boolean));
  rows.forEach((r,ri)=>{
    const rowNo=sh.headerRow+2+ri;
    if(r.every(c=>String(c).trim()===''))return; // 空行忽略
    // 重复表头行（含多级表头的子表头行）静默跳过：≥2 个单元格与表头文字完全相同
    const eqHeader=r.reduce((n,c)=>{const v=String(c).trim();return n+(v&&headerVals.has(v)?1:0);},0);
    if(eqHeader>=2)return;
    const get=k=>sh.mapping[k]>=0?String(r[sh.mapping[k]]??'').trim():'';
    const fail=(field,reason,raw)=>errors.push({row:rowNo,field,reason,raw:String(raw??'').slice(0,120)});
    let stem,options=[],ansRaw,analysis=get('analysis');
    if(sh.optMode==='whole'){
      const w=parseWholeQuestion(get('stem'));
      stem=w.stem;options=w.options;ansRaw=w.answer||get('answer');
      if(!analysis&&w.analysis)analysis=w.analysis;
    }else{
      stem=get('stem');
      stem=stem.replace(/^\s*[\(（【\[]?\d{1,4}[\)）】\]\.、．:：]?\s*/,''); // 去题号前缀
      if(sh.optMode==='split'){
        OPT_LETTERS.split('').forEach(L=>{let v=sh.mapping['opt'+L]>=0?String(r[sh.mapping['opt'+L]]??'').trim():'';if(v)v=toHalf(v).replace(/^[A-F][\.、:：\)]\s*/,'').trim();if(v)options.push({k:L,t:v});});
      }else if(sh.mapping.optSingle>=0){
        options=parseSingleCellOptions(r[sh.mapping.optSingle]);
      }
      ansRaw=get('answer');
    }
    // 残余垃圾行（只有分类等零星列有值，题干/答案/选项/题型全空）静默跳过
    const typeRaw0=get('type');
    if(!stem&&!ansRaw&&!options.length&&!typeRaw0)return;
    if(!stem){fail('题干','题干不能为空','');return;}
    if(stem.length>5000){fail('题干','题干超过 5000 字符','');return;}
    options=options.filter(o=>o.t).map((o,i)=>({k:OPT_LETTERS[i],t:o.t}));
    if(options.some(o=>o.t.length>1000)){fail('选项','单个选项超过 1000 字符','');return;}
    // 选项文本去重（保留首次出现），答案字母同步重映射
    let ansLetterRemap=null;
    if(new Set(options.map(o=>o.t)).size!==options.length){
      const firstIdx={};const kept=[];const dropTo={};
      for(const o of options){
        if(firstIdx[o.t]!==undefined){dropTo[o.k]=firstIdx[o.t];}
        else{firstIdx[o.t]=o.k;kept.push(o);}
      }
      const oldToNew={};kept.forEach((o,i)=>oldToNew[o.k]=OPT_LETTERS[i]);
      ansLetterRemap={};
      for(const o of options){
        const keptOld=dropTo[o.k]!==undefined?dropTo[o.k]:o.k;
        ansLetterRemap[o.k]=oldToNew[keptOld];
      }
      options=kept.map((o,i)=>({k:OPT_LETTERS[i],t:o.t}));
    }
    // 题型：先看题型列
    const typeRaw=get('type');
    let type=null;
    if(sh.mapping.type>=0&&typeRaw){
      type=normalizeTypeName(typeRaw);
      if(!type){fail('题型',`题型「${typeRaw}」不支持，请使用 单选/多选/判断/填空/简答`,typeRaw);return;}
    }
    // 判断题答案是选项字母（如 A=正确 B=错误）：先转成选项文本
    let ansForJudge=ansRaw;
    if(type==='judge'&&ansRaw&&!normalizeJudge(ansRaw)){
      const letters=parseChoiceLetters(ansRaw);
      if(letters&&letters.length===1&&options.length){
        const idx=OPT_LETTERS.indexOf(letters[0]);
        if(idx>=0&&idx<options.length&&normalizeJudge(options[idx].t))ansForJudge=options[idx].t;
      }
    }
    if(type==='judge')options=[]; // 判断题不需要选项
    // 选项恰好是 正确/错误 两个、答案为字母：按判断题处理
    if((!type||type==='single')&&options.length===2&&normalizeJudge(options[0].t)&&normalizeJudge(options[1].t)){
      const letters=parseChoiceLetters(ansRaw);
      if(letters&&letters.length===1){
        const idx=OPT_LETTERS.indexOf(letters[0]);
        if(idx>=0&&idx<2){type='judge';ansForJudge=options[idx].t;options=[];}
      }
    }
    // 无答案兜底：无选项且题型列未指明（或指明简答类）→ 按简答导入，答案留空
    if(!ansRaw){
      if(options.length===0&&(!type||type==='essay')){
        const q={type:'essay',stem,options:[],answer:'',analysis,chapter:normalizeChapter(get('chapter')),difficulty:normalizeDifficulty(get('difficulty'))};
        const key=dedupeKey(q);
        if(seen.has(key)){dups.push({row:rowNo,stem:stem.slice(0,60)});return;}
        seen.add(key);valid.push(q);return;
      }
      fail('答案','答案不能为空','');return;
    }
    if(!type){
      type=inferType(options.length,ansForJudge||ansRaw);
      if(!type){fail('题型','无法唯一推断题型，请映射题型列',ansRaw);return;}
    }
    // 答案归一化
    let answer=ansRaw;
    if(type==='single'||type==='multi'){
      // 容错降级：无选项且答案是 对/错 → 判断题；仅 1 个选项且答案为 A → 判断题或填空题
      if(options.length<2){
        const j=normalizeJudge(ansRaw);
        if(options.length===0&&j){type='judge';answer=j;options=[];}
        else if(options.length===1){
          const letters1=parseChoiceLetters(ansRaw);
          if(letters1&&letters1.length===1&&letters1[0]==='A'){
            const jt=normalizeJudge(options[0].t);
            if(jt){type='judge';answer=jt;}
            else{type='blank';answer=options[0].t;}
            options=[];
          }else{fail('选项','单选题/多选题至少需要 2 个选项','');return;}
        }else{fail('选项','单选题/多选题至少需要 2 个选项','');return;}
      }else{
      let letters=parseChoiceLetters(ansRaw);
      if(ansLetterRemap&&letters)letters=[...new Set(letters.map(L=>ansLetterRemap[L]||L))].sort();
      if(!letters){fail('答案','选择题答案必须是选项字母',ansRaw);return;}
      if(type==='single'&&letters.length!==1){fail('答案','单选题只能有 1 个答案',ansRaw);return;}
      if(type==='multi'&&letters.length<2){fail('答案','多选题答案至少需要 2 个选项；如只有 1 个请改为单选题',ansRaw);return;}
      if(letters.some(L=>!options.find(o=>o.k===L))){fail('答案',`答案 ${ansRaw} 不存在于选项 A–F 中`,ansRaw);return;}
      answer=letters.join('');
      }
    }else if(type==='judge'){
      const j=normalizeJudge(ansForJudge);
      if(!j){fail('答案','无法识别判断题答案，请使用 正确/错误/对/错/√/×',ansRaw);return;}
      answer=j;
    }else{
      answer=toHalf(ansRaw).replace(/^(参考答案|正确答案|答案)\s*[：:]\s*/,'').replace(/｜/g,'|');
    }
    if(analysis.length>5000){fail('解析','解析超过 5000 字符','');return;}
    const q={type,stem,options,answer,analysis,chapter:normalizeChapter(get('chapter')),difficulty:normalizeDifficulty(get('difficulty'))};
    const key=dedupeKey(q);
    if(seen.has(key)){dups.push({row:rowNo,stem:stem.slice(0,60)});return;}
    seen.add(key);valid.push(q);
  });
  return {valid,errors,dups};
}
function runValidation(){
  IMP.results=IMP.sheets.filter(s=>s.include).map(sh=>({sheet:sh,...validateSheetData(sh)}));
}
function impStep3(box){
  const res=IMP.results;
  let totV=res.reduce((a,r)=>a+r.valid.length,0),totE=res.reduce((a,r)=>a+r.errors.length,0),totD=res.reduce((a,r)=>a+r.dups.length,0);
  let mergedV=totV,crossDup=0;
  if(IMP.mergeSheets){
    const seen=new Set();res.forEach(r=>r.valid.forEach(q=>{const k=dedupeKey(q);if(seen.has(k))crossDup++;else seen.add(k);}));
    mergedV=totV-crossDup;
  }
  box.innerHTML=`<div class="card">
    <h3 style="margin-bottom:10px">校验结果</h3>
    <div class="stat-row">
      <div class="stat"><b style="color:var(--green)">${IMP.mergeSheets?mergedV:totV}</b><span>有效题目${IMP.mergeSheets?'（去重后）':''}</span></div>
      <div class="stat"><b style="color:${totE?'var(--red)':'var(--brand)'}">${totE}</b><span>错误行</span></div>
      <div class="stat"><b style="color:${totD+crossDup?'var(--amber)':'var(--brand)'}">${totD+crossDup}</b><span>重复题（默认跳过）</span></div>
    </div>
    ${IMP.mergeSheets&&crossDup?`<p class="small muted" style="margin-bottom:8px">合并模式：跨子表发现 ${crossDup} 道重复题，将自动去重。</p>`:''}
    ${res.map((r,ri)=>`<h4 style="margin:14px 0 6px">子表「${esc(r.sheet.name)}」→ 题库「${esc(r.sheet.bankName)}」：有效 ${r.valid.length} / 错误 ${r.errors.length} / 重复 ${r.dups.length}</h4>
      ${r.errors.length?`<div class="table-wrap" style="margin-bottom:8px"><table><thead><tr><th>行号</th><th>字段</th><th>错误原因</th><th>原始值</th></tr></thead>
        <tbody>${r.errors.slice(0,50).map(e=>`<tr><td>${e.row}</td><td>${esc(e.field)}</td><td style="color:var(--red)">${esc(e.reason)}</td><td class="small">${esc(e.raw)}</td></tr>`).join('')}</tbody></table></div>
        ${r.errors.length>50?`<p class="small muted">仅展示前 50 条，完整清单请下载错误报告</p>`:''}`:'<p class="small muted">无错误行</p>'}
      ${r.dups.length?`<p class="small muted">重复题行号：${r.dups.slice(0,20).map(d=>d.row).join('、')}${r.dups.length>20?' 等':''}</p>`:''}`).join('')}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn" id="dlErr" ${totE?'':'disabled'}>下载错误报告 (CSV)</button>
      <span style="flex:1"></span>
      <button class="btn" id="impBack2">返回修改</button>
      <button class="btn primary" id="impGo4" ${totV?'':'disabled'}>${totV?`导入 ${totV} 道有效题目`:'没有可导入的题目'}</button>
    </div>
  </div>`;
  $('#impBack2').onclick=()=>{IMP.step=2;renderImport();};
  const dl=$('#dlErr');if(dl)dl.onclick=()=>{
    let csv='﻿子表名,行号,字段,错误原因,原始值\n';
    res.forEach(r=>r.errors.forEach(e=>{csv+=[r.sheet.name,e.row,e.field,e.reason,e.raw].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')+'\n';}));
    const blob=new Blob([csv],{type:'text/csv'});const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='导入错误报告.csv';a.click();URL.revokeObjectURL(a.href);
  };
  const go=$('#impGo4');if(go)go.onclick=()=>{IMP.step=4;renderImport();};
}
/* ---- 步骤4：写入 ---- */
function impStep4(box){
  const res=IMP.results;
  let totV=res.reduce((a,r)=>a+r.valid.length,0),totE=res.reduce((a,r)=>a+r.errors.length,0),totD=res.reduce((a,r)=>a+r.dups.length,0);
  if(IMP.mergeSheets){
    const seen=new Set();res.forEach(r=>r.valid.forEach(q=>{const k=dedupeKey(q);if(seen.has(k))totV--;else seen.add(k);}));
  }
  if(IMP.target==='builtin'){
    box.innerHTML=`<div class="card"><h3 style="margin-bottom:12px">内置题库信息</h3>
      <div class="field"><label>名称 *</label><input class="input" id="bbName" value="${esc(res[0]?res[0].sheet.bankName:'')}" maxlength="60"></div>
      <div class="field"><label>分类</label><select class="input" id="bbCat">${DB.builtinCategories.map(c=>`<option>${esc(c)}</option>`).join('')}<option value="">未分类</option></select></div>
      <div class="field"><label>简介</label><textarea class="input" id="bbIntro" maxlength="300"></textarea></div>
      <div class="modal-foot"><button class="btn" id="impBack3">返回</button><button class="btn primary" id="impWrite">写入 ${totV} 题并上架</button></div></div>`;
    $('#impBack3').onclick=()=>{IMP.step=3;renderImport();};
    $('#impWrite').onclick=()=>{
      const name=$('#bbName').value.trim();if(!name)return toast('名称不能为空','err');
      const questions=[];const seen=new Set();
      res.forEach(r=>r.valid.forEach(q=>{const k=dedupeKey(q);if(!seen.has(k)){seen.add(k);questions.push({id:uid(),...q,options:q.options.map(o=>({...o}))});}}));
      if(!questions.length)return toast('没有可导入的题目','err');
      DB.builtinBanks.push({id:uid(),name,category:$('#bbCat').value||'未分类',intro:$('#bbIntro').value.trim(),status:'up',updatedAt:nowTs(),questions});
      audit('上传内置题库',name,'成功');
      finishImport(box,res,totV,totE,totD,true);
    };
    return;
  }
  // 普通导入：配额检查
  const u=currentUser();
  const size=totV*400; // 粗估每题 400B
  const left=quotaLeft(u.id);
  box.innerHTML=`<div class="card"><h3 style="margin-bottom:12px">确认导入</h3>
    <p>即将创建 <strong>${IMP.mergeSheets?1:res.length}</strong> 个题库，共 <strong>${totV}</strong> 道题目；跳过错误行 ${totE}、重复题 ${totD}。</p>
    <p class="small muted" style="margin-top:6px">当前存储用量 ${fmtSize(userStorageBytes(u.id))} / ${DB.settings.quotaMB} MB，本次预计增加约 ${fmtSize(size)}</p>
    ${size>left?`<p class="field-err">存储配额不足：剩余约 ${fmtSize(Math.max(0,left))}。请删除部分题库或联系管理员调整配额。</p>`:''}
    <div class="modal-foot"><button class="btn" id="impBack3">返回</button><button class="btn primary" id="impWrite" ${size>left?'disabled':''}>确认导入</button></div></div>`;
  $('#impBack3').onclick=()=>{IMP.step=3;renderImport();};
  $('#impWrite').onclick=()=>{
    const u2=currentUser();const created=[];
    if(IMP.mergeSheets){
      // 合并所有子表到一个题库，跨子表去重
      const allValid=[];const seen=new Set();
      res.forEach(r=>r.valid.forEach(q=>{const k=dedupeKey(q);if(!seen.has(k)){seen.add(k);allValid.push(q);}}));
      if(!allValid.length)return toast('没有可导入的题目','err');
      let name=(IMP.mergedBankName||IMP.fileName.replace(/\.[^.]+$/,'')).trim()||IMP.fileName;
      let i=2;while(DB.banks.some(b=>b.ownerId===u2.id&&b.name===name))name=`${IMP.mergedBankName||IMP.fileName.replace(/\.[^.]+$/,'')}(${i++})`;
      const bank={id:uid(),name,intro:'',ownerId:u2.id,source:'import',sourceFile:IMP.fileName,createdAt:nowTs(),updatedAt:nowTs()};
      DB.banks.push(bank);
      allValid.forEach((q,idx)=>DB.questions.push({id:uid(),bankId:bank.id,order:idx,createdAt:nowTs(),updatedAt:nowTs(),...q}));
      created.push({name:bank.name,count:allValid.length});
    }else{
      res.forEach(r=>{
        if(!r.valid.length)return;
        let name=(r.sheet.bankName||r.sheet.name).trim()||r.sheet.name;let i=2;
        while(DB.banks.some(b=>b.ownerId===u2.id&&b.name===name))name=`${r.sheet.bankName||r.sheet.name}(${i++})`;
        const bank={id:uid(),name,intro:'',ownerId:u2.id,source:'import',sourceFile:IMP.fileName,createdAt:nowTs(),updatedAt:nowTs()};
        DB.banks.push(bank);
        r.valid.forEach((q,idx)=>DB.questions.push({id:uid(),bankId:bank.id,order:idx,createdAt:nowTs(),updatedAt:nowTs(),...q}));
        created.push({name:bank.name,count:r.valid.length});
      });
    }
    const task={id:uid(),userId:u2.id,fileName:IMP.fileName,status:totE?(totV?'部分成功':'失败'):'成功',valid:totV,errors:totE,dups:totD,createdAt:nowTs()};
    DB.importTasks.unshift(task);if(DB.importTasks.length>50)DB.importTasks.length=50;
    finishImport(box,res,totV,totE,totD,false,created);
  };
}
function finishImport(box,res,totV,totE,totD,isBuiltin,created){
  saveDB();
  box.innerHTML=`<div class="card" style="text-align:center;padding:40px 24px">
    <div style="font-size:44px">${totV?'🎉':'😥'}</div>
    <h3>${totE===0&&totV?'导入成功':totV?'部分成功':'导入失败'}</h3>
    <p class="muted" style="margin:10px 0 18px">有效 ${totV} 题 · 错误 ${totE} 行 · 重复跳过 ${totD} 题</p>
    ${created?created.map(c=>`<p>📚 ${esc(c.name)}：<strong>${c.count}</strong> 题</p>`).join(''):''}
    <div class="btn-row" style="justify-content:center;margin-top:18px">
      ${isBuiltin?`<button class="btn primary" onclick="location.hash='#/admin'">返回管理后台</button>`
        :`<button class="btn primary" onclick="location.hash='#/banks'">查看我的题库</button>
           <button class="btn" onclick="location.hash='#/import'">继续导入</button>`}
    </div></div>`;
  toast(isBuiltin?'内置题库已上架':'导入完成','ok');
}
