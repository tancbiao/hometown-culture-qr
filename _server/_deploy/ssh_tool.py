#!/usr/bin/env python3
"""腾讯云服务器 159.75.134.151 部署辅助：执行命令 + 上传文件

用法：
  python ssh_tool.py run  "命令"          # 以 deploy 身份执行
  python ssh_tool.py sudo "命令"          # 以 root 执行（sudo -n）
  python ssh_tool.py put  本地路径 远端路径
  python ssh_tool.py get  远端路径 本地路径
  python ssh_tool.py test                 # 连通性自检

★ 2026-09-14 SSH 安全加固后的登录方式（重要）：
  - 端口 2222（22 依旧被广西出口链路定向丢包，见 SKILL.md「SSH 三通道」）
  - 用户 **deploy**（普通用户，wheel 组，sudo 免密）；**root 已禁止直接登录**
  - **密码认证已全局禁用**，只能用密钥
  - 密钥：`_deploy/id_she`（AI 专用 ed25519），可用 SHE_SSH_KEY 覆盖
  - 谭谭自己的 `~/.ssh/id_rsa` 同样可登 deploy（保命通道）
  - 服务器只读目录用 sudo 写：先传到 /tmp 再 `sudo cat > 目标`

回滚加固（万一）：
  python _tools/harden_ssh.py rollback
"""
import os
import sys

import paramiko

HERE = os.path.dirname(os.path.abspath(__file__))

HOST = "159.75.134.151"
PORT = int(os.environ.get("SHE_SSH_PORT", "2222"))
USER = os.environ.get("SHE_SSH_USER", "deploy")
KEY = os.environ.get(
    "SHE_SSH_KEY",
    os.path.normpath(os.path.join(HERE, "id_she")),
)
SUDO = "sudo -n "


def connect():
    if not os.path.exists(KEY):
        raise SystemExit("找不到私钥 %s（可用 SHE_SSH_KEY 指定）" % KEY)
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, port=PORT, username=USER, key_filename=KEY, timeout=20,
              allow_agent=False, look_for_keys=False)
    return c


def run(client, cmd, timeout=120, sudo=False):
    """执行命令。sudo=True 时以 root 运行（deploy 免密 sudo）。"""
    full = (SUDO + "sh -c " + _q(cmd)) if sudo else cmd
    stdin, stdout, stderr = client.exec_command(full, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def _q(s):
    return "'" + s.replace("'", "'\"'\"'") + "'"


def put(client, local, remote, sudo=False):
    """上传文件。sudo=True 时先落 /tmp 再以 root 覆盖目标（保留原 inode/权限）。"""
    sftp = client.open_sftp()
    try:
        if sudo:
            tmp = "/tmp/_she_up_" + os.path.basename(remote)
            sftp.put(local, tmp)
            size = os.path.getsize(local)
            d = os.path.dirname(remote)
            if d:
                run(client, "mkdir -p %s" % _q(d), sudo=True)
            code, _o, err = run(client, "cat %s > %s && rm -f %s" % (_q(tmp), _q(remote), _q(tmp)), sudo=True)
            if code != 0:
                raise RuntimeError("sudo 覆盖失败: %s" % err)
            return size
        d = os.path.dirname(remote)
        if d:
            try:
                sftp.stat(d)
            except IOError:
                run(client, "mkdir -p %s" % _q(d))
        sftp.put(local, remote)
        return os.path.getsize(local)
    finally:
        sftp.close()


def get(client, remote, local, sudo=False):
    sftp = client.open_sftp()
    try:
        if sudo:
            tmp = "/tmp/_she_dl_" + os.path.basename(remote)
            run(client, "cp -f %s %s && chmod 644 %s" % (_q(remote), _q(tmp), _q(tmp)), sudo=True)
            sftp.get(tmp, local)
            run(client, "rm -f %s" % _q(tmp), sudo=True)
        else:
            sftp.get(remote, local)
    finally:
        sftp.close()
    return os.path.getsize(local)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    mode = sys.argv[1]
    c = connect()
    try:
        if mode in ("run", "sudo"):
            if len(sys.argv) < 3:
                print("usage: ssh_tool.py run|sudo \"命令\"")
                return 1
            code, out, err = run(c, sys.argv[2], sudo=(mode == "sudo"))
            print(out, end="")
            if err.strip():
                print("[stderr] " + err, end="")
            print("\n[exit] %d" % code)
            return code
        if mode == "put":
            n = put(c, sys.argv[2], sys.argv[3], sudo=("--sudo" in sys.argv))
            print("uploaded %s -> %s (%d bytes)" % (sys.argv[2], sys.argv[3], n))
            return 0
        if mode == "get":
            n = get(c, sys.argv[2], sys.argv[3], sudo=("--sudo" in sys.argv))
            print("downloaded %s -> %s (%d bytes)" % (sys.argv[2], sys.argv[3], n))
            return 0
        if mode == "test":
            code, out, err = run(c, "whoami; sudo -n whoami; hostname; uptime")
            print(out.strip())
            return 0
    finally:
        c.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
