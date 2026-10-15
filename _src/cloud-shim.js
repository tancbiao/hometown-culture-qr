/* ============================================================================
 * 家乡文化二维码 · 自建后端适配器（cloud shim）
 * ----------------------------------------------------------------------------
 * 作用：原页面用 WorkBuddy 云 SDK 的 `cloud.database.from(t).select()/.insert()/
 *       .delete()` 取数。本文件提供**同形状**的替代实现，底层改走自建 API
 *       （api.kexvefuxi.cn/qr/api/...）。这样页面里 14 个调用点一行都不用改。
 *
 * 为什么自己做：原云通道要经第三方免密钥网关 + PKCE，学生一多/换网络就连不上。
 *       自建 API 同域直连，无登录、无外部依赖。
 *
 * 与 _build.py 配合：构建时注入到页面里「云 SDK 占位符」所在的那一行（QR_BACKEND=local）。
 * ==========================================================================*/
(function () {
  'use strict';

  /* 接口基址：取当前页面所在目录 + api/（页面都在 /qr/ 下） */
  function apiBase() {
    var p = location.pathname || '/';
    var i = p.lastIndexOf('/');
    return p.slice(0, i + 1) + 'api/';
  }

  function makeErr(msg) {
    var e = new Error(msg || 'network error');
    e.selfBuilt = true;
    return e;
  }

  /* -------------------------------------------------------------- 查询对象 */
  function Query(table) {
    this.table = table;
    this.mode = 'select';
    this.cols = '*';
    this.orderCol = null;
    this.orderAsc = true;
    this.limitN = 0;
    this.payload = null;
    this.wantSelect = false;
    this.neqs = [];
  }

  Query.prototype.select = function (cols) {
    if (this.mode === 'insert' || this.mode === 'delete') this.wantSelect = true;
    else this.cols = cols || '*';
    return this;
  };
  Query.prototype.insert = function (obj) { this.mode = 'insert'; this.payload = obj || {}; return this; };
  Query.prototype.delete = function () { this.mode = 'delete'; return this; };
  Query.prototype.order = function (col, opt) {
    this.orderCol = col;
    this.orderAsc = !(opt && opt.ascending === false);
    return this;
  };
  Query.prototype.limit = function (n) { this.limitN = Number(n) || 0; return this; };
  Query.prototype.neq = function (col, val) { this.neqs.push({ col: col, val: val }); return this; };

  Query.prototype.then = function (resolve, reject) {
    var self = this;
    var url = apiBase() + self.table;
    var init = { headers: { 'Content-Type': 'application/json' } };

    if (self.mode === 'select') {
      var qs = [];
      if (self.orderCol) qs.push('order=' + encodeURIComponent(self.orderCol + '.' + (self.orderAsc ? 'asc' : 'desc')));
      if (self.limitN > 0) qs.push('limit=' + self.limitN);
      if (self.cols && self.cols !== '*') qs.push('select=' + encodeURIComponent(self.cols));
      if (qs.length) url += '?' + qs.join('&');
      init.method = 'GET';

    } else if (self.mode === 'insert') {
      init.method = 'POST';
      init.body = JSON.stringify(self.payload);

    } else { /* delete：本项目只用「全删」语义（.delete().neq('id', -1)） */
      init.method = 'POST';
      url = apiBase() + 'clear';
      init.body = JSON.stringify({
        tables: [self.table],
        password: (window.CLOUD_CONFIG && window.CLOUD_CONFIG.adminPassword) || ''
      });
    }

    fetch(url, init)
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null;
          try { j = JSON.parse(t); } catch (e) {}
          if (!r.ok) throw makeErr((j && j.error) || ('HTTP ' + r.status));
          if (!j) throw makeErr('返回内容不是 JSON');
          if (j.error) throw makeErr(j.error);
          return j;
        });
      })
      .then(function (j) {
        resolve({ data: j.data || [], error: null });
      })
      .catch(function (e) {
        reject(e);
      });

    return this;
  };

  /* ------------------------------------------------------ 云 SDK 同形替身 */
  window.WorkBuddyCloud = {
    createWorkBuddyCloud: function () {
      return {
        database: { from: function (t) { return new Query(t); } },
        /* 未用到的模块留空壳，防止页面探到时崩 */
        auth: {}, storage: {}, llm: {}
      };
    }
  };

  /* 兼容：模板会检查 CLOUD_CONFIG.endpoint 才建 cloud，这里兜底给个值 */
  if (!window.CLOUD_CONFIG) window.CLOUD_CONFIG = {};
  if (!window.CLOUD_CONFIG.endpoint) window.CLOUD_CONFIG.endpoint = location.origin;

  var _BE = '/* ===== hometown-qr self-hosted backend adapter ===== */';
  if (window.console && console.log) console.log('[qr] 使用自建后端适配器 ' + apiBase());
  try { window.__QR_BACKEND_TAG__ = _BE; } catch (e) {}
})();
