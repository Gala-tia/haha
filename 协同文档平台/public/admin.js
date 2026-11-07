// AdminPage：签发／停用链接，展示链接列表（含到期状态）。
// 第 4 轮：左侧勾选、全选、反选、一键停用、清除记录（默认连带停用 + 确认框）。
// 第 5 轮：选中已过期、批量延长有效期（预设 / 自定义小时数，带确认框）。
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('zh-CN') : '永久'; }
  function isExpired(l) { return !!(l.expiresAt && Date.now() > Date.parse(l.expiresAt)); }

  var selected = new Set();   // 当前勾选的 token
  var currentList = [];       // 最近一次加载的列表，供全选 / 反选 / 选中过期使用

  function post(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function syncChecks() {
    $('linkRows').querySelectorAll('.rowCheck').forEach(function (cb) {
      cb.checked = selected.has(cb.getAttribute('data-token'));
    });
  }

  function extendHours() {
    var custom = $('extendCustom').value.trim();
    var h = Number(custom === '' ? $('extendHours').value : custom);
    if (!Number.isFinite(h) || h < 1 || h > 8760) {
      alert('延长时长需为 1~8760 小时（1 小时 ~ 1 年）');
      return null;
    }
    return h;
  }

  function updateBulkBar() {
    // 清除记录后，把已不存在的 token 从选择集里移除
    selected.forEach(function (t) {
      if (!currentList.some(function (l) { return l.token === t; })) selected.delete(t);
    });
    var n = selected.size;
    $('selectedCount').textContent = n;
    $('bulkDisableBtn').disabled = n === 0;
    $('bulkExtendBtn').disabled = n === 0;
    // 清除记录「默认停用」：未勾选任何记录时按钮置灰，不允许误触
    $('bulkClearBtn').disabled = n === 0;
    var all = $('checkAll');
    all.checked = currentList.length > 0 && n === currentList.length;
    all.indeterminate = n > 0 && n < currentList.length;
  }

  function load() {
    fetch('/api/links').then(function (r) { return r.json(); }).then(function (list) {
      currentList = list;
      $('total').textContent = list.length;
      $('emptyHint').style.display = list.length ? 'none' : 'block';
      $('linkRows').innerHTML = list.map(function (l) {
        var url = location.origin + '/d/' + l.token;
        var expired = isExpired(l);
        var usable = l.enabled && !expired;
        var state = !l.enabled ? '已停用' : (expired ? '已过期' : '有效');
        var tagCls = !usable ? (expired && l.enabled ? ' expired' : ' off') : '';
        return '<tr' + (expired && l.enabled ? ' class="row-expired"' : '') + '>'
          + '<td class="checkcol"><input type="checkbox" class="rowCheck" data-token="' + esc(l.token) + '"'
          + (selected.has(l.token) ? ' checked' : '') + '></td>'
          + '<td>' + esc(l.memberName) + '</td>'
          + '<td>' + esc(l.role) + '</td>'
          + '<td>' + esc(l.docId) + '</td>'
          + '<td><span class="tag' + tagCls + '">' + state + '</span></td>'
          + '<td>' + esc(fmt(l.createdAt)) + '</td>'
          + '<td>' + esc(fmt(l.expiresAt)) + '</td>'
          // 第 3 轮：完整 URL 直接显示成可点击链接，不再依赖 title 悬浮查看
          + '<td class="linkcell" title="' + esc(url) + '"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + '</a></td>'
          + '<td><button class="mini" data-act="copy" data-url="' + esc(url) + '"' + (usable ? '' : ' disabled') + '>复制</button> '
          + '<button class="mini" data-act="disable" data-token="' + esc(l.token) + '"' + (usable ? '' : ' disabled') + '>停用</button></td>'
          + '</tr>';
      }).join('');
      updateBulkBar();
    });
  }

  $('issueBtn').addEventListener('click', function () {
    var memberName = $('memberName').value.trim();
    if (!memberName) { alert('请填写成员名'); return; }
    fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberName: memberName, role: $('role').value,
        docId: $('docId').value.trim() || 'doc-1',
        validHours: $('validHours').value
      })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { alert(data.error); return; }
      var url = location.origin + data.url;
      var box = $('result');
      box.style.display = 'block';
      box.innerHTML = '已为 <strong>' + esc(data.link.memberName) + '</strong> 签发（' + esc(data.link.role) + '）：'
        + '<br><a href="' + esc(data.url) + '" target="_blank">' + esc(url) + '</a>'
        + '<br><span style="color:#6A7890">有效期至 ' + esc(fmt(data.link.expiresAt))
        + '，到期自动失效，无需手动停用。</span>';
      $('memberName').value = '';
      load();
    }).catch(function () { alert('签发失败，请确认服务已启动'); });
  });

  // 第 4 轮：勾选状态
  $('checkAll').addEventListener('change', function () {
    var checked = this.checked;
    if (checked) currentList.forEach(function (l) { selected.add(l.token); });
    else selected.clear();
    $('linkRows').querySelectorAll('.rowCheck').forEach(function (cb) { cb.checked = checked; });
    updateBulkBar();
  });

  $('invertBtn').addEventListener('click', function () {
    currentList.forEach(function (l) {
      if (selected.has(l.token)) selected.delete(l.token); else selected.add(l.token);
    });
    syncChecks();
    updateBulkBar();
  });

  // 第 5 轮：一键只勾选过期链接，免去在长列表里逐条找
  $('selectExpiredBtn').addEventListener('click', function () {
    selected.clear();
    currentList.forEach(function (l) {
      if (l.enabled && isExpired(l)) selected.add(l.token);
    });
    syncChecks();
    updateBulkBar();
    $('bulkMsg').textContent = '已选中 ' + selected.size + ' 条过期链接';
  });

  $('linkRows').addEventListener('change', function (e) {
    var cb = e.target.closest('.rowCheck');
    if (!cb) return;
    var token = cb.getAttribute('data-token');
    if (cb.checked) selected.add(token); else selected.delete(token);
    updateBulkBar();
  });

  $('bulkDisableBtn').addEventListener('click', function () {
    var n = selected.size;
    if (!n) return;
    if (!confirm('确定停用选中的 ' + n + ' 条链接吗？停用后这些链接立即失效，记录仍保留在列表中。')) return;
    post('/api/links/bulk-disable', { tokens: Array.from(selected) }).then(function (r) {
      $('bulkMsg').textContent = '已停用 ' + r.disabled + ' 条链接';
      selected.clear();
      load();
    });
  });

  // 第 5 轮：批量延期。已过期从现在起算，未过期在原到期上顺延；永久 / 停用分别计数提示。
  $('bulkExtendBtn').addEventListener('click', function () {
    var n = selected.size;
    if (!n) return;
    var h = extendHours();
    if (h === null) return;
    if (!confirm('把选中的 ' + n + ' 条链接延长 ' + h + ' 小时吗？\n\n'
      + '· 已过期：从当前时间重新起算；\n'
      + '· 未过期：在原到期时间上顺延；\n'
      + '· 永久链接自动跳过；已停用链接仅延长有效期，不会自动恢复。')) return;
    post('/api/links/bulk-extend', { tokens: Array.from(selected), hours: h }).then(function (r) {
      var extra = [];
      if (r.skippedPermanent) extra.push('跳过永久 ' + r.skippedPermanent + ' 条');
      if (r.stillDisabled) extra.push('仍停用 ' + r.stillDisabled + ' 条');
      $('bulkMsg').textContent = '已延期 ' + r.extended + ' 条'
        + (extra.length ? '（' + extra.join('，') + '）' : '');
      load();
    });
  });

  $('bulkClearBtn').addEventListener('click', function () {
    var n = selected.size;
    if (!n) return;
    if (!confirm('确定清除选中的 ' + n + ' 条记录吗？\n\n'
      + '· 系统会先停用这些链接，再从列表永久删除记录；\n'
      + '· 删除后链接彻底失效、不可恢复，只能重新签发。\n\n此操作不可撤销。')) return;
    post('/api/links/bulk-clear', { tokens: Array.from(selected) }).then(function (r) {
      $('bulkMsg').textContent = '已清除 ' + r.cleared + ' 条记录（含停用）';
      selected.clear();
      load();
    });
  });

  $('linkRows').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'copy') {
      var url = btn.getAttribute('data-url');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { btn.textContent = '已复制'; });
      } else {
        var tmp = document.createElement('input');
        tmp.value = url; document.body.appendChild(tmp); tmp.select();
        document.execCommand('copy'); document.body.removeChild(tmp);
        btn.textContent = '已复制';
      }
      setTimeout(function () { btn.textContent = '复制'; }, 1500);
    } else if (act === 'disable') {
      var token = btn.getAttribute('data-token');
      if (!confirm('停用后该链接立即失效，确定吗？')) return;
      fetch('/api/links/' + encodeURIComponent(token) + '/disable', { method: 'POST' })
        .then(function (r) { return r.json(); }).then(load);
    }
  });

  load();
})();
