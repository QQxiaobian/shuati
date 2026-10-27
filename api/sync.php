<?php
/* ================= 数据同步接口 =================
   GET  ：返回当前用户可见的完整数据快照（进行中考试的试卷不含答案）
   POST ：{upserts:{表:[行...]}, deletes:{表:[id...]}}，按归属规则合并 */
require __DIR__.'/lib.php';

if($_SERVER['REQUEST_METHOD']==='GET'){
  sessStart();
  $u=me();
  if(!$u){
    // 未登录：仅返回公开设置（登录页需要 openRegister）
    http_response_code(401);
    jout(['ok'=>false,'error'=>'unauthorized','settings'=>['openRegister'=>(bool)(metaGet('settings',[])['openRegister']??true)]]);
  }
  jout(['ok'=>true,'user'=>$u,'db'=>buildDb($u)]);
}

if($_SERVER['REQUEST_METHOD']==='POST'){
  $u=requireMe();
  $j=jbody();
  $ups=$j['upserts']??[]; $del=$j['deletes']??[];
  if(!is_array($ups)||!is_array($del))jfail('请求格式错误',400);
  applyChanges($u,$ups,$del);
  jout(['ok'=>true]);
}

jfail('方法不支持',405);
