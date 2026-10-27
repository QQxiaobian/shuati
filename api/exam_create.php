<?php
/* ================= 生成模拟试卷 =================
   服务端抽题并保存完整快照（含答案）；返回给前端的试卷剥离答案与解析 */
require __DIR__.'/lib.php';

$u=requireMe();
$uid=$u['id'];
$j=jbody();

$name=trim((string)($j['name']??''))?:('模拟试卷 '.date('m-d H:i'));
$bankIds=array_values(array_filter((array)($j['banks']??[]),'is_string'));
$counts=(array)($j['counts']??[]);
$scores=(array)($j['scores']??[]);
$chaps=array_values(array_filter((array)($j['chaps']??[]),'is_string'));
$diffs=array_values(array_filter((array)($j['diffs']??[]),'is_string'));
$duration=max(1,min(300,(int)($j['duration']??90)));
$passPct=max(1,min(100,(int)($j['passPct']??60)));

if(!$bankIds)jfail('请至少选择 1 个题库');
$types=['single','multi','judge','blank'];
$totalWanted=0; foreach($types as $t)$totalWanted+=max(0,(int)($counts[$t]??0));
if($totalWanted<1)jfail('总题量至少为 1 题');

/* 可见性校验 */
$p=db();
$usersById=[]; foreach(allRows('users') as $x)$usersById[$x['id']]=$x;
$sharesAll=allRows('shares');
$visibleBids=[];
foreach($bankIds as $bid){
  $b=getRow('banks',$bid);
  if($b&&(isAdm($u)||canReadBankArr($b,$uid,$usersById,$sharesAll)))$visibleBids[]=$bid;
}
if(!$visibleBids)jfail('所选题库不可用');

$in=implode(',',array_map([$p,'quote'],$visibleBids));
$pool=[];
foreach($p->query("SELECT data FROM questions WHERE bank_id IN ($in)") as $r){
  $q=json_decode($r['data'],true);
  if(($q['type']??'')==='essay')continue;
  if($chaps){
    $qc=$q['chapter']??'未设置章节'; $hit=false;
    foreach($chaps as $c){ if($qc===$c||mb_strpos($qc,$c.'/')===0){ $hit=true; break; } }
    if(!$hit)continue;
  }
  if($diffs&&!in_array($q['difficulty']??'none',$diffs,true))continue;
  $pool[]=$q;
}
/* 去重（与前端 dedupeKey 等价） */
$seen=[]; $dedup=[];
foreach($pool as $q){
  $opts=array_map(function($o){ return trim((string)($o['t']??'')); },(array)($q['options']??[]));
  sort($opts);
  $ans=($q['type']??'')==='blank'?mb_strtolower(trim((string)($q['answer']??''))):(string)($q['answer']??'');
  $key=preg_replace('/\s+/u',' ',trim((string)($q['stem']??''))).'##'.($q['type']??'').'##'.implode('|',$opts).'##'.$ans;
  if(isset($seen[$key]))continue;
  $seen[$key]=true; $dedup[]=$q;
}
$pool=$dedup;

/* 按题型抽题 */
$byType=['single'=>[],'multi'=>[],'judge'=>[],'blank'=>[]];
foreach($pool as $q){ if(isset($byType[$q['type']]))$byType[$q['type']][]=$q; }
$gaps=[]; $picked=[];
foreach($types as $t){
  $want=max(0,(int)($counts[$t]??0)); if(!$want)continue;
  $av=$byType[$t]; shuffle($av);
  if(count($av)<$want)$gaps[]=['t'=>$t,'want'=>$want,'have'=>count($av)];
  else{
    $sc=max(0.5,(float)($scores[$t]??1));
    foreach(array_slice($av,0,$want) as $q)$picked[]=['q'=>$q,'score'=>$sc];
  }
}
if($gaps)jout(['ok'=>false,'error'=>'题量不足','gaps'=>$gaps]);

/* 快照：按题型顺序（单选→多选→判断→填空），段内已随机 */
$snap=[]; $no=1;
foreach($picked as $x){
  $q=$x['q'];
  $snap[]=[
    'qid'=>$q['id'],'bankId'=>$q['bankId'],'no'=>$no++,'type'=>$q['type'],
    'stem'=>$q['stem']??'','options'=>array_values(array_map(function($o){ return ['k'=>$o['k']??'','t'=>$o['t']??'']; },(array)($q['options']??[]))),
    'answer'=>$q['answer']??'','analysis'=>$q['analysis']??'',
    'chapter'=>$q['chapter']??'未设置章节','difficulty'=>$q['difficulty']??'none','score'=>$x['score'],
  ];
}
$totalScore=round(array_sum(array_column($snap,'score')),1);
$now=ms();
$paper=['id'=>genId(),'userId'=>$uid,'name'=>$name,
  'config'=>['banks'=>$visibleBids,'counts'=>$counts,'scores'=>$scores,'duration'=>$duration,'passPct'=>$passPct],
  'questions'=>$snap,'total'=>count($snap),'totalScore'=>$totalScore,
  'passScore'=>(int)round($totalScore*$passPct/100),'createdAt'=>$now];
$rec=['id'=>genId(),'paperId'=>$paper['id'],'userId'=>$uid,'answers'=>new stdClass(),
  'startedAt'=>$now,'deadline'=>$now+$duration*60000,'status'=>'ongoing','score'=>null,'submittedAt'=>null];

putRow('papers',$paper['id'],['user_id'=>$uid],$paper);
putRow('exam_records',$rec['id'],['user_id'=>$uid,'paper_id'=>$paper['id'],'status'=>'ongoing'],$rec);

/* 返回给前端的试卷剥离答案与解析 */
$paperOut=$paper;
foreach($paperOut['questions'] as &$qq){ unset($qq['answer'],$qq['analysis']); }
unset($qq);
jout(['ok'=>true,'paper'=>$paperOut,'record'=>$rec]);
