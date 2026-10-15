/* 真实页面集成测试：用 jsdom 跑成品 wall/survey/index，验证在新通道下工作
 * 用法：node test_pages.js
 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.QR_TEST_BASE || 'http://127.0.0.1:3213';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

function makeFetch(base) {
  return function (u, init) {
    if (typeof u === 'string' && u.charAt(0) === '/') u = base + u;
    return globalThis.fetch(u, init);
  };
}

function loadPage(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const dom = new JSDOM(html, {
    url: BASE + '/qr/' + file,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse: function (w) {
      w.fetch = makeFetch(BASE);
      w.scrollTo = function () {};
      w.alert = function (m) { console.log('    [alert] ' + m); };
      const origErr = w.console && w.console.error;
      w.console.error = function () {};
    }
  });
  return dom;
}
const wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

async function seed() {
  /* 先清空，再放几条确定的数据 */
  await globalThis.fetch(BASE + '/api/clear', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['works', 'ratings', 'surveys'], password: 'cx2026' })
  });
  const w1 = await (await globalThis.fetch(BASE + '/api/works', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: '3号', klass: '四（1）班', topic: 'pepper', topic_name: '指天椒', content: '天等指天椒又香又辣，我为家乡骄傲。' })
  })).json();
  await globalThis.fetch(BASE + '/api/works', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ author: '8号', klass: '四（2）班', topic: 'detian', topic_name: '德天瀑布', content: '德天瀑布真壮观，欢迎来看。' })
  });
  await globalThis.fetch(BASE + '/api/ratings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_id: w1.data[0].id, rater_id: 'rSEED', stars: 5, comment: '介绍得真好' })
  });
}

(async function () {
  console.log('=== 准备测试数据 ===');
  await seed();
  console.log('  已写入 2 作品 + 1 评分');

  console.log('=== 作品墙 wall.html ===');
  {
    const dom = loadPage('wall.html');
    await wait(700);
    const d = dom.window.document;
    const txt = d.body.textContent || '';
    ok(txt.indexOf('天等指天椒又香又辣') >= 0, '渲染出学生 1 的作品正文');
    ok(txt.indexOf('德天瀑布真壮观') >= 0, '渲染出学生 2 的作品正文');
    ok(txt.indexOf('四（1）班') >= 0 || txt.indexOf('3号') >= 0, '显示学号/班级（匿名身份）');
    dom.window.close();
  }

  console.log('=== 问卷页 survey.html ===');
  {
    const dom = loadPage('survey.html');
    await wait(700);
    const d = dom.window.document;
    const txt = d.body.textContent || '';
    ok(txt.indexOf('非遗') >= 0, '课前问卷含非遗题');
    ok(txt.indexOf('学号') >= 0 || !!d.querySelector('select'), '含学号/班级选择');
    dom.window.close();
  }

  console.log('=== 生成器 index.html ===');
  {
    const dom = loadPage('index.html');
    await wait(700);
    const d = dom.window.document;
    const txt = d.body.textContent || '';
    ok(txt.indexOf('指天椒') >= 0 || txt.indexOf('德天') >= 0, '主题列表渲染出来');
    ok(!!d.querySelector('select'), '学号下拉存在');
    ok(!/AI 帮我想一句/.test(txt), '没有 AI 帮写按钮（已移除）');
    dom.window.close();
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试异常:', e && e.stack || e);
  process.exit(1);
});
