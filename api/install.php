<?php
/* ================= 安装/初始化脚本（浏览器访问） ================= */
date_default_timezone_set('Asia/Shanghai');
$cfg=require __DIR__.'/config.php';

function h($s){ return htmlspecialchars((string)$s,ENT_QUOTES,'UTF-8'); }
function page($title,$body){
  echo '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>'.h($title).'</title>
  <style>body{font-family:"Microsoft YaHei",sans-serif;background:#f2f4f7;padding:40px;color:#17212f}
  .box{max-width:680px;margin:0 auto;background:#fff;border-radius:14px;padding:30px 34px;box-shadow:0 10px 30px rgba(21,42,63,.08)}
  h1{font-size:20px;margin-bottom:14px}.ok{color:#2f7d5c}.err{color:#b54747}
  li{margin:6px 0;font-size:14px}code{background:#eef1f5;padding:1px 6px;border-radius:5px}
  .btn{display:inline-block;background:#1e5d87;color:#fff;padding:10px 22px;border-radius:9px;text-decoration:none;margin-top:14px;border:0;font-size:14px;cursor:pointer}
  </style></head><body><div class="box">'.$body.'</div></body></html>';
  exit;
}

$step=$_GET['step']??'check';

/* ---- 写入管理员（密码哈希由下方页面内 JS 计算后提交） ---- */
if($step==='seed'&&$_SERVER['REQUEST_METHOD']==='POST'){
  $j=json_decode(file_get_contents('php://input'),true);
  $hash=$j['hash']??'';
  if(!preg_match('/^[0-9a-f]{2,32}$/',$hash))page('初始化失败','<p class="err">密码哈希格式不正确。</p>');
  try{
    $pdo=new PDO('mysql:host='.$cfg['host'].';port='.$cfg['port'].';dbname='.$cfg['db'].';charset=utf8mb4',$cfg['user'],$cfg['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $cnt=(int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
    if($cnt>0)page('无需初始化','<p>已有用户存在，跳过初始化。<br><a class="btn" href="../index.html">打开刷题宝</a></p>');
    $now=(int)round(microtime(true)*1000);
    $admin=['id'=>dechex($now).bin2hex(random_bytes(5)),'username'=>'admin','nickname'=>'系统管理员','pwd'=>$hash,'role'=>'admin','status'=>'active','createdAt'=>$now,'mustChangePwd'=>false,'failCount'=>0,'lockedUntil'=>0];
    $pdo->prepare('INSERT INTO users (id,username,role,status,data) VALUES (?,?,?,?,?)')
        ->execute([$admin['id'],'admin','admin','active',json_encode($admin,JSON_UNESCAPED_UNICODE)]);
    $settings=['openRegister'=>true,'quotaMB'=>1024,'maxFileMB'=>35,'maxSheets'=>30,'maxRows'=>10000,'maxPerImport'=>20000,'shareEnabled'=>true,'wrongThreshold'=>2];
    $pdo->prepare('INSERT INTO meta (k,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)')->execute(['settings',json_encode($settings,JSON_UNESCAPED_UNICODE)]);
    $pdo->prepare('INSERT INTO meta (k,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)')->execute(['builtinCategories',json_encode(['资格考试','职业技能'],JSON_UNESCAPED_UNICODE)]);
    $pdo->prepare('INSERT INTO meta (k,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)')->execute(['builtinBanks',json_encode([],JSON_UNESCAPED_UNICODE)]);
    header('Content-Type: application/json'); echo json_encode(['ok'=>true]); exit;
  }catch(Throwable $e){ http_response_code(500); header('Content-Type: application/json'); echo json_encode(['ok'=>false,'error'=>$e->getMessage()]); exit; }
}

/* ---- 检查与建表 ---- */
$log=[];$err=null;
try{
  $pdo=new PDO('mysql:host='.$cfg['host'].';port='.$cfg['port'].';charset=utf8mb4',$cfg['user'],$cfg['pass'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
  $log[]='MySQL 连接成功';
  $pdo->exec("CREATE DATABASE IF NOT EXISTS `{$cfg['db']}` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci");
  $pdo->exec("USE `{$cfg['db']}`");
  $log[]="数据库 <code>{$cfg['db']}</code> 已就绪";

  $tables=[
    'users'=>'id VARCHAR(40) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, role VARCHAR(10), status VARCHAR(12), data MEDIUMTEXT',
    'banks'=>'id VARCHAR(40) PRIMARY KEY, owner_id VARCHAR(40), INDEX idx_owner (owner_id), data MEDIUMTEXT',
    'questions'=>'id VARCHAR(40) PRIMARY KEY, bank_id VARCHAR(40), INDEX idx_bank (bank_id), data MEDIUMTEXT',
    'answers'=>'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), question_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'wrongbook'=>'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), question_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'papers'=>'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'exam_records'=>'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), paper_id VARCHAR(40), status VARCHAR(12), INDEX idx_user (user_id), data MEDIUMTEXT',
    'shares'=>'id VARCHAR(40) PRIMARY KEY, bank_id VARCHAR(40), owner_id VARCHAR(40), target_user_id VARCHAR(40), link_token VARCHAR(80), status VARCHAR(12), INDEX idx_bank (bank_id), data MEDIUMTEXT',
    'import_tasks'=>'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'audit_logs'=>'id VARCHAR(40) PRIMARY KEY, ts BIGINT, data MEDIUMTEXT',
    'meta'=>'k VARCHAR(40) PRIMARY KEY, data MEDIUMTEXT',
  ];
  foreach($tables as $t=>$cols){
    $pdo->exec("CREATE TABLE IF NOT EXISTS `$t` ($cols) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $log[]="数据表 <code>$t</code> 已就绪";
  }
  $cnt=(int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
}catch(Throwable $e){
  $err=$e->getMessage();
}

if($err){
  page('安装失败','<h1>初始化失败</h1><p class="err">'.h($err).'</p>
  <ul><li><b>2002 / Connection refused</b>：MySQL 未启动或端口不对，请在面板中启动 MySQL 并核对端口</li><li><b>1045 / Access denied</b>：账号或密码不对，请核对 <code>api/config.php</code> 中的 user / pass（宝塔的 root 密码在面板「数据库」页查看）</li></ul>
  <a class="btn" href="install.php">重试</a>');
}

if($cnt===0){
  /* 需要初始化管理员：页面内用与前端一致的 cyrb53 算法计算 admin123 的哈希后提交 */
  page('初始化管理员','<h1>建库建表完成</h1><ul>'.implode('',array_map(function($l){return "<li class=\"ok\">✓ $l</li>";},$log)).'</ul>
  <p>点击下方按钮创建默认管理员 <code>admin / admin123</code>（登录后请尽快修改密码）：</p>
  <button class="btn" id="seedBtn">创建管理员并完成安装</button>
  <p id="msg"></p>
  <script>
  function hashPwd(s){const salt="shutibao::";let h1=0xdeadbeef^0x9e3779b9,h2=0x41c6ce57^0x9e3779b9;const str=salt+s;
    for(let i=0;i<str.length;i++){const ch=str.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
    h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
    h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
    return (h2>>>0).toString(16)+(h1>>>0).toString(16);}
  document.getElementById("seedBtn").onclick=async()=>{
    const r=await fetch("install.php?step=seed",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({hash:hashPwd("admin123")})});
    const j=await r.json();
    if(j.ok){document.querySelector(".box").innerHTML="<h1 class=\'ok\'>安装完成 🎉</h1><p>默认管理员：<code>admin / admin123</code></p><p>现在可以打开刷题宝登录使用了。</p><a class=\'btn\' href=\'../index.html\'>打开刷题宝</a>";}
    else document.getElementById("msg").innerHTML="<span class=\'err\'>失败："+(j.error||"未知错误")+"</span>";
  };
  </script>');
}

page('已安装','<h1 class="ok">环境正常</h1><ul>'.implode('',array_map(function($l){return "<li class=\"ok\">✓ $l</li>";},$log)).'</ul>
<p>已有 '.$cnt.' 个用户，无需初始化。<br><a class="btn" href="../index.html">打开刷题宝</a></p>');
