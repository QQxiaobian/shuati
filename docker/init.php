<?php
/* ================= Docker 启动初始化 =================
   等待 MySQL 就绪 → 建库建表 → 首次启动创建默认管理员
   幂等：已有用户时不会重复创建或覆盖数据 */
date_default_timezone_set('Asia/Shanghai');

$cfg = require __DIR__ . '/../api/config.php';

function initLog($msg) {
    fwrite(STDOUT, '[init] ' . $msg . PHP_EOL);
}

/* 与前端 js/core.js 的 hashPwd 完全一致的 cyrb53 实现（32 位无符号运算） */
function imul32($a, $b) {
    $a &= 0xFFFFFFFF;
    $b &= 0xFFFFFFFF;
    $al = $a & 0xFFFF;
    $ah = ($a >> 16) & 0xFFFF;
    $bl = $b & 0xFFFF;
    $bh = ($b >> 16) & 0xFFFF;
    return (($al * $bl) + ((($ah * $bl + $al * $bh) & 0xFFFF) << 16)) & 0xFFFFFFFF;
}
function hashPwd($s) {
    $salt = 'shutibao::';
    $h1 = (0xdeadbeef ^ 0x9e3779b9) & 0xFFFFFFFF;
    $h2 = (0x41c6ce57 ^ 0x9e3779b9) & 0xFFFFFFFF;
    $str = $salt . $s;
    $utf16 = mb_convert_encoding($str, 'UTF-16LE', 'UTF-8');
    $len = intdiv(strlen($utf16), 2);
    for ($i = 0; $i < $len; $i++) {
        $ch = unpack('v', $utf16, $i * 2)[1];
        $h1 = imul32($h1 ^ $ch, 2654435761);
        $h2 = imul32($h2 ^ $ch, 1597334677);
    }
    $h1 = imul32($h1 ^ ($h1 >> 16), 2246822507) ^ imul32($h2 ^ ($h2 >> 13), 3266489909);
    $h2 = imul32($h2 ^ ($h2 >> 16), 2246822507) ^ imul32($h1 ^ ($h1 >> 13), 3266489909);
    return dechex($h2 & 0xFFFFFFFF) . dechex($h1 & 0xFFFFFFFF);
}

$adminUser = getenv('ADMIN_USERNAME') ?: 'admin';
$adminPass = getenv('ADMIN_PASSWORD') ?: 'admin123';

/* ---- 等待 MySQL ---- */
$pdo = null;
$maxAttempts = 60;
for ($i = 1; $i <= $maxAttempts; $i++) {
    try {
        $pdo = new PDO(
            'mysql:host=' . $cfg['host'] . ';port=' . $cfg['port'] . ';charset=utf8mb4',
            $cfg['user'],
            $cfg['pass'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
        );
        initLog('MySQL 连接成功');
        break;
    } catch (Throwable $e) {
        if ($i === $maxAttempts) {
            fwrite(STDERR, '[init] 无法连接 MySQL：' . $e->getMessage() . PHP_EOL);
            exit(1);
        }
        if ($i === 1) {
            initLog('等待 MySQL 就绪…');
        }
        sleep(2);
    }
}

/* ---- 建库建表 ---- */
$pdo->exec("CREATE DATABASE IF NOT EXISTS `{$cfg['db']}` DEFAULT CHARSET utf8mb4 COLLATE utf8mb4_general_ci");
$pdo->exec("USE `{$cfg['db']}`");

$tables = [
    'users'        => 'id VARCHAR(40) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, role VARCHAR(10), status VARCHAR(12), data MEDIUMTEXT',
    'banks'        => 'id VARCHAR(40) PRIMARY KEY, owner_id VARCHAR(40), INDEX idx_owner (owner_id), data MEDIUMTEXT',
    'questions'    => 'id VARCHAR(40) PRIMARY KEY, bank_id VARCHAR(40), INDEX idx_bank (bank_id), data MEDIUMTEXT',
    'answers'      => 'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), question_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'wrongbook'    => 'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), question_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'papers'       => 'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'exam_records' => 'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), paper_id VARCHAR(40), status VARCHAR(12), INDEX idx_user (user_id), data MEDIUMTEXT',
    'shares'       => 'id VARCHAR(40) PRIMARY KEY, bank_id VARCHAR(40), owner_id VARCHAR(40), target_user_id VARCHAR(40), link_token VARCHAR(80), status VARCHAR(12), INDEX idx_bank (bank_id), data MEDIUMTEXT',
    'import_tasks' => 'id VARCHAR(40) PRIMARY KEY, user_id VARCHAR(40), INDEX idx_user (user_id), data MEDIUMTEXT',
    'audit_logs'   => 'id VARCHAR(40) PRIMARY KEY, ts BIGINT, data MEDIUMTEXT',
    'meta'         => 'k VARCHAR(40) PRIMARY KEY, data MEDIUMTEXT',
];
foreach ($tables as $name => $cols) {
    $pdo->exec("CREATE TABLE IF NOT EXISTS `$name` ($cols) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}
initLog('数据库表已就绪');

/* ---- 首次启动创建默认管理员 ---- */
$cnt = (int)$pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
if ($cnt === 0) {
    $now = (int)round(microtime(true) * 1000);
    $admin = [
        'id' => dechex($now) . bin2hex(random_bytes(5)),
        'username' => $adminUser,
        'nickname' => '系统管理员',
        'pwd' => hashPwd($adminPass),
        'role' => 'admin',
        'status' => 'active',
        'createdAt' => $now,
        'mustChangePwd' => false,
        'failCount' => 0,
        'lockedUntil' => 0,
    ];
    $pdo->prepare('INSERT INTO users (id,username,role,status,data) VALUES (?,?,?,?,?)')
        ->execute([$admin['id'], $admin['username'], 'admin', 'active', json_encode($admin, JSON_UNESCAPED_UNICODE)]);

    $settings = ['openRegister' => true, 'quotaMB' => 1024, 'maxFileMB' => 35, 'maxSheets' => 30, 'maxRows' => 10000, 'maxPerImport' => 20000, 'shareEnabled' => true, 'wrongThreshold' => 2];
    $stmt = $pdo->prepare('INSERT IGNORE INTO meta (k,data) VALUES (?,?)');
    $stmt->execute(['settings', json_encode($settings, JSON_UNESCAPED_UNICODE)]);
    $stmt->execute(['builtinCategories', json_encode(['资格考试', '职业技能'], JSON_UNESCAPED_UNICODE)]);
    $stmt->execute(['builtinBanks', json_encode([], JSON_UNESCAPED_UNICODE)]);
    initLog("已创建默认管理员：{$adminUser} / {$adminPass}");
} else {
    initLog("已有 {$cnt} 个用户，跳过管理员创建");
}

initLog('初始化完成');
