'use strict';
/* ================= 管理后台 ================= */
let admTab='overview';
route('#/admin',()=>{
  if(!requireAuth())return;
  if(!isAdmin()){toast('仅管理员可访问','err');location.hash='#/banks';return;}
  const tabs=[['overview','概览'],['users','用户管理'],['builtin','内置题库'],['shares','分享治理'],['settings','系统设置'],['logs','审计日志']];
  render(`<h1 class="page-title">管理后台</h1><div class="page-sub">账号、内置题库、分享与系统设置</div>
    <div class="tabs">${tabs.map(([k,t])=>`<button class="tab ${admTab===k?'active':''}" data-at="${k}">${t}</button>`).join('')}</div>
    <div id="admBody"></div>`,'#/admin');
  $$('[data-at]').forEach(t=>t.onclick=()=>{admTab=t.dataset.at;dispatch();});
  const box=$('#admBody');
  if(admTab==='overview')admOverview(box);
  else if(admTab==='users')admUsers(box);
  else if(admTab==='builtin')admBuiltin(box);
  else if(admTab==='shares')admShares(box);
  else if(admTab==='settings')admSettings(box);
  else admLogs(box);
});
function admOverview(box){
  const totalQ=DB.questions.length;
  const activeShares=DB.shares.filter(s=>s.status==='active').length;
  const week=nowTs()-7*86400000;
  const imps=DB.importTasks.filter(t=>t.createdAt>week);
  let storage=0;DB.users.forEach(u=>storage+=userStorageBytes(u.id));
  box.innerHTML=`<div class="stat-row">
    <div class="stat" data-go="users"><b>${DB.users.length}</b><span>用户总数</span></div>
    <div class="stat" data-go="users"><b style="color:var(--green)">${DB.users.filter(u=>u.status==='active').length}</b><span>正常账号</span></div>
    <div class="stat" data-go="users"><b style="color:var(--red)">${DB.users.filter(u=>u.status==='disabled').length}</b><span>已禁用</span></div>
    <div class="stat"><b>${DB.banks.length}</b><span>题库总数</span></div>
    <div class="stat"><b>${totalQ}</b><span>题目总数</span></div>
    <div class="stat"><b>${fmtSize(storage)}</b><span>存储占用</span></div>
    <div class="stat" data-go="shares"><b>${activeShares}</b><span>生效分享</span></div>
    <div class="stat"><b>${imps.filter(t=>t.status!=='失败').length} / ${imps.filter(t=>t.status==='失败').length}</b><span>近7天导入 成功/失败</span></div>
  </div>
  <p class="small muted">点击用户数可进入用户管理；平台不展示用户私有题目的具体内容。</p>`;
  $$('.stat[data-go]').forEach(s=>s.onclick=()=>{admTab=s.dataset.go;dispatch();});
}
/* ---- 用户管理 ---- */
let userKw='',userRole='全部',userStatus='全部';
function admUsers(box){
  let list=DB.users;
  if(userKw)list=list.filter(u=>u.username.toLowerCase().includes(userKw.toLowerCase())||(u.nickname||'').toLowerCase().includes(userKw.toLowerCase()));
  if(userRole!=='全部')list=list.filter(u=>u.role===userRole);
  if(userStatus!=='全部')list=list.filter(u=>u.status===userStatus);
  const admins=DB.users.filter(u=>u.role==='admin'&&u.status==='active');
  const me=currentUser();
  box.innerHTML=`<div class="card">
    <div class="btn-row" style="margin-bottom:12px">
      <input class="input" id="uKw" placeholder="搜索用户名 / 昵称" value="${esc(userKw)}" style="width:200px">
      <select class="input" id="uRole" style="width:110px"><option>全部</option><option value="admin" ${userRole==='admin'?'selected':''}>管理员</option><option value="user" ${userRole==='user'?'selected':''}>普通用户</option></select>
      <select class="input" id="uStatus" style="width:110px"><option>全部</option><option value="active" ${userStatus==='active'?'selected':''}>正常</option><option value="disabled" ${userStatus==='disabled'?'selected':''}>已禁用</option></select>
      <span style="flex:1"></span><button class="btn primary" id="uNew">＋ 创建账号</button>
    </div>
    <div class="table-wrap"><table><thead><tr><th>用户名</th><th>昵称</th><th>角色</th><th>状态</th><th>存储用量</th><th>注册时间</th><th>操作</th></tr></thead><tbody>
      ${list.map(u=>{
        const isLastAdmin=u.role==='admin'&&u.status==='active'&&admins.length<=1;
        return `<tr><td><strong>${esc(u.username)}</strong>${u.id===me.id?' <span class="tag">我</span>':''}</td>
        <td>${esc(u.nickname||'-')}</td>
        <td>${u.role==='admin'?'<span class="tag accent">管理员</span>':'普通用户'}</td>
        <td>${u.status==='active'?'<span class="tag green">正常</span>':'<span class="tag red">已禁用</span>'}${u.lockedUntil>nowTs()?' <span class="tag amber">锁定中</span>':''}</td>
        <td class="small">${fmtSize(userStorageBytes(u.id))}</td><td class="small">${fmtTime(u.createdAt).slice(0,10)}</td>
        <td class="nowrap">
          ${u.id===me.id?'<span class="muted small">不能操作自己</span>':`
          <button class="btn ghost sm" data-role="${u.id}" ${isLastAdmin?'disabled title="至少保留一个正常管理员"':''}>${u.role==='admin'?'降为普通用户':'设为管理员'}</button>
          <button class="btn ghost sm" data-pwd="${u.id}">重置密码</button>
          <button class="btn ghost sm" data-unlock="${u.id}" ${u.lockedUntil>nowTs()?'':'disabled'}>解锁</button>
          <button class="btn ghost sm danger" data-ban="${u.id}" ${isLastAdmin&&u.status==='active'?'disabled':''}>${u.status==='active'?'禁用':'启用'}</button>`}
        </td></tr>`;}).join('')}
    </tbody></table></div></div>`;
  $('#uKw').onchange=e=>{userKw=e.target.value;dispatch();};
  $('#uRole').onchange=e=>{userRole=e.target.value;dispatch();};
  $('#uStatus').onchange=e=>{userStatus=e.target.value;dispatch();};
  $('#uNew').onclick=()=>{
    openModal(`<h3>创建账号</h3>
      <div class="field"><label>用户名 *</label><input class="input" id="nuUser"></div>
      <div class="field"><label>昵称</label><input class="input" id="nuNick"></div>
      <div class="field"><label>初始密码 *（8–64 位，含字母和数字）</label><input class="input" id="nuPwd"></div>
      <div class="field"><label>角色</label><select class="input" id="nuRole"><option value="user">普通用户</option><option value="admin">管理员</option></select></div>
      <div class="field-err hidden" id="nuErr"></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="nuOk">创建</button></div>`);
    $('#nuOk').onclick=()=>{
      const name=$('#nuUser').value.trim(),pwd=$('#nuPwd').value;const err=$('#nuErr');
      const fail=m=>{err.textContent=m;err.classList.remove('hidden');};
      if(!/^[\u4e00-\u9fa5A-Za-z0-9_]{3,32}$/.test(name))return fail('用户名需 3–32 位，仅含中文、字母、数字、下划线');
      if(DB.users.some(x=>x.username.toLowerCase()===name.toLowerCase()))return fail('用户名已被占用');
      if(pwd.length<8||pwd.length>64||!/[A-Za-z]/.test(pwd)||!/[0-9]/.test(pwd))return fail('初始密码需 8–64 位且含字母和数字');
      DB.users.push({id:uid(),username:name,nickname:$('#nuNick').value.trim()||name,pwd:hashPwd(pwd),role:$('#nuRole').value,status:'active',createdAt:nowTs(),mustChangePwd:false,failCount:0,lockedUntil:0});
      audit('创建账号',name,'成功');saveDB();closeModal();
      openModal(`<h3>账号已创建</h3><p>用户名：<strong>${esc(name)}</strong><br>初始密码：<strong>${esc(pwd)}</strong></p><p class="small muted">请立即转告用户，此密码仅展示一次。</p><div class="modal-foot"><button class="btn primary" onclick="closeModal()">知道了</button></div>`);
      dispatch();
    };
  };
  $$('[data-role]').forEach(b=>b.onclick=()=>{
    const u=DB.users.find(x=>x.id===b.dataset.role);
    const admins2=DB.users.filter(x=>x.role==='admin'&&x.status==='active');
    if(u.role==='admin'&&admins2.length<=1)return toast('系统至少需要保留一个正常管理员','err');
    u.role=u.role==='admin'?'user':'admin';audit('调整角色',u.username,'成功');saveDB();toast('角色已调整','ok');dispatch();
  });
  $$('[data-pwd]').forEach(b=>b.onclick=()=>{
    const u=DB.users.find(x=>x.id===b.dataset.pwd);
    const tmp='R'+Math.random().toString(36).slice(2,8)+'9a';
    u.pwd=hashPwd(tmp);u.mustChangePwd=true;audit('重置密码',u.username,'成功');saveDB();
    openModal(`<h3>密码已重置</h3><p>用户 <strong>${esc(u.username)}</strong> 的临时密码：</p><p style="font-size:20px;font-weight:700;letter-spacing:2px;margin:10px 0">${tmp}</p><p class="small muted">仅展示一次；旧密码已失效，用户下次登录必须修改密码。</p><div class="modal-foot"><button class="btn primary" onclick="closeModal()">知道了</button></div>`);
  });
  $$('[data-unlock]').forEach(b=>b.onclick=()=>{const u=DB.users.find(x=>x.id===b.dataset.unlock);u.lockedUntil=0;u.failCount=0;audit('解除锁定',u.username,'成功');saveDB();dispatch();});
  $$('[data-ban]').forEach(b=>b.onclick=()=>{
    const u=DB.users.find(x=>x.id===b.dataset.ban);
    if(u.status==='active'){
      const admins2=DB.users.filter(x=>x.role==='admin'&&x.status==='active');
      if(u.role==='admin'&&admins2.length<=1)return toast('系统至少需要保留一个正常管理员','err');
      confirmBox('禁用账号',`禁用后 ${esc(u.username)} 的会话与分享立即失效，数据保留。`,()=>{
        u.status='disabled';DB.shares.filter(s=>s.ownerId===u.id).forEach(s=>s.status='invalid');
        audit('禁用账号',u.username,'成功');saveDB();toast('已禁用','ok');dispatch();
      },'禁用',true);
    }else{
      u.status='active';audit('启用账号',u.username,'成功');saveDB();toast('已启用','ok');dispatch();
    }
  });
}
/* ---- 内置题库管理 ---- */
function admBuiltin(box){
  box.innerHTML=`<div class="card">
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn primary" onclick="location.hash='#/import-builtin'">📥 上传内置题库</button>
      <button class="btn" id="catManage">分类管理</button>
    </div>
    ${DB.builtinBanks.length?`<div class="table-wrap"><table><thead><tr><th>名称</th><th>分类</th><th>题量</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead><tbody>
      ${DB.builtinBanks.map(b=>`<tr><td><strong>${esc(b.name)}</strong><div class="small muted">${esc((b.intro||'').slice(0,40))}</div></td>
        <td>${esc(b.category||'未分类')}</td><td>${b.questions.length}</td>
        <td>${b.status==='up'?'<span class="tag green">已上架</span>':'<span class="tag gray">已下架</span>'}</td>
        <td class="small">${fmtTime(b.updatedAt).slice(0,10)}</td>
        <td class="nowrap">
          <button class="btn ghost sm" data-bedit="${b.id}">编辑</button>
          <button class="btn ghost sm" data-btoggle="${b.id}">${b.status==='up'?'下架':'上架'}</button>
          <button class="btn ghost sm danger" data-bdel="${b.id}">删除</button>
        </td></tr>`).join('')}
    </tbody></table></div>`:'<div class="empty"><div class="big">🗃️</div><p>暂无内置题库，点击上方按钮上传</p></div>'}
  </div>`;
  $('#catManage').onclick=()=>{
    openModal(`<h3>分类管理</h3>
      <div id="catList">${DB.builtinCategories.map((c,i)=>{
        const used=DB.builtinBanks.filter(b=>(b.category||'未分类')===c).length;
        return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
          <span style="flex:1">${esc(c)} <span class="small muted">（${used} 个题库）</span></span>
          <button class="btn ghost sm" data-catrename="${i}">重命名</button>
          <button class="btn ghost sm danger" data-catdel="${i}" ${used?'disabled title="需先移走题库"':''}>删除</button></div>`;}).join('')}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><input class="input" id="newCat" placeholder="新分类名称"><button class="btn primary" id="addCat">新增</button></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">关闭</button></div>`);
    $('#addCat').onclick=()=>{const c=$('#newCat').value.trim();if(!c)return;if(DB.builtinCategories.includes(c))return toast('分类已存在','err');DB.builtinCategories.push(c);saveDB();closeModal();dispatch();};
    $$('[data-catrename]').forEach(b=>b.onclick=()=>{
      const i=+b.dataset.catrename;const n=prompt('新的分类名称：',DB.builtinCategories[i]);
      if(!n||!n.trim())return;
      const old=DB.builtinCategories[i];DB.builtinCategories[i]=n.trim();
      DB.builtinBanks.filter(x=>x.category===old).forEach(x=>x.category=n.trim());
      saveDB();closeModal();dispatch();
    });
    $$('[data-catdel]').forEach(b=>b.onclick=()=>{DB.builtinCategories.splice(+b.dataset.catdel,1);saveDB();closeModal();dispatch();});
  };
  $$('[data-bedit]').forEach(b=>b.onclick=()=>{
    const bb=DB.builtinBanks.find(x=>x.id===b.dataset.bedit);
    openModal(`<h3>编辑内置题库</h3>
      <div class="field"><label>名称</label><input class="input" id="beName" value="${esc(bb.name)}" maxlength="60"></div>
      <div class="field"><label>分类</label><select class="input" id="beCat">${DB.builtinCategories.map(c=>`<option ${bb.category===c?'selected':''}>${esc(c)}</option>`).join('')}<option value="">未分类</option></select></div>
      <div class="field"><label>简介</label><textarea class="input" id="beIntro" maxlength="300">${esc(bb.intro||'')}</textarea></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn primary" id="beOk">保存</button></div>`);
    $('#beOk').onclick=()=>{bb.name=$('#beName').value.trim()||bb.name;bb.category=$('#beCat').value||'未分类';bb.intro=$('#beIntro').value.trim();bb.updatedAt=nowTs();saveDB();closeModal();dispatch();};
  });
  $$('[data-btoggle]').forEach(b=>b.onclick=()=>{
    const bb=DB.builtinBanks.find(x=>x.id===b.dataset.btoggle);
    bb.status=bb.status==='up'?'down':'up';bb.updatedAt=nowTs();
    audit(bb.status==='up'?'上架内置题库':'下架内置题库',bb.name,'成功');saveDB();dispatch();
  });
  $$('[data-bdel]').forEach(b=>b.onclick=()=>{
    const bb=DB.builtinBanks.find(x=>x.id===b.dataset.bdel);
    confirmBox('删除内置题库',`删除「${esc(bb.name)}」后目录不再展示；用户已导入的副本不受影响。`,()=>{
      DB.builtinBanks=DB.builtinBanks.filter(x=>x.id!==bb.id);
      audit('删除内置题库',bb.name,'成功');saveDB();toast('已删除','ok');dispatch();
    },'删除',true);
  });
}
/* ---- 分享治理 ---- */
let shareKw='';
function admShares(box){
  let list=DB.shares.filter(s=>s.status==='active');
  if(shareKw)list=list.filter(s=>{
    const b=bankById(s.bankId);const o=DB.users.find(u=>u.id===s.ownerId);const t=DB.users.find(u=>u.id===s.targetUserId);
    return (b&&b.name.includes(shareKw))||(o&&o.username.includes(shareKw))||(t&&t.username.includes(shareKw));
  });
  box.innerHTML=`<div class="card">
    <div class="btn-row" style="margin-bottom:12px"><input class="input" id="sKw" placeholder="按题库或用户搜索" value="${esc(shareKw)}" style="width:220px"></div>
    ${list.length?`<div class="table-wrap"><table><thead><tr><th>题库</th><th>发起人</th><th>接收方</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
      ${list.map(s=>{const b=bankById(s.bankId);const o=DB.users.find(u=>u.id===s.ownerId);const t=DB.users.find(u=>u.id===s.targetUserId);
        return `<tr><td>${esc(b?b.name:'（题库已删除）')}</td><td>${esc(o?o.username:'-')}</td>
        <td>${s.linkToken?'🔗 链接分享':esc(t?(t.nickname||t.username):'-')}</td><td class="small">${fmtTime(s.createdAt)}</td>
        <td><button class="btn ghost sm danger" data-frevoke="${s.id}">强制撤销</button></td></tr>`;}).join('')}
    </tbody></table></div>`:'<div class="empty"><p>暂无生效中的分享</p></div>'}
  </div>`;
  $('#sKw').onchange=e=>{shareKw=e.target.value;dispatch();};
  $$('[data-frevoke]').forEach(b=>b.onclick=()=>{
    openModal(`<h3>强制撤销分享</h3>
      <div class="field"><label>撤销原因（必填，记入审计日志）</label><input class="input" id="rvReason"></div>
      <div class="modal-foot"><button class="btn" onclick="closeModal()">取消</button><button class="btn danger" id="rvOk">强制撤销</button></div>`);
    $('#rvOk').onclick=()=>{
      const reason=$('#rvReason').value.trim();if(!reason)return toast('请填写撤销原因','err');
      const s=DB.shares.find(x=>x.id===b.dataset.frevoke);s.status='revoked';
      if(s.targetUserId)DB.wrongBook.filter(w=>w.userId===s.targetUserId&&w.bankId===s.bankId).forEach(w=>w.status='invalid');
      audit('强制撤销分享',bankById(s.bankId)?.name||s.bankId,'成功',reason);
      saveDB();closeModal();toast('已撤销','ok');dispatch();
    };
  });
}
/* ---- 系统设置 ---- */
function admSettings(box){
  const s=DB.settings;
  box.innerHTML=`<div class="card">
    <div class="field"><label class="check-row" style="cursor:pointer"><input type="checkbox" id="setReg" ${s.openRegister?'checked':''}> 开放注册（关闭后仅管理员可创建账号）</label></div>
    <div class="field"><label class="check-row" style="cursor:pointer"><input type="checkbox" id="setShare" ${s.shareEnabled?'checked':''}> 开启分享功能（关闭后现有分享链接失效，不能新建分享）</label></div>
    <div class="inline-fields">
      <div class="field"><label>每用户存储配额（MB）</label><input class="input" type="number" id="setQuota" value="${s.quotaMB}" min="10"></div>
      <div class="field"><label>单文件上限（MB）</label><input class="input" type="number" id="setFile" value="${s.maxFileMB}" min="1"></div>
      <div class="field"><label>单文件子表数</label><input class="input" type="number" id="setSheets" value="${s.maxSheets}" min="1"></div>
    </div>
    <div class="inline-fields">
      <div class="field"><label>单子表行数上限</label><input class="input" type="number" id="setRows" value="${s.maxRows}" min="10"></div>
      <div class="field"><label>单次导入题目上限</label><input class="input" type="number" id="setPerImp" value="${s.maxPerImport}" min="10"></div>
      <div class="field"><label>错题掌握阈值（连续答对次数）</label><input class="input" type="number" id="setWrong" value="${s.wrongThreshold}" min="1" max="10"></div>
    </div>
    <button class="btn primary" id="setSave">保存设置</button>
  </div>`;
  $('#setSave').onclick=()=>{
    const wasShare=s.shareEnabled;
    s.openRegister=$('#setReg').checked;s.shareEnabled=$('#setShare').checked;
    s.quotaMB=+$('#setQuota').value||1024;s.maxFileMB=+$('#setFile').value||35;
    s.maxSheets=+$('#setSheets').value||30;s.maxRows=+$('#setRows').value||10000;
    s.maxPerImport=+$('#setPerImp').value||20000;s.wrongThreshold=+$('#setWrong').value||2;
    if(wasShare&&!s.shareEnabled)DB.shares.filter(x=>x.linkToken&&x.status==='active').forEach(x=>x.status='invalid');
    audit('修改系统设置','','成功');saveDB();toast('设置已保存','ok');dispatch();
  };
}
/* ---- 审计日志 ---- */
function admLogs(box){
  box.innerHTML=`<div class="card">
    ${DB.auditLogs.length?`<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>目标</th><th>结果</th><th>原因</th></tr></thead><tbody>
      ${DB.auditLogs.slice(0,200).map(l=>`<tr><td class="small nowrap">${fmtTime(l.ts)}</td><td>${esc(l.actor)}</td><td>${esc(l.action)}</td><td>${esc(l.target)}</td><td>${esc(l.result)}</td><td class="small">${esc(l.reason||'-')}</td></tr>`).join('')}
    </tbody></table></div>${DB.auditLogs.length>200?'<p class="small muted">仅展示最近 200 条</p>':''}`:'<div class="empty"><p>暂无审计日志</p></div>'}
  </div>`;
}
