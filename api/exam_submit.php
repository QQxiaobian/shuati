<?php
/* ================= 交卷判分 =================
   服务端用完整试卷快照判分，写入成绩；错题回流到答题记录与错题本 */
require __DIR__.'/lib.php';

$u=requireMe();
$uid=$u['id'];
$j=jbody();
$rid=(string)($j['recordId']??'');
if($rid==='')jfail('缺少考试记录 ID');

$rec=getRow('exam_records',$rid);
if(!$rec||($rec['userId']??'')!==$uid)jfail('考试记录不存在');
if(($rec['status']??'')!=='ongoing')jout(['ok'=>true,'already'=>true,'score'=>$rec['score']??null,'status'=>$rec['status']??'']); // 幂等

$paper=getRow('papers',$rec['paperId']??'');
if(!$paper)jfail('试卷不存在');

$now=ms();
$deadline=(int)($rec['deadline']??0);
$status=$now>$deadline+30000?'timeout':'submitted'; // 30 秒宽限（网络/本地时钟误差）

$p=db();
$p->beginTransaction();
try{
  $score=0; $wrongOnce=[];
  $answers=(array)($rec['answers']??[]);
  $usersById=[]; foreach(allRows('users') as $x)$usersById[$x['id']]=$x; // 循环外构建，避免逐题全表查询
  $sharesAll=allRows('shares');
  foreach((array)$paper['questions'] as $q){
    $a=$answers[$q['qid']]??null;
    $content=is_array($a)?($a['content']??''):'';
    $right=$a?gradeQ($q['type'],$q['answer']??'',$content):false;
    if($right===true){ $score+=(float)$q['score']; continue; }
    if(isset($wrongOnce[$q['qid']]))continue;
    $wrongOnce[$q['qid']]=true;
    /* 错题回流：原题仍存在且当前可读才记录 */
    $src=getRow('questions',$q['qid']);
    if(!$src)continue;
    $bank=getRow('banks',$src['bankId']??'');
    if(!$bank)continue;
    if(!isAdm($u)&&!canReadBankArr($bank,$uid,$usersById,$sharesAll))continue;
    $ansRow=['id'=>genId(),'userId'=>$uid,'questionId'=>$src['id'],'bankId'=>$src['bankId'],
      'content'=>$content,'correct'=>false,'source'=>'exam','ts'=>$now];
    putRow('answers',$ansRow['id'],['user_id'=>$uid,'question_id'=>$src['id']],$ansRow);
    /* 错题本 */
    $w=null;
    $st=$p->prepare('SELECT data FROM wrongbook WHERE user_id=? AND question_id=?');
    $st->execute([$uid,$src['id']]);
    if($r=$st->fetch())$w=json_decode($r['data'],true);
    if(!$w)$w=['id'=>genId(),'userId'=>$uid,'questionId'=>$src['id'],'bankId'=>$src['bankId'],'wrongCount'=>0,'streak'=>0,'status'=>'unmastered','lastWrongTs'=>0];
    $w['wrongCount']=($w['wrongCount']??0)+1; $w['streak']=0; $w['status']='unmastered'; $w['lastWrongTs']=$now;
    putRow('wrongbook',$w['id'],['user_id'=>$uid,'question_id'=>$src['id']],$w);
  }
  $score=round($score,1);
  $rec['score']=$score; $rec['status']=$status; $rec['submittedAt']=$now;
  putRow('exam_records',$rec['id'],['user_id'=>$uid,'paper_id'=>$rec['paperId'],'status'=>$status],$rec);
  $p->commit();
}catch(Throwable $e){
  $p->rollBack();
  jfail('判分失败：'.$e->getMessage());
}
jout(['ok'=>true,'score'=>$score,'status'=>$status,'submittedAt'=>$now]);
