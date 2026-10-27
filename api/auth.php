<?php
/* ================= 认证接口 ================= */
require __DIR__.'/lib.php';

$j=jbody();
$action=$j['action']??($_GET['action']??'');

/* ---- 登录 ---- */
if($action==='login'){
  sessStart();
  $name=trim((string)($j['username']??'')); $pwd=(string)($j['pwd']??'');
  if($name===''||$pwd==='')jfail('用户名或密码错误');
  $st=db()->prepare('SELECT data FROM users WHERE LOWER(username)=LOWER(?)');
  $st->execute([$name]);
  $r=$st->fetch();
  $u=$r?json_decode($r['data'],true):null;
  if(!$u)jfail('用户名或密码错误');
  if(($u['status']??'active')==='disabled')jfail('账号已停用，请联系管理员');
  $now=ms();
  if(($u['lockedUntil']??0)>$now)jfail('登录已锁定，请 '.ceil(($u['lockedUntil']-$now)/60000).' 分钟后再试');
  if(($u['pwd']??'')!==$pwd){
    $u['failCount']=($u['failCount']??0)+1;
    if($u['failCount']>=5){ $u['lockedUntil']=$now+10*60*1000; $u['failCount']=0;
      putRow('users',$u['id'],['username'=>$u['username'],'role'=>$u['role'],'status'=>$u['status']],$u);
      jfail('连续失败 5 次，账号锁定 10 分钟');
    }
    putRow('users',$u['id'],['username'=>$u['username'],'role'=>$u['role'],'status'=>$u['status']],$u);
    jfail('用户名或密码错误');
  }
  $u['failCount']=0; $u['lockedUntil']=0;
  putRow('users',$u['id'],['username'=>$u['username'],'role'=>$u['role'],'status'=>$u['status']],$u);
  session_regenerate_id(true);
  $_SESSION['uid']=$u['id'];
  jout(['ok'=>true,'user'=>$u,'db'=>buildDb($u)]);
}

/* ---- 注册 ---- */
if($action==='register'){
  $settings=metaGet('settings',[]);
  if(empty($settings['openRegister']))jfail('注册已关闭，如需账号请联系管理员');
  $name=trim((string)($j['username']??'')); $nick=trim((string)($j['nickname']??'')); $pwd=(string)($j['pwd']??'');
  if(!preg_match('/^[\x{4e00}-\x{9fa5}A-Za-z0-9_]{3,32}$/u',$name))jfail('用户名需 3–32 位，仅含中文、字母、数字、下划线');
  if(!preg_match('/^[0-9a-f]{2,32}$/',$pwd))jfail('密码格式不正确');
  if($nick&&(mb_strlen($nick)>30))jfail('昵称 1–30 个字符');
  $st=db()->prepare('SELECT COUNT(*) c FROM users WHERE LOWER(username)=LOWER(?)');
  $st->execute([$name]);
  if((int)$st->fetch()['c']>0)jfail('用户名已被占用');
  $u=['id'=>genId(),'username'=>$name,'nickname'=>$nick?:$name,'pwd'=>$pwd,'role'=>'user','status'=>'active','createdAt'=>ms(),'mustChangePwd'=>false,'failCount'=>0,'lockedUntil'=>0];
  putRow('users',$u['id'],['username'=>$u['username'],'role'=>'user','status'=>'active'],$u);
  jout(['ok'=>true]);
}

/* ---- 修改密码 ---- */
if($action==='changepwd'){
  $u=requireMe();
  $old=(string)($j['old']??''); $pwd=(string)($j['pwd']??'');
  if(!preg_match('/^[0-9a-f]{2,32}$/',$pwd))jfail('密码格式不正确');
  if(empty($u['mustChangePwd'])&&($u['pwd']??'')!==$old)jfail('旧密码不正确');
  $u['pwd']=$pwd; $u['mustChangePwd']=false;
  putRow('users',$u['id'],['username'=>$u['username'],'role'=>$u['role'],'status'=>$u['status']],$u);
  sessStart(); $_SESSION=[]; session_destroy();
  jout(['ok'=>true]);
}

/* ---- 退出 ---- */
if($action==='logout'){
  sessStart(); $_SESSION=[]; session_destroy();
  jout(['ok'=>true]);
}

jfail('未知操作',400);
