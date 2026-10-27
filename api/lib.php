<?php
/* ================= 公共函数库 ================= */
date_default_timezone_set('Asia/Shanghai');

function cfg(){ static $c=null; if(!$c)$c=require __DIR__.'/config.php'; return $c; }

function db(){
  static $pdo=null;
  if($pdo)return $pdo;
  $c=cfg();
  $pdo=new PDO('mysql:host='.$c['host'].';port='.$c['port'].';dbname='.$c['db'].';charset=utf8mb4',
    $c['user'],$c['pass'],[
      PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES=>false,
    ]);
  return $pdo;
}

function jout($x){ header('Content-Type: application/json; charset=utf-8'); echo json_encode($x,JSON_UNESCAPED_UNICODE); exit; }
function jfail($msg,$code=200){ http_response_code($code); jout(['ok'=>false,'error'=>$msg]); }
function jbody(){ $j=json_decode(file_get_contents('php://input'),true); return is_array($j)?$j:[]; }
function sessStart(){ if(session_status()!==PHP_SESSION_ACTIVE)session_start(); }
function ms(){ return (int)round(microtime(true)*1000); }
function genId(){ return dechex((int)(microtime(true)*1000)).bin2hex(random_bytes(5)); }

function me(){
  sessStart();
  if(empty($_SESSION['uid']))return null;
  $st=db()->prepare('SELECT data FROM users WHERE id=?');
  $st->execute([$_SESSION['uid']]);
  $r=$st->fetch();
  if(!$r)return null;
  $u=json_decode($r['data'],true);
  if(($u['status']??'active')!=='active')return null;
  return $u;
}
function requireMe(){ $u=me(); if(!$u)jfail('unauthorized',401); return $u; }
function isAdm($u){ return $u&&($u['role']??'')==='admin'; }

/* ---------- 行读写 ---------- */
function allRows($t){ $out=[]; foreach(db()->query("SELECT data FROM `$t`") as $r)$out[]=json_decode($r['data'],true); return $out; }
function getRow($t,$id){ $st=db()->prepare("SELECT data FROM `$t` WHERE id=?"); $st->execute([$id]); $r=$st->fetch(); return $r?json_decode($r['data'],true):null; }
function putRow($t,$id,$cols,$data){
  $sets=['data=VALUES(data)']; $names=['id','data']; $vals=[$id,json_encode($data,JSON_UNESCAPED_UNICODE)];
  foreach($cols as $n=>$v){ $names[]=$n; $vals[]=$v; $sets[]="$n=VALUES($n)"; }
  $sql="INSERT INTO `$t` (".implode(',',$names).") VALUES (".rtrim(str_repeat('?,',count($names)),',').") ON DUPLICATE KEY UPDATE ".implode(',',$sets);
  db()->prepare($sql)->execute($vals);
}
function delRow($t,$id){ db()->prepare("DELETE FROM `$t` WHERE id=?")->execute([$id]); }
function metaGet($k,$def=null){ $st=db()->prepare('SELECT data FROM meta WHERE k=?'); $st->execute([$k]); $r=$st->fetch(); return $r?json_decode($r['data'],true):$def; }
function metaPut($k,$v){ db()->prepare('INSERT INTO meta (k,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)')->execute([$k,json_encode($v,JSON_UNESCAPED_UNICODE)]); }

/* ---------- 可见性 ---------- */
function canReadBankArr($bank,$uid,$usersById,$shares){
  if(($bank['ownerId']??'')===$uid)return true;
  foreach($shares as $s){
    if(($s['bankId']??'')===$bank['id'] && ($s['status']??'')==='active' && ($s['targetUserId']??'')===$uid){
      $o=$usersById[$bank['ownerId']??'']??null;
      return $o&&($o['status']??'active')==='active';
    }
  }
  return false;
}

/* ---------- 组装当前用户可见的完整数据 ---------- */
function buildDb($u){
  $uid=$u['id']; $adm=isAdm($u); $p=db();
  $usersAll=allRows('users');
  $usersById=[]; foreach($usersAll as $x)$usersById[$x['id']]=$x;
  $sharesAll=allRows('shares');

  // 可见题库：自有 + 共享给我（有效）；管理员全量
  $banks=[];
  foreach(allRows('banks') as $b){ if($adm||canReadBankArr($b,$uid,$usersById,$sharesAll))$banks[]=$b; }
  $bids=[]; foreach($banks as $b)$bids[]=$b['id'];

  $questions=[];
  if($bids){
    $in=implode(',',array_map([$p,'quote'],$bids));
    foreach($p->query("SELECT data FROM questions WHERE bank_id IN ($in)") as $r)$questions[]=json_decode($r['data'],true);
  }

  // 用户列表：普通用户=活跃用户基础字段+自己全量；管理员=全量（他人不含密码哈希）
  $users=[];
  foreach($usersAll as $x){
    if($x['id']===$uid){ $users[]=$x; continue; }
    if($adm){ $y=$x; unset($y['pwd']); $users[]=$y; }
    else if(($x['status']??'active')==='active'){ $users[]=['id'=>$x['id'],'username'=>$x['username'],'nickname'=>$x['nickname']??'','role'=>$x['role']??'user','status'=>$x['status'],'createdAt'=>$x['createdAt']??0]; }
  }

  $mine=function($t)use($uid,$p){ $st=$p->prepare("SELECT data FROM `$t` WHERE user_id=?"); $st->execute([$uid]); $o=[]; foreach($st as $r)$o[]=json_decode($r['data'],true); return $o; };
  $answers=$mine('answers');
  $wrongBook=$mine('wrongbook');
  $papers=$mine('papers');
  $examRecords=$mine('exam_records');
  $importTasks=$mine('import_tasks');

  // 空作答归一化为对象：json_decode('{}',true) 会变 []，直接回传会被 JSON.stringify 成数组丢键
  foreach($examRecords as &$rr){ if(empty($rr['answers'])||!is_array($rr['answers']))$rr['answers']=new stdClass(); }
  unset($rr);

  // 进行中考试的试卷：剥离答案与解析（防作弊），交卷后才完整下发
  $ongoingPids=[];
  foreach($examRecords as $r){ if(($r['status']??'')==='ongoing')$ongoingPids[$r['paperId']]=true; }
  foreach($papers as &$pp){
    if(isset($ongoingPids[$pp['id']])&&is_array($pp['questions']??null)){
      foreach($pp['questions'] as &$qq){ unset($qq['answer'],$qq['analysis']); }
      unset($qq);
    }
  }
  unset($pp);

  $shares=[];
  foreach($sharesAll as $s){
    if($adm||($s['ownerId']??'')===$uid||($s['targetUserId']??'')===$uid)$shares[]=$s;
  }

  return [
    'settings'=>metaGet('settings',new stdClass()),
    'builtinCategories'=>metaGet('builtinCategories',[]),
    'builtinBanks'=>metaGet('builtinBanks',[]),
    'users'=>array_values($users),
    'banks'=>array_values($banks),
    'questions'=>array_values($questions),
    'answers'=>$answers,
    'wrongBook'=>$wrongBook,
    'papers'=>$papers,
    'examRecords'=>$examRecords,
    'shares'=>array_values($shares),
    'importTasks'=>$importTasks,
    'auditLogs'=>$adm?allRows('audit_logs'):[],
    'practiceSessions'=>new stdClass(),
  ];
}

/* ---------- 判分（与前端 gradeAnswer 等价） ---------- */
function gradeQ($type,$answer,$content){
  if($type==='essay')return null;
  if($type==='single')return mb_strtoupper((string)$content)===mb_strtoupper((string)$answer);
  if($type==='judge')return $content===$answer;
  if($type==='multi'){
    $u=preg_split('//u',(string)$content,-1,PREG_SPLIT_NO_EMPTY); sort($u);
    $a=preg_split('//u',(string)$answer,-1,PREG_SPLIT_NO_EMPTY); sort($a);
    return implode('',$u)===implode('',$a);
  }
  if($type==='blank'){
    $norm=function($s){ return mb_strtolower(trim((string)$s)); };
    foreach(explode('|',(string)$answer) as $acc){ if($acc!==''&&$norm($acc)===$norm($content))return true; }
    return false;
  }
  return false;
}

/* ---------- 合并客户端变更（写穿透） ---------- */
function applyChanges($u,$ups,$del){
  $uid=$u['id']; $adm=isAdm($u); $p=db();
  $p->beginTransaction();
  try{
    /* ---- users ---- */
    if(!empty($ups['users'])&&is_array($ups['users'])){
      foreach($ups['users'] as $row){
        if(!is_array($row)||empty($row['id'])||empty($row['username']))continue;
        $ex=getRow('users',$row['id']);
        if(!$adm){
          if($row['id']!==$uid)continue;                 // 普通用户只能改自己
          if($ex){ $row['role']=$ex['role']; $row['status']=$ex['status']; $row['failCount']=$ex['failCount']??0; $row['lockedUntil']=$ex['lockedUntil']??0; $row['username']=$ex['username']; }
          else continue;                                  // 普通用户不能创建账号
        }else if($ex&&$row['id']===$uid){ $row['role']=$ex['role']; $row['status']=$ex['status']; } // 管理员不能改自己角色/状态
        if(!$ex&&!$adm)continue;
        if($ex){ foreach(['pwd','failCount','lockedUntil'] as $kf){ if(!isset($row[$kf])&&isset($ex[$kf]))$row[$kf]=$ex[$kf]; } } // 行内缺省字段保留旧值（如下发给管理员的他人行不含 pwd）
        putRow('users',$row['id'],['username'=>$row['username'],'role'=>$row['role']??'user','status'=>$row['status']??'active'],$row);
      }
    }
    /* ---- settings / 内置 ---- */
    if($adm){
      if(isset($ups['settings'])&&is_array($ups['settings']))metaPut('settings',$ups['settings']);
      if(isset($ups['builtinCategories'])&&is_array($ups['builtinCategories']))metaPut('builtinCategories',array_values($ups['builtinCategories']));
      if(isset($ups['builtinBanks'])&&is_array($ups['builtinBanks']))metaPut('builtinBanks',array_values($ups['builtinBanks']));
    }
    /* ---- banks ---- */
    $bankOwner=[]; foreach($p->query('SELECT id,owner_id FROM banks') as $r)$bankOwner[$r['id']]=$r['owner_id'];
    if(!empty($ups['banks'])&&is_array($ups['banks'])){
      foreach($ups['banks'] as $b){
        if(!is_array($b)||empty($b['id']))continue;
        $exOwner=$bankOwner[$b['id']]??null;
        if($exOwner===null){ if(($b['ownerId']??'')!==$uid&&!$adm)continue; }
        else{ if($exOwner!==$uid&&!$adm)continue; if(!$adm)$b['ownerId']=$exOwner; }
        putRow('banks',$b['id'],['owner_id'=>$b['ownerId']??$uid],$b);
        $bankOwner[$b['id']]=$b['ownerId']??$uid;
      }
    }
    /* ---- questions ---- */
    if(!empty($ups['questions'])&&is_array($ups['questions'])){
      foreach($ups['questions'] as $q){
        if(!is_array($q)||empty($q['id'])||empty($q['bankId']))continue;
        $o=$bankOwner[$q['bankId']]??null; if($o===null){ $bb=getRow('banks',$q['bankId']); $o=$bb['ownerId']??null; }
        if($o!==$uid&&!$adm)continue;
        putRow('questions',$q['id'],['bank_id'=>$q['bankId']],$q);
      }
    }
    /* ---- 个人数据表 ---- */
    $personal=['answers'=>'answers','wrongBook'=>'wrongbook','importTasks'=>'import_tasks'];
    foreach($personal as $key=>$table){
      if(!empty($ups[$key])&&is_array($ups[$key])){
        foreach($ups[$key] as $row){
          if(!is_array($row)||empty($row['id']))continue;
          $row['userId']=$uid;
          $cols=['user_id'=>$uid];
          if($key!=='importTasks'&&!empty($row['questionId']))$cols['question_id']=$row['questionId'];
          putRow($table,$row['id'],$cols,$row);
        }
      }
      if(!empty($del[$key])&&is_array($del[$key])){
        foreach($del[$key] as $id){
          if(!is_string($id)||strlen($id)>64)continue;
          $st=$p->prepare("DELETE FROM `$table` WHERE id=? AND user_id=?"); $st->execute([$id,$uid]);
        }
      }
    }
    /* ---- papers（插入后不可改，保护快照） ---- */
    if(!empty($ups['papers'])&&is_array($ups['papers'])){
      foreach($ups['papers'] as $pp){
        if(!is_array($pp)||empty($pp['id']))continue;
        if(getRow('papers',$pp['id']))continue;
        $pp['userId']=$uid;
        putRow('papers',$pp['id'],['user_id'=>$uid],$pp);
      }
    }
    /* ---- examRecords：进行中可写；已交卷由服务端判分后只读 ---- */
    if(!empty($ups['examRecords'])&&is_array($ups['examRecords'])){
      foreach($ups['examRecords'] as $r){
        if(!is_array($r)||empty($r['id']))continue;
        $ex=getRow('exam_records',$r['id']);
        if($ex){
          if(($ex['userId']??'')!==$uid)continue;
          if(($ex['status']??'')!=='ongoing')continue;          // 已判分，服务端权威
          if(($r['status']??'ongoing')!=='ongoing')continue;    // 交卷走 exam_submit
          $r['userId']=$uid;
          putRow('exam_records',$r['id'],['user_id'=>$uid,'paper_id'=>$r['paperId']??($ex['paperId']??''),'status'=>'ongoing'],$r);
        }else{
          if(($r['userId']??$uid)!==$uid)$r['userId']=$uid;
          putRow('exam_records',$r['id'],['user_id'=>$uid,'paper_id'=>$r['paperId']??'','status'=>$r['status']??'ongoing'],$r);
        }
      }
    }
    /* ---- shares ---- */
    if(!empty($ups['shares'])&&is_array($ups['shares'])){
      foreach($ups['shares'] as $s){
        if(!is_array($s)||empty($s['id']))continue;
        $ex=getRow('shares',$s['id']);
        $bankOwnerId=$bankOwner[$s['bankId']??'']??null;
        if($bankOwnerId===null&&!empty($s['bankId'])){ $bb=getRow('banks',$s['bankId']); $bankOwnerId=$bb['ownerId']??null; }
        $ok=false;
        if($adm)$ok=true;
        else if($bankOwnerId===$uid)$ok=true;                                     // 题库所有者管理分享
        else if(($s['targetUserId']??'')===$uid){
          if($ex&&($ex['targetUserId']??'')===$uid)$ok=true;                      // 接收方改状态（移除共享）
          else if(!$ex&&!empty($s['viaLink'])){                                   // 通过链接接受分享
            foreach(allRows('shares') as $ls){
              if(($ls['linkToken']??'')===$s['viaLink']&&($ls['bankId']??'')===($s['bankId']??'')&&($ls['status']??'')==='active'){ $ok=true; break; }
            }
          }
        }
        if(!$ok)continue;
        putRow('shares',$s['id'],['bank_id'=>$s['bankId']??'','owner_id'=>$s['ownerId']??'','target_user_id'=>$s['targetUserId']??'','link_token'=>$s['linkToken']??'','status'=>$s['status']??'active'],$s);
      }
    }
    /* ---- 删除：banks / questions / shares / papers ---- */
    if(!empty($del['banks'])&&is_array($del['banks'])){
      foreach($del['banks'] as $id){
        if(!is_string($id))continue;
        $o=$bankOwner[$id]??null; if($o===null){ $bb=getRow('banks',$id); $o=$bb['ownerId']??null; }
        if($o!==$uid&&!$adm)continue;
        delRow('banks',$id);
        $p->prepare('DELETE FROM questions WHERE bank_id=?')->execute([$id]);
        $p->prepare('DELETE FROM shares WHERE bank_id=?')->execute([$id]);
      }
    }
    if(!empty($del['questions'])&&is_array($del['questions'])){
      foreach($del['questions'] as $id){
        if(!is_string($id))continue;
        $q=getRow('questions',$id); if(!$q)continue;
        $o=$bankOwner[$q['bankId']??'']??null; if($o===null){ $bb=getRow('banks',$q['bankId']??''); $o=$bb['ownerId']??null; }
        if($o!==$uid&&!$adm)continue;
        delRow('questions',$id);
      }
    }
    if(!empty($del['shares'])&&is_array($del['shares'])){
      foreach($del['shares'] as $id){
        if(!is_string($id))continue;
        $s=getRow('shares',$id); if(!$s)continue;
        if(($s['ownerId']??'')!==$uid&&!$adm)continue;
        delRow('shares',$id);
      }
    }
    if(!empty($del['papers'])&&is_array($del['papers'])){
      foreach($del['papers'] as $id){
        if(!is_string($id))continue;
        $st=$p->prepare('DELETE FROM papers WHERE id=? AND user_id=?'); $st->execute([$id,$uid]);
      }
    }
    /* ---- 审计日志：仅追加 ---- */
    if(!empty($ups['auditLogs'])&&is_array($ups['auditLogs'])){
      foreach($ups['auditLogs'] as $l){
        if(!is_array($l)||empty($l['id']))continue;
        $st=$p->prepare('INSERT IGNORE INTO audit_logs (id,ts,data) VALUES (?,?,?)');
        $st->execute([$l['id'],$l['ts']??ms(),json_encode($l,JSON_UNESCAPED_UNICODE)]);
      }
    }

    /* ---- 保底：系统至少一名正常管理员 ---- */
    $admins=0; foreach(allRows('users') as $x){ if(($x['role']??'')==='admin'&&($x['status']??'active')==='active')$admins++; }
    if($admins<1)throw new Exception('系统至少需要保留一个正常管理员');

    $p->commit();
  }catch(Throwable $e){
    $p->rollBack();
    jfail('保存失败：'.$e->getMessage());
  }
}
