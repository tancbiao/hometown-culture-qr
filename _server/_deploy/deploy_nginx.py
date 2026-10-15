# -*- coding: utf-8 -*-
"""给 api.kexvefuxi.cn 的 nginx 配置加入 /qr/ 反代（家乡文化二维码后端）
   流程：拉取 → 判断是否已存在 → 备份 → 插入 → 写回 → nginx -t → 失败回滚
   用法：python deploy_nginx.py [rollback]
"""
import os
import sys
import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ssh_tool import connect, run, put          # noqa: E402

APICONF = '/www/server/panel/vhost/nginx/api.conf'
HERE = os.path.dirname(os.path.abspath(__file__))
TMP_LOCAL = os.path.join(HERE, '_api.conf.new')
TMP_REMOTE = '/tmp/_api.conf.new'

# 插到 443 server 块里 `location / { proxy_pass :5000 }` 之前
ANCHOR = ('    location / {\n'
          '        proxy_read_timeout 120s;\n'
          '        proxy_connect_timeout 30s;\n'
          '        proxy_pass http://127.0.0.1:5000;')

BLOCK = '''    # 天等县城西小学 家乡文化二维码（四年级课堂工具，Node 服务端口 3213）
    # 2026-10-15 新建：原数据存第三方云，学生课上连不上，改自建后端
    location = /qr { return 301 /qr/; }
    location /qr/ {
        proxy_read_timeout 60s;
        proxy_connect_timeout 30s;
        client_max_body_size 512k;
        proxy_cache off;
        proxy_pass http://127.0.0.1:3213/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Prefix /qr;
    }

'''


def main():
    c = connect()
    try:
        ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')

        if len(sys.argv) > 1 and sys.argv[1] == 'rollback':
            code, out, _ = run(c, 'ls -t %s.bak_* 2>/dev/null | head -1' % APICONF, sudo=True)
            target = out.strip()
            if not target:
                print('没有可回滚的备份')
                return 1
            run(c, 'cp -a %s %s' % (target, APICONF), sudo=True)
            code, out, err = run(c, 'nginx -t', sudo=True)
            print(out, err)
            run(c, 'systemctl reload nginx', sudo=True)
            print('已回滚到', target)
            return 0

        code, out, err = run(c, 'cat %s' % APICONF, sudo=True)
        if code != 0 or 'server {' not in out:
            print('读取 api.conf 失败:', out[:200], err[:200])
            return 1
        content = out
        print('原配置 %d 字节' % len(content.encode('utf-8')))

        if 'location /qr/' in content:
            print('※ 已经存在 /qr/ 配置，跳过插入（仅重启服务）')
            run(c, 'systemctl restart hometown-qr', sudo=True)
            return 0

        if ANCHOR not in content:
            print('✗ 找不到插入锚点，未做任何修改')
            print('  锚点应为 443 块里的 `location / { ... proxy_pass :5000; }`')
            return 1

        content = content.replace(ANCHOR, BLOCK + ANCHOR, 1)

        # 1) 备份
        backup = '%s.bak_%s' % (APICONF, ts)
        run(c, 'cp -a %s %s' % (APICONF, backup), sudo=True)
        print('已备份 →', backup)

        # 2) 写回
        with open(TMP_LOCAL, 'w', encoding='utf-8', newline='\n') as f:
            f.write(content)
        put(c, TMP_LOCAL, TMP_REMOTE)
        run(c, 'install -m 600 %s %s' % (TMP_REMOTE, APICONF), sudo=True)
        print('新配置已写入')

        # 3) 语法校验
        code, out, err = run(c, 'nginx -t', sudo=True)
        print(out.strip(), err.strip())
        if code != 0:
            print('✗ nginx -t 失败 → 回滚')
            run(c, 'cp -a %s %s' % (backup, APICONF), sudo=True)
            run(c, 'nginx -t', sudo=True)
            return 1

        # 4) 重载
        run(c, 'systemctl reload nginx', sudo=True)
        print('✓ nginx 已重载')

        # 5) 自测（带 Host 头走本机，避免 DNS/回环假 404）
        run(c, 'systemctl restart hometown-qr', sudo=True)
        import time
        time.sleep(1.5)
        code, out, err = run(
            c,
            "curl -sk --max-time 8 --resolve api.kexvefuxi.cn:443:127.0.0.1 "
            "https://api.kexvefuxi.cn/qr/api/health")
        print('线上自测:', out.strip()[:200])
        return 0
    finally:
        c.close()


if __name__ == '__main__':
    sys.exit(main())
