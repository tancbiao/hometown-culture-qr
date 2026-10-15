/* 适配器 <-> 后端 契约测试（jsdom 里跑 cloud-shim，真实打本地 3213 服务）
 * 用法：node test_adapter.js
 */
'use strict';
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const SHIM = path.join(__dirname, '..', '_src', 'cloud-shim.js');
const BASE = process.env.QR_TEST_BASE || 'http://127.0.0.1:3213';

const shim = fs.readFileSync(SHIM, 'utf8');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: BASE + '/qr/index.html',
  runScripts: 'outside-only'
});
const w = dom.window;

/* Node 的 fetch 不认相对地址，这里补成绝对（模拟浏览器同域行为） */
w.fetch = function (u, init) {
  if (typeof u === 'string' && u.charAt(0) === '/') u = BASE + u;
  return globalThis.fetch(u, init);
};
w.eval(shim);

const cloud = w.WorkBuddyCloud.createWorkBuddyCloud({});
let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  → ' + extra : '')); }
}

(async function () {
  console.log('=== 1. 插入作品（前端 index 提交时的写法） ===');
  const ins = await cloud.database.from('works')
    .insert({ author: '7号', klass: '四（1）班', topic: 'pepper', topic_name: '指天椒', content: '天等指天椒很香。' })
    .select();
  ok(ins.error === null && ins.data && ins.data.length === 1, 'insert 返回 {data:[记录]}');
  ok(ins.data[0].id > 0 && !!ins.data[0].created_at, '自动补 id 与 created_at', JSON.stringify(ins.data[0]));

  console.log('=== 2. 查询作品（wall 的写法：order desc + limit） ===');
  const sel = await cloud.database.from('works').select('*').order('created_at', { ascending: false }).limit(300);
  ok(sel.error === null && Array.isArray(sel.data), 'select 返回数组');
  ok(sel.data.length >= 1, '拿得到刚插入的作品（' + sel.data.length + ' 条）');

  console.log('=== 3. 指定列（wall 读 ratings 只要 work_id, stars） ===');
  const r1 = await cloud.database.from('ratings').insert({ work_id: ins.data[0].id, rater_id: 'rTEST', stars: 5, comment: '介绍得真好' }).select();
  ok(r1.error === null && r1.data[0].stars === 5, '评分写入成功');
  const sel2 = await cloud.database.from('ratings').select('work_id, stars').limit(5000);
  ok(sel2.data.length >= 1 && sel2.data[0].work_id !== undefined && sel2.data[0].stars !== undefined,
    '列裁剪生效（含 work_id/stars）', JSON.stringify(sel2.data[0]));
  ok(sel2.data[0].comment === undefined, '未请求的列被裁掉（comment 不在）');
  ok(sel2.data[0].id !== undefined, 'id 仍保留（前端按 id 定位）');

  console.log('=== 4. 问卷交卷（answers 是对象） ===');
  const sv = await cloud.database.from('surveys')
    .insert({ kind: 'pre', author: '7号', klass: '四（1）班', answers: { know: '知道一些', heritage: ['壮族霜降节', '壮族天琴艺术'] } })
    .select();
  ok(sv.error === null && sv.data[0].answers && Array.isArray(sv.data[0].answers.heritage),
    'answers 对象原样存回', JSON.stringify(sv.data[0].answers));

  console.log('=== 5. admin 读到三张表（admin 的写法） ===');
  const all = await Promise.all([
    cloud.database.from('works').select('*').order('created_at', { ascending: false }).limit(1000),
    cloud.database.from('ratings').select('*').limit(10000),
    cloud.database.from('surveys').select('*').order('created_at', { ascending: false }).limit(3000)
  ]);
  ok(all[0].data.length >= 1 && all[1].data.length >= 1 && all[2].data.length >= 1, '三张表都读得到');

  console.log('=== 6. 清除（admin 一键清除的写法：.delete().neq("id",-1)） ===');
  w.CLOUD_CONFIG.adminPassword = 'cx2026';
  const del = await cloud.database.from('works').delete().neq('id', -1);
  ok(del.error === null, '带正确密码可清除', JSON.stringify(del.error && del.error.message));

  console.log('=== 7. 错误密码应被拒 ===');
  w.CLOUD_CONFIG.adminPassword = 'wrong';
  let rejected = false;
  try { await cloud.database.from('surveys').delete().neq('id', -1); }
  catch (e) { rejected = true; }
  ok(rejected, '错误密码被服务端拒绝并抛错');

  console.log('=== 8. 后端不可达时应抛出错误（前端能给出友好提示） ===');
  w.fetch = function () { return Promise.reject(new Error('boom')); };
  let netErr = false;
  try { await cloud.database.from('works').select('*').limit(1); }
  catch (e) { netErr = true; }
  ok(netErr, '网络失败会 reject（前端走 catch 分支）');

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('测试异常:', e && e.stack || e);
  process.exit(1);
});
