// AdminPage：填写成员名与角色，签发／停用链接，展示链接列表。
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function load() {
    fetch('/api/links').then(function (r) { return r.json(); }).then(function (list) {
      $('total').textContent = list.length;
      $('emptyHint').style.display = list.length ? 'none' : 'block';
      $('linkRows').innerHTML = list.map(function (l) {
        var url = location.origin + '/d/' + l.token;
        return '<tr>'
          + '<td>' + esc(l.memberName) + '</td>'
          + '<td>' + esc(l.role) + '</td>'
          + '<td>' + esc(l.docId) + '</td>'
          + '<td><span class="tag' + (l.enabled ? '' : ' off') + '">' + (l.enabled ? '有效' : '已停用') + '</span></td>'
          + '<td>' + esc(new Date(l.createdAt).toLocaleString('zh-CN')) + '</td>'
          + '<td class="linkcell" title="' + esc(url) + '">' + esc(url) + '</td>'
          + '<td><button class="mini" data-act="copy" data-url="' + esc(url) + '"' + (l.enabled ? '' : ' disabled') + '>复制</button> '
          + '<button class="mini" data-act="disable" data-token="' + esc(l.token) + '"' + (l.enabled ? '' : ' disabled') + '>停用</button></td>'
          + '</tr>';
      }).join('');
    });
  }

  $('issueBtn').addEventListener('click', function () {
    var memberName = $('memberName').value.trim();
    if (!memberName) { alert('请填写成员名'); return; }
    fetch('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberName: memberName, role: $('role').value, docId: $('docId').value.trim() || 'doc-1' })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { alert(data.error); return; }
      var url = location.origin + data.url;
      var box = $('result');
      box.style.display = 'block';
      box.innerHTML = '已为 <strong>' + esc(data.link.memberName) + '</strong> 签发（' + esc(data.link.role) + '）：'
        + '<br><a href="' + esc(data.url) + '" target="_blank">' + esc(url) + '</a>'
        + '<br><span style="color:#6A7890">把这条链接发给成员本人即可，无需账号密码。</span>';
      $('memberName').value = '';
      load();
    }).catch(function () { alert('签发失败，请确认服务已启动'); });
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
