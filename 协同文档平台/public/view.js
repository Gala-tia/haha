// PreviewPage：第 3 轮新增。与链接管理并列的免链接只读查看页。
// 只调用 GET /api/preview/:docId 与 GET /api/versions/:docId/:vid，
// 不连接 WebSocket、不申请写入锁、不调用任何写接口（POST / restore / disable）。
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(iso) { return iso ? new Date(iso).toLocaleString('zh-CN') : '—'; }

  function currentDocId() {
    return encodeURIComponent($('docId').value.trim() || 'doc-1');
  }

  function renderVersions(docId, versions) {
    $('versionTotal').textContent = versions.length;
    $('versionEmpty').style.display = versions.length ? 'none' : 'block';
    $('versionList').innerHTML = versions.map(function (v) {
      var dl = '/api/versions/' + docId + '/' + encodeURIComponent(v.versionId) + '?download=1';
      return '<li>'
        + '<span class="vtime">' + esc(fmt(v.createdAt)) + '</span>'
        + '<span class="vmeta">' + esc(v.author) + ' · ' + esc(v.summary) + '</span>'
        + '<span class="vacts">'
        + '<button class="mini" data-act="view" data-vid="' + esc(v.versionId) + '">查看</button>'
        + '<a class="mini" href="' + esc(dl) + '" target="_blank" rel="noopener">下载</a>'
        + '</span></li>';
    }).join('');
  }

  function load() {
    var docId = currentDocId();
    $('meta').textContent = '正在加载…';
    fetch('/api/preview/' + docId).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      // 正文为协作产生的富文本 HTML，与编辑页一致，直接渲染。
      $('docBody').innerHTML = d.html || '<p style="color:#9AA6B8">（空文档）</p>';
      $('titleText').textContent = '· ' + (d.title || '未命名文档') + '（' + d.docId + '）';
      $('meta').textContent = '最后更新 ' + fmt(d.updatedAt) + ' · 版本数 ' + d.versionNo
        + ' · 本页刷新于 ' + new Date().toLocaleTimeString('zh-CN');
      renderVersions(docId, d.versions || []);
    }).catch(function (e) {
      $('docBody').innerHTML = '<p style="color:#C0563F">加载失败：' + esc(e.message)
        + '。请确认服务已启动、文档 ID 是否正确。</p>';
      $('meta').textContent = '加载失败';
    });
  }

  function openVersion(vid) {
    var docId = currentDocId();
    fetch('/api/versions/' + docId + '/' + encodeURIComponent(vid))
      .then(function (r) { return r.json(); })
      .then(function (v) {
        if (v.error) { alert(v.error); return; }
        $('modalTitle').textContent = '历史版本 · ' + fmt(v.createdAt) + ' · ' + (v.author || '');
        $('modalBody').innerHTML = v.html || '<p>（空）</p>';
        $('modal').classList.remove('hidden');
      });
  }

  function closeModal() { $('modal').classList.add('hidden'); }

  $('refreshBtn').addEventListener('click', load);
  $('docId').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });
  $('versionList').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act="view"]');
    if (btn) openVersion(btn.getAttribute('data-vid'));
  });
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  load();
})();
