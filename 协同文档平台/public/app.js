// EditorPage：渲染文档、工具栏、在线成员、写入队列与版本列表；采集编辑与段落位置事件。
// 表 4-13：render / applyRemote / renderPresence / requestLock / releaseLock / pushEdit
// 第 2 轮迭代：申请写入被占用时进入 FIFO 队列，轮到自己由服务端自动授予写入权。
(function () {
  'use strict';
  var B = window.__BOOTSTRAP__ || {};
  function $(id) { return document.getElementById(id); }

  var editor = $('editor');
  var lockBtn = $('lockBtn');
  var lockHint = $('lockHint');
  var statusText = $('statusText');
  var remoteCursor = $('remoteCursor');
  var tools = document.querySelectorAll('.tool[data-cmd]');

  var ws = null;
  var hasLock = false;
  var queued = false;
  var myConnId = null;
  var connectedOnce = false;
  var seq = 0;
  var editTimer = null;
  var cursorTimer = null;

  var ROLE_TEXT = { owner: '管理员', editor: '可编辑', viewer: '只读' };

  // ---------- 首屏渲染 ----------
  function render(html) { editor.innerHTML = html || '<p></p>'; }
  render(B.html);
  $('docTitle').textContent = B.title || '未命名文档';
  $('meName').textContent = B.memberName || '未知成员';
  $('roleBadge').textContent = ROLE_TEXT[B.role] || B.role || '—';
  $('roleBadge').className = 'badge ' + (B.role || '');
  if (B.role === 'viewer') {
    lockBtn.disabled = true;
    lockBtn.textContent = '只读链接';
    lockHint.textContent = '只读链接不可获取写入权';
  }
  setEditing(false);

  function status(msg, warn) {
    statusText.textContent = msg;
    statusText.className = warn ? 'warn' : '';
  }
  function setConn(on) {
    $('connState').textContent = on ? '已连接' : '连接中断';
    $('connState').className = 'conn ' + (on ? 'on' : 'off');
  }
  function setEditing(on) {
    hasLock = !!on;
    editor.setAttribute('contenteditable', on && B.role !== 'viewer' ? 'true' : 'false');
    for (var i = 0; i < tools.length; i++) tools[i].disabled = !on;
    $('blockStyle').disabled = !on;
    if (B.role !== 'viewer') {
      lockBtn.textContent = on ? '结束编辑' : (queued ? '取消排队' : '开始编辑');
      lockBtn.className = 'primary' + (on ? ' editing' : '');
      if (on) lockHint.textContent = '你持有写入权，其他成员实时查看';
      else if (!queued) lockHint.textContent = '当前为只读，点击申请写入权';
    }
    if (on) editor.focus();
  }
  function setQueueHint(position) {
    lockHint.textContent = '已加入写入队列，你排在第 ' + position + ' 位（前面 '
      + (position - 1) + ' 人），轮到你会自动获得写入权';
  }
  function renderQueue(queue) {
    queue = queue || [];
    var box = $('queueBox');
    var info = $('queueInfo');
    box.style.display = queue.length ? 'block' : 'none';
    info.textContent = queue.length
      ? queue.length + ' 人：' + queue.map(function (x) { return x.name; }).join(' → ')
      : '无';
    if (queued && myConnId && !hasLock) {
      var me = null;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].connId === myConnId) { me = queue[i]; break; }
      }
      if (me) setQueueHint(me.position);
      else { queued = false; setEditing(false); }
    }
  }

  // ---------- WebSocket ----------
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host + '/ws');
    ws.onopen = function () {
      setConn(true);
      send({ type: 'HELLO', token: B.token, docId: B.docId });
      loadVersions();
    };
    ws.onclose = function () {
      setConn(false);
      setEditing(false);
      status('连接中断，2 秒后自动重连');
      setTimeout(connect, 2000);
    };
    ws.onerror = function () { status('WebSocket 连接异常', true); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMessage(m);
    };
  }
  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function onMessage(m) {
    switch (m.type) {
      case 'WELCOME':
        // 断线重连后恢复最新正文（FR-08），队列状态以服务端为准
        if (connectedOnce && typeof m.html === 'string') render(m.html);
        connectedOnce = true;
        myConnId = m.connId || myConnId;
        queued = false;
        setEditing(false);
        renderPresence(m.members, m.lockHolder);
        renderQueue(m.queue);
        status('已进入文档');
        break;
      case 'PRESENCE':
        renderPresence(m.members, m.lockHolder);
        break;
      case 'QUEUE_UPDATE':
        renderQueue(m.queue);
        break;
      case 'LOCK_QUEUED':
        queued = true;
        setEditing(false);
        setQueueHint(m.position);
        status(lockHint.textContent);
        break;
      case 'QUEUE_CANCELLED':
        queued = false;
        setEditing(false);
        status(m.ok ? '已退出写入队列' : '当前不在写入队列中');
        break;
      case 'LOCK_GRANTED':
        queued = false;
        setEditing(true);
        status(m.fromQueue ? '排到你了，已自动获得写入权' : '已获得写入权，可以开始编辑');
        break;
      case 'LOCK_DENIED':
        queued = false;
        setEditing(false);
        lockHint.textContent = m.holder && m.holder.name
          ? m.holder.name + ' 正在编辑，你暂时只读'
          : (m.reason || '写入权申请被拒绝');
        status(lockHint.textContent);
        break;
      case 'LOCK_AVAILABLE':
      case 'LOCK_TIMEOUT':
        loadVersions();
        if (!hasLock && !queued) {
          status(m.type === 'LOCK_TIMEOUT' ? '写入锁超时，已自动回收' : '写入权已释放，可申请编辑');
        }
        break;
      case 'EDIT':
        applyRemote(m.html, m.caretPara, m.author, m.color);
        status((m.author || '协作者') + ' 更新了正文');
        break;
      case 'CURSOR':
        showRemoteCursor(m.paraIndex, m.name, m.color);
        break;
      case 'ERROR':
        status(m.message || '服务端返回错误', true);
        break;
    }
  }

  // ---------- 在线状态与编辑位置 ----------
  function renderPresence(members, lockHolder) {
    members = members || [];
    $('onlineCount').textContent = members.length;
    $('holderName').textContent = lockHolder && lockHolder.name ? lockHolder.name : '无人';
    var html = '';
    for (var i = 0; i < members.length; i++) {
      var p = members[i];
      html += '<li><span class="dotc" style="background:' + (p.color || '#8A98AF') + '"></span>'
        + '<span>' + escapeHtml(p.name || '成员') + '</span>'
        + '<span class="mrole">' + (ROLE_TEXT[p.role] || p.role || '') + '</span></li>';
    }
    $('memberList').innerHTML = html || '<li style="color:#9AA6B8">暂无在线成员</li>';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function currentPara() {
    var sel = window.getSelection();
    if (!sel || !sel.anchorNode) return 0;
    var node = sel.anchorNode;
    if (node.nodeType === 3) node = node.parentNode;
    while (node && node.parentNode !== editor) node = node.parentNode;
    if (!node || node.parentNode !== editor) return 0;
    return Math.max(0, Array.prototype.indexOf.call(editor.children, node));
  }

  // 用绝对定位的浮层显示他人编辑位置，不改动正文 DOM，避免污染提交给服务端的 html
  function showRemoteCursor(paraIndex, name, color) {
    var el = editor.children[Number(paraIndex) || 0];
    if (!el) return;
    remoteCursor.style.top = el.offsetTop + 'px';
    remoteCursor.style.height = Math.max(el.offsetHeight, 18) + 'px';
    remoteCursor.style.background = color || '#3E9BD6';
    remoteCursor.setAttribute('data-label', (name || '协作者') + ' 正在编辑');
    remoteCursor.style.display = 'block';
    clearTimeout(remoteCursor._timer);
    remoteCursor._timer = setTimeout(function () { remoteCursor.style.display = 'none'; }, 4000);
  }

  function applyRemote(html, caretPara, author, color) {
    render(html);
    showRemoteCursor(caretPara, author, color);
  }

  // ---------- 编辑与锁操作 ----------
  function requestLock() { send({ type: 'LOCK_REQUEST', token: B.token, docId: B.docId }); }
  function cancelQueue() { send({ type: 'LOCK_QUEUE_CANCEL', docId: B.docId }); }
  function releaseLock() {
    send({ type: 'LOCK_RELEASE', token: B.token, docId: B.docId });
    setEditing(false);
    status('已结束编辑，本次会话生成了一个版本');
    setTimeout(loadVersions, 400);
  }
  function pushEdit() {
    if (!hasLock) return;
    send({
      type: 'EDIT', docId: B.docId, html: editor.innerHTML,
      caretPara: currentPara(), seq: ++seq
    });
  }

  lockBtn.addEventListener('click', function () {
    if (B.role === 'viewer') return;
    if (hasLock) releaseLock();
    else if (queued) cancelQueue();
    else requestLock();
  });

  editor.addEventListener('input', function () {
    if (!hasLock) return;
    clearTimeout(editTimer);
    editTimer = setTimeout(pushEdit, 200); // 防抖 200ms
  });
  document.addEventListener('selectionchange', function () {
    if (!hasLock) return;
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(function () { // 防抖 300ms，只报段落序号
      send({ type: 'CURSOR', paraIndex: currentPara() });
    }, 300);
  });

  for (var j = 0; j < tools.length; j++) {
    (function (btn) {
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () {
        if (!hasLock) return;
        document.execCommand(btn.getAttribute('data-cmd'), false, null);
        clearTimeout(editTimer);
        editTimer = setTimeout(pushEdit, 200);
      });
    })(tools[j]);
  }
  $('blockStyle').addEventListener('change', function () {
    if (!hasLock) return;
    document.execCommand('formatBlock', false, '<' + this.value + '>');
    clearTimeout(editTimer);
    editTimer = setTimeout(pushEdit, 200);
  });

  // 心跳每 20s 续约 60s 写入锁
  setInterval(function () { send({ type: 'HEARTBEAT', token: B.token }); }, 20000);
  window.addEventListener('beforeunload', function () { send({ type: 'LOCK_RELEASE', token: B.token, docId: B.docId }); });

  // ---------- 历史版本 ----------
  function loadVersions() {
    fetch('/api/versions/' + encodeURIComponent(B.docId)).then(function (r) { return r.json(); })
      .then(function (list) {
        var html = '';
        for (var i = 0; i < list.length; i++) {
          var v = list[i];
          html += '<li><div class="vtime">' + escapeHtml(new Date(v.createdAt).toLocaleString('zh-CN')) + '</div>'
            + '<div class="vmeta">' + escapeHtml(v.author) + ' · ' + escapeHtml(v.summary) + '</div>'
            + '<div class="vacts"><button class="mini" data-act="view" data-vid="' + v.versionId + '">查看</button>'
            + '<button class="mini" data-act="download" data-vid="' + v.versionId + '">下载</button></div></li>';
        }
        $('versionList').innerHTML = html || '<li style="color:#9AA6B8">暂无历史版本</li>';
      }).catch(function () { status('版本列表加载失败', true); });
  }
  $('refreshVer').addEventListener('click', loadVersions);
  $('versionList').addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var vid = btn.getAttribute('data-vid');
    if (btn.getAttribute('data-act') === 'download') {
      window.location.href = '/api/versions/' + encodeURIComponent(B.docId) + '/' + encodeURIComponent(vid) + '?download=1';
      return;
    }
    fetch('/api/versions/' + encodeURIComponent(B.docId) + '/' + encodeURIComponent(vid))
      .then(function (r) { return r.json(); })
      .then(function (v) {
        $('modalTitle').textContent = '历史版本 · ' + new Date(v.createdAt).toLocaleString('zh-CN');
        $('modalBody').innerHTML = v.html || '';
        $('modal').className = 'modal';
      });
  });
  $('modalClose').addEventListener('click', function () { $('modal').className = 'modal hidden'; });
  $('modal').addEventListener('click', function (e) {
    if (e.target === this) this.className = 'modal hidden';
  });

  connect();
})();
