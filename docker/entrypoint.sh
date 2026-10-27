#!/bin/sh
set -e

cd /var/www/html

# 等待 MySQL 就绪并完成初始化（幂等，重启不会覆盖已有数据）
php docker/init.php

exec apache2-foreground
