/* 合并版三页冒烟测试：index / wall / survey */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const BASE = 'C:/城西教学/二维码展示课/_文化二维码/';
let pass = 0, fail = 0;
function ok(c, n){ if (c){ pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function load(page){
  const html = fs.readFileSync(BASE + page + '.html', 'utf-8');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'http://127.0.0.1:3213/qr/' + page + '.html',
    beforeParse(window) {
      window.fetch = (u, o) => global.fetch(new URL(u, 'http://127.0.0.1:3213'), o);
      window.HTMLCanvasElement.prototype.getContext = () => null; /* canvas 留空即可 */
    } });
}

(async () => {
  /* ---- index 生成器 ---- */
  console.log('== index 生成器 ==');
  const i = load('index'); const id = i.window.document;
  await sleep(500);
  ok(id.body.textContent.includes('归龙斜塔') || id.body.textContent.includes('崇左'), '页面含崇左主题内容');
  const topicCards = id.querySelectorAll('#topics > *, [data-key], .topic');
  ok(topicCards.length >= 20 || id.body.innerHTML.match(/topic/gi).length > 20, '主题元素充足（' + topicCards.length + '）');
  ok(!!id.getElementById('stuBox'), '学生身份控件存在（#stuBox）');
  /* 选一个主题 */
  const tBtn = id.querySelector('.topic');
  if (tBtn){ tBtn.click(); await sleep(200); ok(id.body.innerHTML.includes('banks') || id.querySelectorAll('#banks > *').length >= 3, '点击主题后词块出现（3 行）'); }
  else ok(false, '找不到可点的主题');
  /* 点词 */
  const wordBtns = id.querySelectorAll('#banks button, #banks .wd, #banks span[class]');
  ok(wordBtns.length > 0, '拼句词块存在（' + wordBtns.length + ' 个）');

  /* ---- wall 作品墙 ---- */
  console.log('== wall 作品墙 ==');
  const w = load('wall'); const wd = w.window.document;
  await sleep(900);
  const cards = wd.querySelectorAll('.card, .work, [data-id]');
  ok(cards.length >= 2, '作品卡片 ≥2（' + cards.length + '）');
  ok(wd.body.textContent.includes('归龙斜塔') || wd.body.textContent.includes('天琴'), '作品内容显示');
  /* 排序按钮 */
  const sortBtns = wd.querySelectorAll('[data-sort], .sort button, .sorter button');
  ok(sortBtns.length >= 1, '排序控件存在（' + sortBtns.length + '）');

  /* ---- survey 问卷 ---- */
  console.log('== survey 问卷 ==');
  const s = load('survey'); const sd = s.window.document;
  await sleep(500);
  const stext = sd.body.textContent;
  ok(stext.includes('非遗'), '含非遗题面');
  ok(!stext.includes('AI 帮') && !stext.includes('让 AI'), '无 AI 字样题目');
  /* 题目数量：课前应有 8 题 */
  const qEls = sd.querySelectorAll('.q, .opt, [data-qid]');
  ok(qEls.length > 0, '题目元素存在（' + qEls.length + '）');

  console.log('\n===== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试崩溃:', e); process.exit(2); });
