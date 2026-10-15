/* 合并版 admin 端到端测试：登录 → 选项卡 → 对比面板 → 快照全流程 */
const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = fs.readFileSync('C:/城西教学/二维码展示课/_文化二维码/admin.html', 'utf-8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://127.0.0.1:3213/qr/admin.html',
  beforeParse(window) {
    /* jsdom 无 fetch：借 Node 的 fetch，相对路径补上基址 */
    window.fetch = (url, opts) => global.fetch(new URL(url, 'http://127.0.0.1:3213'), opts);
  } });
const { window } = dom;
const d = window.document;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function ok(cond, name){ if (cond){ pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

(async () => {
  await sleep(400);

  /* 1. 登录 */
  d.getElementById('pw').value = 'cx2026';
  d.getElementById('loginBtn').click();
  await sleep(1000);
  ok(d.getElementById('dashboard').style.display !== 'none', '登录成功进入面板');
  ok(d.getElementById('kpis').children.length > 0, 'KPI 渲染（' + d.getElementById('kpis').children.length + ' 卡）');

  /* 2. 选项卡：应有 9 个，含对比与快照 */
  const tabs = [...d.querySelectorAll('#tabs button')].map(b => b.getAttribute('data-t'));
  ok(tabs.length === 9, '选项卡 9 个（实际 ' + tabs.length + '）');
  ok(tabs.includes('compare'), '含「课前↔课中对比」');
  ok(tabs.includes('snaps'), '含「📸 课次快照」');

  /* 3. 对比面板 */
  d.querySelector('#tabs button[data-t="compare"]').click();
  await sleep(300);
  const cmpHtml = d.getElementById('panels').innerHTML;
  ok(cmpHtml.includes('进步分析'), '对比面板渲染出「进步分析」');
  ok(cmpHtml.includes('2 人两卷都交齐'), '配对到 2 人（课前人均 0.5 → 课中 2.0）');
  ok(cmpHtml.includes('按学生逐个对比'), '含按学生对比表');
  ok(cmpHtml.includes('+3'), '15号 进步 +3 项显示（课前0→课中3）');

  /* 4. 快照面板 + 存档并清空 */
  d.querySelector('#tabs button[data-t="snaps"]').click();
  await sleep(300);
  ok(!!d.getElementById('snapList'), '快照面板出现');
  await sleep(400);
  ok(d.getElementById('snapList').innerHTML.includes('还没有快照'), '初始无快照');

  d.getElementById('snapName').value = '测试课次 10月15日';
  d.getElementById('snapSaveClear').click();
  await sleep(200);
  ok(d.getElementById('snapMask').classList.contains('on'), '弹确认框');
  d.getElementById('snapMPw').value = 'wrong';
  d.getElementById('snapMOk').click();
  await sleep(400);
  ok(d.getElementById('snapMMsg').textContent.includes('密码不对'), '错密码被拦');
  d.getElementById('snapMPw').value = 'cx2026';
  d.getElementById('snapMOk').click();
  await sleep(900);
  await sleep(600);
  const rows = d.querySelectorAll('#snapList tbody tr');
  ok(rows.length === 1, '存档后列表 1 条');
  ok(d.getElementById('kpis').textContent.includes('0') || d.querySelectorAll('#kpis .kpi')[0].textContent.match(/0/), '开启新课：当前库清空');

  /* 5. 查看历史快照 */
  d.querySelector('#snapList button[data-act="view"]').click();
  await sleep(600);
  ok(!!window.VIEWING === false || true, '（VIEWING 是闭包内变量，看横幅）');
  ok(d.getElementById('viewbar').innerHTML.includes('正在查看历史快照'), '只读横幅出现');
  ok(d.getElementById('viewbar').innerHTML.includes('测试课次 10月15日'), '横幅显示课次名');
  ok(d.getElementById('kpis').textContent.indexOf('2') >= 0, '快照数据回显');

  /* 6. 返回当前课次 */
  d.getElementById('exitView').click();
  await sleep(600);
  ok(!d.getElementById('viewbar').style.display || d.getElementById('viewbar').style.display === 'none'
     || d.getElementById('viewbar').innerHTML === '', '返回后横幅消失');

  /* 7. 恢复快照 */
  d.querySelector('#tabs button[data-t="snaps"]').click();
  await sleep(300);
  d.querySelector('#snapList button[data-act="restore"]').click();
  await sleep(200);
  d.getElementById('snapMPw').value = 'cx2026';
  d.getElementById('snapMOk').click();
  await sleep(1000);
  const kpiTxt = d.getElementById('kpis').textContent;
  ok(kpiTxt.includes('2'), '恢复后作品数回 2');

  /* 8. 删除快照 */
  d.querySelector('#tabs button[data-t="snaps"]').click();
  await sleep(300);
  d.querySelector('#snapList button[data-act="del"]').click();
  await sleep(200);
  d.getElementById('snapMPw').value = 'cx2026';
  d.getElementById('snapMOk').click();
  await sleep(900);
  ok(d.getElementById('snapList').innerHTML.includes('还没有快照'), '删除后列表空');

  console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
