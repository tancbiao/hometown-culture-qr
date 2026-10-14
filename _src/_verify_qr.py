# -*- coding: utf-8 -*-
"""解码自证：把网页生成的二维码 PNG 读回来，与原文逐字比对"""
import cv2, numpy as np, os

BASE = r'C:\城西教学\二维码展示课\_文化二维码\_shots'
CASES = [
    ('qr_pepper.png',  '天等指天椒，又香又辣，特别有名。我为家乡感到骄傲。'),
    ('qr_huashan.png', '我们崇左的花山岩画，画在江边的悬崖上，很有气势。欢迎你来一起看。'),
]

det = cv2.QRCodeDetector()
allok = True
for fn, want in CASES:
    p = os.path.join(BASE, fn)
    img = cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        print('%s  READ_FAIL (图片读不出)' % fn); allok = False; continue
    data, pts, _ = det.detectAndDecode(img)
    ok = (data == want)
    allok = allok and ok
    print('%-16s %s   %d字' % (fn, 'PASS ✓' if ok else 'FAIL ✗', len(want)))
    print('     读出: %s' % (data if data else '(空)'))
    if not ok:
        print('     期望: %s' % want)

print('\n结论:', '全部解码一致' if allok else '存在不一致，需排查')
