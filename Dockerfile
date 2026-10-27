FROM php:8.2-apache

# MySQL 扩展 + mbstring（后端判分用到 mb_* 函数）
RUN docker-php-ext-install pdo_mysql mbstring

# 启动时自动等待数据库、建库建表、创建默认管理员
COPY docker/entrypoint.sh /usr/local/bin/shuati-entrypoint
RUN chmod +x /usr/local/bin/shuati-entrypoint

COPY . /var/www/html/
RUN chown -R www-data:www-data /var/www/html

ENTRYPOINT ["shuati-entrypoint"]
CMD ["apache2-foreground"]
