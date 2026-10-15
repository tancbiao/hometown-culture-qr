#!/usr/bin/env node
/* ============================================================================
 * 家乡文化二维码 · 自建后端（天等县城西小学四年级课堂工具）
 * ----------------------------------------------------------------------------
 * 为什么要它：原来作品墙/问卷的数据存在 WorkBuddy 云端，靠浏览器免密钥通道
 * 直连；第二次课时学生开始连不上。本项目把数据通道搬到自建的腾讯云服务器上，
 * 静态页 + 接口同域，无登录、无第三方依赖，稳。
 *
 * 形态：Node 纯 http（零 npm 依赖），端口 3213，nginx 反代 /qr/ 进来。
 * 存储：单个 JSON 文件，内存为主、异步原子落盘（量级：几百作品 / 几千评分）。
 *
 * 接口（与前端 cloud 适配器约定）：
 *   GET  /api/health
 *   GET  /api/works|ratings|surveys      ?limit=&order=&select=
 *   POST /api/works|ratings|surveys      body=记录对象        -> {data:[记录]}
 *   POST /api/clear                      body={tables:[..],password} -> {data:[]}
 *
 * 课次快照（每轮课的数据整包存档，下一轮从干净库重开，历史可回看/导出/恢复）：
 *   GET    /api/snapshots                -> {data:[快照元信息...]}（按时间倒序）
 *   GET    /api/snapshots?id=xxx         -> {data:[完整快照(含三表)]}
 *   POST   /api/snapshots                body={name,note,password,meta,clear} -> {data:[meta]}
 *   DELETE /api/snapshots?id=xxx         body={password}
 *   POST   /api/snapshots/restore?id=xxx body={password}   把快照数据写回当前库
 *   其余路径 -> 静态文件（www/ 目录）
 * ==========================================================================*/
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT     = parseInt(process.env.PORT || '3213', 10);
const ROOT     = process.env.QR_ROOT || path.join(__dirname, 'data');
const WWW      = process.env.QR_WWW  || path.join(__dirname, 'www');
const ADMIN_PW = process.env.QR_ADMIN_PW || 'cx2026';
const DATA_FILE = path.join(ROOT, 'data.json');
const SNAP_DIR  = path.join(ROOT, 'snapshots');   // 课次快照存放目录

const TABLES   = ['works', 'ratings', 'surveys'];
const MAX_BODY = 96 * 1024;          // 单条请求体上限
const PREFIX   = /^\/qr(?=\/|$)/;    // 直连 3213 时带 /qr 前缀；nginx 反代时已被剥掉

/* ---------------------------------------------------------------- 数据层 */
const db = { seq: { works: 0, ratings: 0, surveys: 0 }, works: [], ratings: [], surveys: [] };

function load() {
  try {
    if (!fs.existsSync(DATA_FILE)) { console.log('[data] 新库（无历史文件）'); return; }
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    TABLES.forEach(function (t) {
      if (Array.isArray(j[t])) db[t] = j[t];
      const maxId = db[t].reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0);
      db.seq[t] = Math.max(Number((j.seq || {})[t]) || 0, maxId);
    });
    console.log('[data] 载入 %s 作品 / %s 评分 / %s 问卷',
      db.works.length, db.ratings.length, db.surveys.length);
  } catch (e) {
    console.error('[data] 载入失败（保持空库运行）:', e.message);
  }
}

let dirty = false, saveTimer = null, saving = false;
function saveSoon() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  saveTimer = null;
  if (!dirty || saving) return;
  saving = true; dirty = false;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
    fs.renameSync(tmp, DATA_FILE);          // 原子替换
  } catch (e) {
    console.error('[data] 落盘失败:', e.message);
    dirty = true;                            // 留待下次重试
  } finally {
    saving = false;
  }
}
process.on('SIGTERM', function () { dirty = true; flush(); process.exit(0); });
process.on('SIGINT',  function () { dirty = true; flush(); process.exit(0); });

/* ------------------------------------------------------------ 课次快照
 * 用途：每上完一轮课，把当时的三表数据整包存档（历史留档、可导出、可恢复），
 *       然后清空当前库开始新一轮。存档时一并保存当时的问卷题面（meta），
 *       这样以后改了题目，回看旧快照仍是旧题面，统计不会错乱。
 * 存储：ROOT/snapshots/<id>.json  { id,name,note,created_at,counts,meta,works,ratings,surveys }
 * ------------------------------------------------------------------------ */
const SNAP_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

function newSnapId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function snapFile(id) {
  if (!SNAP_ID_RE.test(String(id || ''))) return null;   // 防目录穿越
  return path.join(SNAP_DIR, id + '.json');
}
function readSnap(id) {
  const f = snapFile(id);
  if (!f || !fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}
function snapMeta(j, id) {
  return {
    id: id, name: j.name || id, note: j.note || '', created_at: j.created_at || '',
    counts: j.counts || {
      works: (j.works || []).length, ratings: (j.ratings || []).length, surveys: (j.surveys || []).length
    }
  };
}
function snapList() {
  try {
    if (!fs.existsSync(SNAP_DIR)) return [];
    return fs.readdirSync(SNAP_DIR)
      .filter(function (f) { return /\.json$/.test(f); })
      .map(function (f) {
        const id = f.replace(/\.json$/, '');
        const j = readSnap(id);
        return j ? snapMeta(j, id)
                 : { id: id, name: id, note: '(文件损坏，无法读取)', created_at: '', counts: null };
      })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  } catch (e) { return []; }
}
function snapCount() {
  try { return fs.existsSync(SNAP_DIR) ? fs.readdirSync(SNAP_DIR).filter(function (f) { return /\.json$/.test(f); }).length : 0; }
  catch (e) { return 0; }
}
function writeSnap(obj) {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const f = snapFile(obj.id);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, f);                                  // 原子替换
  return snapMeta(obj, obj.id);
}

/* ------------------------------------------------------------ 字段清洗 */
const LIMITS = {
  works:   { author: 12, klass: 16, topic: 40, topic_name: 40, content: 240 },
  ratings: { rater_id: 40, rater_name: 12, rater_klass: 16, comment: 120 },
  surveys: { kind: 12, author: 12, klass: 16 }
};
function clampStr(v, n) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, n);
}
function sanitize(table, o) {
  o = o || {};
  const out = {};
  const lim = LIMITS[table] || {};
  Object.keys(lim).forEach(function (k) { out[k] = clampStr(o[k], lim[k]); });
  if (table === 'ratings') {
    out.work_id = Number(o.work_id) || 0;
    out.stars   = Math.min(5, Math.max(1, Number(o.stars) || 0));
  }
  if (table === 'surveys') {
    /* answers 是对象：{题目id: 答案} —— 只保留浅层、总长受限 */
    let ans = o.answers;
    if (typeof ans === 'string') { try { ans = JSON.parse(ans); } catch (e) { ans = {}; } }
    if (!ans || typeof ans !== 'object' || Array.isArray(ans)) ans = {};
    const clean = {};
    let budget = 4000;
    Object.keys(ans).slice(0, 40).forEach(function (k) {
      const kk = clampStr(k, 24);
      let vv = ans[k];
      if (Array.isArray(vv)) vv = vv.slice(0, 12).map(function (x) { return clampStr(x, 60); });
      else vv = clampStr(vv, 400);
      const size = JSON.stringify(vv).length;
      if (budget - size < 0) return;
      budget -= size;
      clean[kk] = vv;
    });
    out.answers = clean;
  }
  return out;
}

/* ----------------------------------------------------------------- 工具 */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
  });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve) {
    let n = 0; const chunks = [];
    req.on('data', function (c) {
      n += c.length;
      if (n > MAX_BODY) { req.destroy(); resolve({ __tooBig: true }); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({ __badJson: true }); }
    });
    req.on('error', function () { resolve({}); });
  });
}

/* 简单限流：每 IP 每 10 秒最多 40 次写 */
const RL = new Map();
function rateOk(ip) {
  const now = Date.now();
  let e = RL.get(ip);
  if (!e || now - e.t > 10000) { e = { t: now, n: 0 }; RL.set(ip, e); }
  e.n++;
  if (RL.size > 5000) RL.clear();
  return e.n <= 40;
}

/* ---------------------------------------------------------------- 路由 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',   '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8'
};

async function handleApi(req, res, p, q, ip) {
  if (p === '/api/health') {
    return sendJson(res, 200, {
      ok: true, service: 'hometown-qr', uptime: Math.round(process.uptime()),
      counts: { works: db.works.length, ratings: db.ratings.length, surveys: db.surveys.length,
                snapshots: snapCount() }
    });
  }

  /* ------------------------------------------------ 课次快照 */
  if (p === '/api/snapshots') {
    if (req.method === 'GET') {
      const id = q.get('id');
      if (id) {
        const j = readSnap(id);
        if (!j) return sendJson(res, 404, { error: '快照不存在' });
        return sendJson(res, 200, { data: [j], error: null });
      }
      return sendJson(res, 200, { data: snapList(), error: null });
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.__tooBig) return sendJson(res, 413, { error: '内容太大了' });
      if (body.__badJson) return sendJson(res, 400, { error: '数据格式不对' });
      if (body.password !== ADMIN_PW) return sendJson(res, 403, { error: '密码不对' });

      const counts = { works: db.works.length, ratings: db.ratings.length, surveys: db.surveys.length };
      if (!counts.works && !counts.ratings && !counts.surveys)
        return sendJson(res, 400, { error: '当前还没有数据，不用存档' });

      const d = new Date();
      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      const defName = (d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()));
      const obj = {
        id: newSnapId(),
        name: clampStr(body.name, 60) || ('课次 ' + defName),
        note: clampStr(body.note, 200),
        created_at: d.toISOString(),
        counts: counts,
        meta: (body.meta && typeof body.meta === 'object') ? body.meta : null,
        works: db.works, ratings: db.ratings, surveys: db.surveys
      };
      let meta;
      try { meta = writeSnap(obj); }
      catch (e) {
        console.error('[snap] 写入失败:', e.message);
        return sendJson(res, 500, { error: '存档失败：' + e.message });
      }
      let cleared = false;
      if (body.clear === true) {
        TABLES.forEach(function (t) { db[t] = []; db.seq[t] = 0; });
        dirty = true; flush(); cleared = true;
      }
      console.log('[snap] 存档「%s」 %d作品/%d评分/%d问卷%s',
        meta.name, counts.works, counts.ratings, counts.surveys, cleared ? ' 并已清空' : '');
      return sendJson(res, 200, { data: [meta], error: null, cleared: cleared });
    }

    if (req.method === 'DELETE') {
      const body = await readBody(req);
      if (body.password !== ADMIN_PW) return sendJson(res, 403, { error: '密码不对' });
      const id = q.get('id') || body.id;
      const f = snapFile(id);
      if (!f || !fs.existsSync(f)) return sendJson(res, 404, { error: '快照不存在' });
      fs.unlinkSync(f);
      console.log('[snap] 删除快照', id);
      return sendJson(res, 200, { data: [], error: null });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (p === '/api/snapshots/restore') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
    const body = await readBody(req);
    if (body.password !== ADMIN_PW) return sendJson(res, 403, { error: '密码不对' });
    const j = readSnap(q.get('id') || body.id);
    if (!j) return sendJson(res, 404, { error: '快照不存在' });
    TABLES.forEach(function (t) {
      db[t] = Array.isArray(j[t]) ? j[t] : [];
      const maxId = db[t].reduce(function (m, x) { return Math.max(m, Number(x.id) || 0); }, 0);
      db.seq[t] = maxId;
    });
    dirty = true; flush();
    console.log('[snap] 恢复快照「%s」 -> %d作品/%d评分/%d问卷', j.name || j.id,
      db.works.length, db.ratings.length, db.surveys.length);
    return sendJson(res, 200, { data: [{ id: j.id, name: j.name || j.id,
      counts: { works: db.works.length, ratings: db.ratings.length, surveys: db.surveys.length } }], error: null });
  }

  if (p === '/api/clear') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'method' });
    const body = await readBody(req);
    if (body.password !== ADMIN_PW) return sendJson(res, 403, { error: '密码不对' });
    let tables = Array.isArray(body.tables) ? body.tables : [];
    tables = tables.filter(function (t) { return TABLES.indexOf(t) >= 0; });
    if (!tables.length) return sendJson(res, 400, { error: '没有指定要清的表' });
    tables.forEach(function (t) { db[t] = []; db.seq[t] = 0; });
    dirty = true; flush();
    console.log('[clear] 清理', tables.join(','), '来自', ip);
    return sendJson(res, 200, { data: [], cleared: tables });
  }

  const m = p.match(/^\/api\/([a-z_]+)$/);
  if (!m || TABLES.indexOf(m[1]) < 0) return sendJson(res, 404, { error: 'no such api' });
  const table = m[1];

  if (req.method === 'GET') {
    let rows = db[table].slice();
    const order = q.get('order');           // 形如 created_at.desc
    if (order) {
      const parts = String(order).split('.');
      const key = parts[0], dir = (parts[1] || 'asc').toLowerCase();
      rows.sort(function (a, b) {
        const x = a[key], y = b[key];
        if (x === y) return 0;
        const r = (x > y) ? 1 : -1;
        return dir === 'desc' ? -r : r;
      });
    }
    const select = q.get('select');
    const lim = parseInt(q.get('limit') || '0', 10);
    if (lim > 0) rows = rows.slice(0, lim);
    if (select && select !== '*') {
      const cols = String(select).split(',').map(function (s) { return s.trim(); })
        .filter(function (s) { return s && s !== '*'; });
      if (cols.length) {
        rows = rows.map(function (r) {
          const o = {};
          cols.forEach(function (c) { if (c in r) o[c] = r[c]; });
          if (!('id' in o) && 'id' in r) o.id = r.id;
          return o;
        });
      }
    }
    return sendJson(res, 200, { data: rows, error: null });
  }

  if (req.method === 'POST') {
    if (!rateOk(ip)) return sendJson(res, 429, { error: '提交太快了，缓一缓再试' });
    const body = await readBody(req);
    if (body.__tooBig) return sendJson(res, 413, { error: '内容太大了' });
    if (body.__badJson) return sendJson(res, 400, { error: '数据格式不对' });
    const rec = sanitize(table, body);
    rec.id = ++db.seq[table];
    rec.created_at = new Date().toISOString();
    db[table].push(rec);
    saveSoon();
    return sendJson(res, 200, { data: [rec], error: null });
  }

  if (req.method === 'DELETE') {              /* 兼容 .delete().neq('id',-1) */
    const body = await readBody(req);
    if (body.password !== ADMIN_PW) return sendJson(res, 403, { error: '密码不对' });
    db[table] = []; db.seq[table] = 0;
    dirty = true; flush();
    return sendJson(res, 200, { data: [], error: null });
  }

  return sendJson(res, 405, { error: 'method not allowed' });
}

function serveStatic(req, res, p) {
  let rel = decodeURIComponent(p);
  if (rel === '/' || rel === '') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^([/\\])+/, '');
  if (safe.indexOf('..') >= 0) { res.writeHead(403); return res.end('forbidden'); }
  const file = path.join(WWW, safe);
  if (!file.startsWith(path.normalize(WWW))) { res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8"><h1>404</h1><p>页面不存在</p>');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------------------------------------------------------- 主入口 */
const server = http.createServer(function (req, res) {
  let pathname;
  try { pathname = new URL(req.url, 'http://x').pathname; }
  catch (e) { res.writeHead(400); return res.end('bad url'); }
  const q = new URL(req.url, 'http://x').searchParams;

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket.remoteAddress || '-';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS'
    });
    return res.end();
  }

  const p = pathname.replace(PREFIX, '') || '/';

  if (p === '/admin' || p === '/admin/') return serveStatic(req, res, '/admin.html');

  if (p.indexOf('/api/') === 0) {
    handleApi(req, res, p, q, ip).catch(function (e) {
      console.error('[api] 异常:', e && e.stack || e);
      try { sendJson(res, 500, { error: 'server error' }); } catch (e2) {}
    });
    return;
  }
  serveStatic(req, res, p);
});

load();
server.listen(PORT, function () {
  console.log('家乡文化二维码后端已启动 http://0.0.0.0:%d  静态目录 %s', PORT, WWW);
  console.log('数据文件 %s  管理密码 %s', DATA_FILE, ADMIN_PW.replace(/./g, '*'));
});
