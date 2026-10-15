# -*- coding: utf-8 -*-
"""构建「家乡文化二维码」单文件页面：
   _src/index.tpl.html  -> index.html  （学生生成器）
   _src/wall.tpl.html   -> wall.html   （作品墙·互评）
   _src/survey.tpl.html -> survey.html （课前/课中/课后问卷）
   _src/admin.tpl.html  -> admin.html  （教师数据面板·一键清除）
   注入：内联 qrcode-generator 库 + 内联云 SDK + 云服务 publicConfig + DeepSeek key
   全部内联，除云服务/大模型请求外无任何外链。

   ★ 可移植：路径全部按本脚本所在位置自动推导，放到哪台电脑都能跑。
   用法：  python _src/_build.py
"""
import os, json, shutil, datetime, sys, ctypes

# ---------------------------------------------------------------
# 让输出跟着控制台走：cmd 是 GBK 就按 GBK 输出，UTF-8 控制台就按 UTF-8。
# （否则双击 bat 跑构建时，中文会打印成乱码 —— 见 windows-bat-authoring 陷阱 11）
# ---------------------------------------------------------------
def _console_encoding():
    try:
        k32 = ctypes.windll.kernel32
        cp = k32.GetConsoleOutputCP() if sys.stdout.isatty() else k32.GetACP()
    except Exception:
        return None
    if cp == 65001:
        return 'utf-8'
    return ('cp%d' % cp) if cp else None

_enc = _console_encoding()
if _enc:
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding=_enc, errors='replace')
        except Exception:
            pass

# 本脚本在 <项目>/_src/ 下 → 上一级就是项目根目录
SRC  = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(SRC)

# 二维码库：优先用 _src 里自带的副本（随包分发，无需装 node）
LIB_CANDIDATES = [
    os.path.join(SRC, 'qrcode.js'),
    os.path.join(SRC, 'qrcode-generator.js'),
    r'C:\Users\tanc\.workbuddy\binaries\node\workspace\node_modules\qrcode-generator\dist\qrcode.js',
]
LIB = next((p for p in LIB_CANDIDATES if os.path.exists(p)), None)
assert LIB, '找不到二维码库 qrcode.js（应放在 _src\\qrcode.js）'

CFG  = os.path.join(SRC, 'cloud-config.json')
SDK  = os.path.join(SRC, 'sdk.global.js')

lib = open(LIB, encoding='utf-8').read()
assert 'var qrcode = function' in lib, '二维码库文件异常: ' + LIB

# ---------------------------------------------------------------
# 数据通道开关
#   local（默认）= 自建后端（腾讯云 api.kexvefuxi.cn/qr）—— 学生用这个
#   cloud        = 原 WorkBuddy 云 SDK          —— 仅作回退兜底
# 用法：python _build.py            # local
#       python _build.py cloud      # 回退旧云通道
#       QR_BACKEND=cloud python _build.py
# ---------------------------------------------------------------
SHIM = os.path.join(SRC, 'cloud-shim.js')
BACKEND = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get('QR_BACKEND', 'local')).strip().lower()
assert BACKEND in ('local', 'cloud'), 'BACKEND 只能是 local 或 cloud'

if BACKEND == 'cloud':
    assert os.path.exists(SDK), 'QR_BACKEND=cloud 但找不到 _src/sdk.global.js'
    sdk = open(SDK, encoding='utf-8').read()
    assert 'WorkBuddyCloud' in sdk, '云 SDK 文件异常'
else:
    assert os.path.exists(SHIM), '找不到 _src/cloud-shim.js（自建后端适配器）'
    sdk = open(SHIM, encoding='utf-8').read()
    assert 'WorkBuddyCloud' in sdk, '适配器文件异常'

cfg = {}
if os.path.exists(CFG):
    cfg = json.load(open(CFG, encoding='utf-8'))

cloud_js = 'window.CLOUD_CONFIG = ' + json.dumps({
    # local 模式下适配器自会按当前域名拼接口地址，这里给个真值只为过页面的非空判断
    'endpoint': cfg.get('endpoint', '') if BACKEND == 'cloud' else 'self',
    'oauthRelayBaseUrl': cfg.get('oauthRelayBaseUrl', ''),
    'publishableKey': cfg.get('publishableKey', ''),
    'adminPassword': cfg.get('adminPassword', 'cx2026'),
}, ensure_ascii=False) + ';'

deepseek = cfg.get('deepseekKey', '')

LIB_TAG = '/* ===== qrcode-generator v2.0.4 · MIT · Kazuhiko Arase ===== */\n' + lib
SDK_TAG = ('/* ===== hometown-qr backend adapter (self-hosted) ===== */\n' + sdk) if BACKEND == 'local' \
    else ('/* ===== @tencent-ai/workbuddy-cloud-sdk (inlined) ===== */\n' + sdk)

def build(name):
    tpl_path = os.path.join(SRC, name + '.tpl.html')
    out_path = os.path.join(BASE, name + '.html')
    tpl = open(tpl_path, encoding='utf-8').read()

    if '/*__QRCODE_LIB__*/' in tpl:
        html = tpl.replace('/*__QRCODE_LIB__*/', LIB_TAG)
    else:
        html = tpl
    assert '/*__CLOUD_SDK__*/' in html, name + ' 模板缺云 SDK 占位符'

    html = html.replace('/*__CLOUD_SDK__*/', SDK_TAG)
    html = html.replace('/*__CLOUD_CONFIG__*/', cloud_js)
    if '/*__DEEPSEEK_KEY__*/' in html:
        html = html.replace('/*__DEEPSEEK_KEY__*/', deepseek)

    if os.path.exists(out_path):
        bak = os.path.join(SRC, '_bak')
        os.makedirs(bak, exist_ok=True)
        shutil.copy2(out_path, os.path.join(bak, '%s-%s.html' % (
            name, datetime.datetime.now().strftime('%Y%m%d_%H%M%S'))))

    open(out_path, 'w', encoding='utf-8', newline='\n').write(html)

    leftover = [p for p in ('__QRCODE_LIB__', '__CLOUD_SDK__', '__CLOUD_CONFIG__', '__DEEPSEEK_KEY__') if p in html]
    external = html.count('src="http')
    print('%-12s %6.1f KB  残留占位符=%s  外链 src=%d' % (
        name + '.html', len(html.encode('utf-8')) / 1024, leftover or '无', external))
    return out_path

for n in ('index', 'wall', 'survey', 'admin'):
    build(n)

print('\n数据通道:', '自建后端（api.kexvefuxi.cn/qr）' if BACKEND == 'local' else '⚠ WorkBuddy 云（旧通道）')
print('云配置:', '已注入' if cloud_js else '⚠ 缺')
print('适配器/云 SDK:', '已内联 %.1f KB' % (len(sdk.encode('utf-8')) / 1024) if sdk else '⚠ 缺失')
print('DeepSeek key:', '已注入（本项目已无 AI 调用，仅留位）' if deepseek else '未用')
