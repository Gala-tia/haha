// MemberPage：成员管理独立页（第 5 轮）。
// 只读聚合视图来自 GET /api/members；写操作复用链接管理页已有的批量接口，
// 不另开一套后端逻辑，避免成员页与链接管理页的规则出现分歧。
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('zh-CN') : '—'; }
  function post(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  var current = [];                 // 最近一次拉取的成员列表
  var expanded = new Set();         // 已展开链接明细的成员名

  function hours() {
    var h = Number($('extendHours').value);
    if (!Number.isFinite(h) || h < 1 || h > 8760) {
      alert('延期时长需为 1~8760 小时（1 小时 ~ 1 年）');
      return null;
    }
    return h;
  }

  function renderStats() {
    var s = { active: 0, expired: 0, disabled: 0, online: 0 };
    current.forEach(function (m) {
      s.active += m.active; s.expired += m.expired;
      s.disabled += m.disabled; s.online += m.online;
    });
    $('stMembers').textContent = current.length;
    $('stOnline').textContent = s.online;
    $('stActive').textContent = s.active;
    $('stExpired').textContent = s.expired;
    $('stDisabled').textContent = s.disabled;
  }

  function stateTag(l) {
    if (!l.enabled) return '<span class="tag off">已停用</span>';
    if (l.expired) return '<span class="tag warn">已过期</span>';
    return '<span class="tag ok">有效</span>';
  }

  function detailRow(m) {
    var items = m.links.map(function (l) {
      var url = location.origin + '/d/' + l.token;
      return '<li>' + stateTag(l)
        + '<span class="tag role">' + esc(l.role) + '</span>'
        + '<span>' + esc(fmt(l.expiresAt)) + '</span>'
        + '<a class="linkcell" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a>'
        + '</li>';
    }).join('');
    return '<tr class="detail-row"><td colspan="8">'
      + '<div style="font-size:11.5px;color:#6A7890;margin-bottom:6px">'
      + esc(m.memberName) + ' 的 ' + m.linkCount + ' 条链接（完整地址，可点开验证）</div>'
      + '<ul class="detail-list">' + items + '</ul></td></tr>';
  }

  function render() {
    var kw = $('keyword').value.trim().toLowerCase();
    var st = $('statusFilter').value;
    var rows = current.filter(function (m) {
      if (kw && m.memberName.toLowerCase().indexOf(kw) < 0) return false;
      if (st === 'usable') return m.active > 0;
      if (st === 'inactive') return m.active === 0;
      if (st === 'online') return m.online > 0;
      return true;
    });
    $('total').textContent = rows.length;
    $('emptyHint').style.display = rows.length ? 'none' : 'block';
    $('memberRows').innerHTML = rows.map(function (m) {
      var till = m.hasPermanent
        ? (m.latestExpiresAt ? fmt(m.latestExpiresAt) + '（另有永久）' : '永久')
        : fmt(m.latestExpiresAt);
      var roles = m.roles.map(function (r) { return '<span class="tag role">' + esc(r) + '</span>'; }).join(' ');
      return '<tr>'
        + '<td><strong>' + esc(m.memberName) + '</strong></td>'
        + '<td>' + roles + '</td>'
        + '<td>' + m.linkCount + '</td>'
        + '<td><span class="tag ok">' + m.active + '</span> '
        + '<span class="tag warn">' + m.expired + '</span> '
        + '<span class="tag off">' + m.disabled + '</span></td>'
        + '<td>' + esc(fmt(m.lastIssuedAt)) + '</td>'
        + '<td>' + esc(till) + '</td>'
        + '<td>' + (m.online > 0 ? '<span class="tag ok">' + m.online + ' 个连接</span>' : '<span class="tag off">—</span>') + '</td>'
        + '<td>'
        + '<button class="mini" data-act="toggle" data-name="' + esc(m.memberName) + '">'
        + (expanded.has(m.memberName) ? '收起链接' : '查看链接') + '</button> '
        + '<button class="mini extend" data-act="extend" data-name="' + esc(m.memberName) + '">延期全部</button> '
        + '<button class="mini danger" data-act="disable" data-name="' + esc(m.memberName) + '">停用全部</button>'
        + '</td></tr>'
        + (expanded.has(m.memberName) ? detailRow(m) : '');
    }).join('');
  }

  function load() {
    fetch('/api/members').then(function (r) { return r.json(); }).then(function (list) {
      current = list;
      renderStats();
      render();
    }).catch(function () { $('msg').textContent = '读取失败，请确认服务已启动'; });
  }

  function find(name) {
    return current.filter(function (m) { return m.memberName === name; })[0];
  }

  $('keyword').addEventListener('input', render);
  $('statusFilter').addEventListener('change', render);
  $('refreshBtn').addEventListener('click', function () { $('msg').textContent = ''; load(); });

  $('memberRows').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var name = btn.getAttribute('data-name');
    var m = find(name);
    if (!m) return;
    var act = btn.getAttribute('data-act');

    if (act === 'toggle') {
      if (expanded.has(name)) expanded.delete(name); else expanded.add(name);
      render();
      return;
    }
    if (act === 'extend') {
      var h = hours();
      if (h === null) return;
      if (!confirm('把「' + name + '」的 ' + m.linkCount + ' 条链接全部延长 ' + h + ' 小时吗？\n\n'
        + '· 已过期：从当前时间重新起算；未过期：在原到期时间上顺延；\n'
        + '· 永久链接自动跳过；已停用链接仅延长有效期，不会自动恢复。')) return;
      post('/api/links/bulk-extend', { tokens: m.tokens, hours: h }).then(function (r) {
        var extra = [];
        if (r.skippedPermanent) extra.push('跳过永久 ' + r.skippedPermanent + ' 条');
        if (r.stillDisabled) extra.push('仍停用 ' + r.stillDisabled + ' 条');
        $('msg').textContent = '已为「' + name + '」延期 ' + r.extended + ' 条'
          + (extra.length ? '（' + extra.join('，') + '）' : '');
        load();
      });
      return;
    }
    if (act === 'disable') {
      if (!confirm('停用「' + name + '」的全部 ' + m.linkCount + ' 条链接吗？\n\n'
        + '停用后这些链接立即失效，记录仍保留；如需恢复只能重新签发或延长后另行启用。')) return;
      post('/api/links/bulk-disable', { tokens: m.tokens }).then(function (r) {
        $('msg').textContent = '已停用「' + name + '」的 ' + r.disabled + ' 条链接';
        load();
      });
    }
  });

  load();
})();
