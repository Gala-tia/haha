// RealtimeHub：维护连接池、按文档分组广播、按消息类型分发。
// 表 4-13：onConnection(ws, req) / handle(connId, msg) / broadcast(docId, msg, excludeConnId) / close(connId)
// 客户端 → 服务端：HELLO / LOCK_REQUEST / LOCK_QUEUE_CANCEL / EDIT / CURSOR / HEARTBEAT / LOCK_RELEASE
// 服务端 → 客户端：WELCOME / PRESENCE / QUEUE_UPDATE / LOCK_GRANTED / LOCK_QUEUED / QUEUE_CANCELLED / LOCK_DENIED / LOCK_AVAILABLE / LOCK_TIMEOUT / EDIT / CURSOR / ERROR
// 第 2 轮迭代：写入权释放时同步交接给队列首位，不再由「谁先点到」决定。
const crypto = require('crypto');

const COLORS = ['#E8833A', '#3E9BD6', '#7B68C4', '#45A578', '#D2607A', '#B9913F', '#4FA8A8', '#9C6BB0'];

class RealtimeHub {
  constructor({ linkService, lockService, docService, versionService }) {
    this.links = linkService;
    this.locks = lockService;
    this.docs = docService;
    this.versions = versionService;
    this.sessions = new Map();    // connId -> Session
    this.connections = new Map(); // docId -> Set<connId>
  }

  onConnection(ws, req) {
    const connId = crypto.randomBytes(8).toString('hex');
    const session = {
      connId, ws, token: null, docId: null, role: null, memberName: null,
      lastSeen: Date.now(), editingPara: 0, color: null
    };
    this.sessions.set(connId, session);
    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        this.send(connId, { type: 'ERROR', message: '消息格式错误' });
        return;
      }
      this.handle(connId, msg);
    });
    ws.on('close', () => this.close(connId));
    ws.on('error', () => {});
    return connId;
  }

  send(connId, msg) {
    const s = this.sessions.get(connId);
    if (s && s.ws.readyState === 1) s.ws.send(JSON.stringify(msg));
  }

  broadcast(docId, msg, excludeConnId) {
    const set = this.connections.get(docId);
    if (!set) return;
    const payload = JSON.stringify(msg);
    for (const id of set) {
      if (id === excludeConnId) continue;
      const s = this.sessions.get(id);
      if (s && s.ws.readyState === 1) s.ws.send(payload);
    }
  }

  membersOf(docId) {
    const set = this.connections.get(docId);
    if (!set) return [];
    return [...set]
      .map((id) => this.sessions.get(id))
      .filter(Boolean)
      .map((s) => ({ connId: s.connId, name: s.memberName, role: s.role, paraIndex: s.editingPara, color: s.color }));
  }

  holderView(docId) {
    const lock = this.locks.holderOf(docId);
    return lock ? { name: lock.holderName, connId: lock.holderConnId } : null;
  }

  broadcastPresence(docId) {
    this.broadcast(docId, { type: 'PRESENCE', members: this.membersOf(docId), lockHolder: this.holderView(docId) });
  }

  broadcastQueue(docId) {
    this.broadcast(docId, { type: 'QUEUE_UPDATE', queue: this.locks.queueView(docId) });
  }

  handle(connId, msg) {
    const s = this.sessions.get(connId);
    if (!s) return;
    s.lastSeen = Date.now();
    switch (msg.type) {
      case 'HELLO': return this.onHello(connId, s, msg);
      case 'LOCK_REQUEST': return this.onLockRequest(connId, s, msg);
      case 'LOCK_QUEUE_CANCEL': return this.onQueueCancel(connId, s, msg);
      case 'EDIT': return this.onEdit(connId, s, msg);
      case 'CURSOR': return this.onCursor(connId, s, msg);
      case 'HEARTBEAT': return this.onHeartbeat(connId, s, msg);
      case 'LOCK_RELEASE': return this.onLockRelease(connId, s, msg);
      default: return this.send(connId, { type: 'ERROR', message: '未知消息类型: ' + msg.type });
    }
  }

  onHello(connId, s, msg) {
    const link = this.links.verify(msg.token);
    if (!link) {
      this.send(connId, { type: 'ERROR', message: '链接无效、已过期或已停用' });
      return;
    }
    s.token = link.token;
    s.docId = link.docId || msg.docId || 'doc-1';
    s.role = link.role;
    s.memberName = link.memberName;
    if (!this.connections.has(s.docId)) this.connections.set(s.docId, new Set());
    const peers = this.membersOf(s.docId).length;
    s.color = COLORS[peers % COLORS.length];
    this.connections.get(s.docId).add(connId);

    this.send(connId, {
      type: 'WELCOME', connId, role: s.role, color: s.color,
      members: this.membersOf(s.docId), lockHolder: this.holderView(s.docId),
      queue: this.locks.queueView(s.docId),
      // 断线重连时据此恢复最新正文（FR-08）
      html: this.docs.getDocument(s.docId).html
    });
    this.broadcast(s.docId, { type: 'PRESENCE', members: this.membersOf(s.docId), lockHolder: this.holderView(s.docId) }, connId);
  }

  onLockRequest(connId, s, msg) {
    if (!s.token) return this.send(connId, { type: 'ERROR', message: '尚未完成 HELLO 握手' });
    const link = this.links.verify(s.token);
    if (!link || link.role === 'viewer') {
      this.send(connId, { type: 'LOCK_DENIED', holder: this.holderView(s.docId), reason: '只读链接不可获取写入权' });
      return;
    }
    const result = this.locks.acquire(s.docId, s.token, s.memberName, connId);
    if (result.ok) {
      this.send(connId, { type: 'LOCK_GRANTED', holder: { name: s.memberName } });
    } else if (result.queued) {
      // 已被占用 → 入队，不再要求用户反复点按去抢
      this.send(connId, {
        type: 'LOCK_QUEUED', position: result.position, queueLength: result.queueLength,
        duplicate: !!result.duplicate,
        holder: result.holder ? { name: result.holder.holderName } : this.holderView(s.docId)
      });
    } else {
      this.send(connId, { type: 'LOCK_DENIED', holder: { name: result.holder.holderName }, reason: '已有成员持有写入权' });
    }
    this.broadcastQueue(s.docId);
    this.broadcastPresence(s.docId);
  }

  onQueueCancel(connId, s) {
    if (!s.docId) return;
    const ok = this.locks.cancelQueue(s.docId, connId);
    this.send(connId, { type: 'QUEUE_CANCELLED', ok });
    this.broadcastQueue(s.docId);
  }

  // 释放锁后立即把写入权交给队首。整个方法同步执行、无 await，
  // Node 单线程下不会在「释放」与「授予」之间插入其他连接的 LOCK_REQUEST。
  grantNext(docId) {
    let item;
    while ((item = this.locks.shiftQueue(docId))) {
      if (!this.sessions.has(item.connId)) continue; // 排队者已断线，跳过
      const lock = this.locks.setLock(docId, item);
      this.send(item.connId, { type: 'LOCK_GRANTED', holder: { name: item.name }, fromQueue: true });
      this.broadcastQueue(docId);
      this.broadcastPresence(docId);
      return lock;
    }
    return null;
  }

  onEdit(connId, s, msg) {
    const lock = this.locks.holderOf(s.docId);
    if (!lock || lock.holderToken !== s.token || lock.holderConnId !== connId) {
      this.send(connId, { type: 'ERROR', message: '当前无写入权，本次修改未保存' });
      return;
    }
    if (typeof msg.html !== 'string') return;
    this.docs.saveHtml(s.docId, msg.html);
    this.broadcast(s.docId, {
      type: 'EDIT', html: msg.html, caretPara: Number(msg.caretPara) || 0,
      author: s.memberName, color: s.color, seq: msg.seq
    }, connId);
  }

  onCursor(connId, s, msg) {
    if (!s.docId) return;
    s.editingPara = Number(msg.paraIndex) || 0;
    this.broadcast(s.docId, { type: 'CURSOR', name: s.memberName, paraIndex: s.editingPara, color: s.color }, connId);
  }

  onHeartbeat(connId, s, msg) {
    if (s.docId && s.token) this.locks.renew(s.docId, s.token);
  }

  onLockRelease(connId, s, msg) {
    if (s.docId && s.token) this.finishLock(s.docId, s.token, s, 'LOCK_AVAILABLE');
  }

  // 释放锁 → 生成一次版本快照 → 交接队首 → 广播。主动释放、连接断开、超时三条路径共用。
  finishLock(docId, token, session, eventType) {
    const lock = this.locks.holderOf(docId);
    if (!lock || lock.holderToken !== token) return false;
    this.locks.release(docId, token);
    const summary = eventType === 'LOCK_TIMEOUT'
      ? '写入锁超时，系统自动回收'
      : `${lock.holderName} 完成一次编辑（第 ${(session ? session.editingPara : 0) + 1} 段）`;
    this.versions.snapshot(docId, lock.holderName, summary);
    const handed = this.grantNext(docId);
    this.broadcast(docId, {
      type: eventType,
      holder: { name: handed ? handed.holderName : lock.holderName },
      handedTo: handed ? handed.holderName : null
    });
    if (!handed) this.broadcastPresence(docId);
    return true;
  }

  checkTimeout() {
    const expired = this.locks.checkTimeout();
    for (const lock of expired) {
      this.versions.snapshot(lock.docId, lock.holderName, '写入锁超时，系统自动回收');
      this.broadcast(lock.docId, { type: 'LOCK_TIMEOUT', holder: { name: lock.holderName } });
      const handed = this.grantNext(lock.docId);
      if (!handed) this.broadcastPresence(lock.docId);
    }
  }

  close(connId) {
    const s = this.sessions.get(connId);
    if (!s) return;
    // 排队者断线先出队，避免把锁交给一个已关闭的连接
    if (s.docId) this.locks.cancelQueue(s.docId, connId);
    if (s.docId && s.token) this.finishLock(s.docId, s.token, s, 'LOCK_AVAILABLE');
    const set = this.connections.get(s.docId);
    if (set) {
      set.delete(connId);
      if (!set.size) this.connections.delete(s.docId);
    }
    this.sessions.delete(connId);
    if (s.docId) {
      this.broadcastQueue(s.docId);
      this.broadcastPresence(s.docId);
    }
  }
}

module.exports = { RealtimeHub };
