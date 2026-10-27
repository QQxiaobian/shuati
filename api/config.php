<?php
// 数据库连接配置 —— 优先读取环境变量（Docker），未设置时使用本机默认值
$env = function ($key, $default) {
    $v = getenv($key);
    return ($v === false || $v === '') ? $default : $v;
};
return [
  'host'    => $env('DB_HOST', '127.0.0.1'),
  'port'    => (int)$env('DB_PORT', '3306'),
  'db'      => $env('DB_NAME', 'shutibao'),
  'user'    => $env('DB_USER', 'root'),
  'pass'    => $env('DB_PASS', 'root1234'),        // phpStudy 默认 MySQL root 密码，如修改过请同步修改
  'charset' => 'utf8mb4',
];
