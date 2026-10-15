/* 线上真机验证：从 api.kexvefuxi.cn 拉真实页面，模拟学生读/写/交卷
 * 用法：node test_live.js
 */
'use strict';
const { JSDOM } = require('jsdom');

const BASE = 'https://api.kexvefuxi.cn';
const PREFIX = '/qr';
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}
function makeFetch() {
  return function (u, init) {
    if (typeof u === 'string' && u.charAt(0) === '/') u = BASE + u;
    return globalThis.fetch(u, init);
  };
}
async function loadLive(file) {
  const dom = await JSDOM.fromURL(BASE + PREFIX + '/' + file, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: function (w) {
      w.fetch = makeFetch();
      w.scrollTo = function () {};
      w.alert = function () {};
      w.console.error = function () {};
    }
  });
  await new Promise(function (r) { setTimeout(r, 900); });
  return dom;
}

(async function () {
  console.log('=== 先在线上写入测试数据 ===');
  const r = await (await fetch(BASE + PREFIX + '/api/works', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: '12号', klass: '五（3）班', topic: 'detian', topic_name: '德天瀑布', content: '德天瀑布横跨两国，非常壮观。' })
  })).json();
  ok(!!(r.data && r.data[0] && r.data[0].id), '线上写入成功（id=' + (r.data && r.data[0] && r.data[0].id) + '）');

  console.log('=== 线上作品墙 wall.html ===');
  {
    const dom = await loadLive('wall.html');
    const txt = dom.window.document.body.textContent || '';
    ok(txt.indexOf('德天瀑布横跨两国') >= 0, '作品墙渲染出刚提交的作品');
    ok(txt.indexOf('五（3）班') >= 0, '显示班级');
    dom.window.close();
  }

  console.log('=== 线上生成器 index.html ===');
  {
    const dom = await loadLive('index.html');
    const d = dom.window.document;
    ok(!!d.querySelector('select'), '学号/班级下拉存在');
    ok((d.body.textContent || '').indexOf('指天椒') >= 0, '主题列表正常');
    dom.window.close();
  }

  console.log('=== 线上问卷 survey.html ===');
  {
    const dom = await loadLive('survey.html');
    const txt = dom.window.document.body.textContent || '';
    ok(txt.indexOf('非遗') >= 0, '问卷题目正常');
    dom.window.close();
  }

  console.log('=== 数据面板 admin.html 能读到数据 ===');
  {
    const all = await (await fetch(BASE + PREFIX + '/api/works?limit=100')).json();
    ok(all.data.length >= 1, 'admin 的三张表接口可用（作品 ' + all.data.length + ' 条）');
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试异常:', e && e.stack || e);
  process.exit(1);
});
