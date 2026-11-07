// LockService：申请、排队、授予、续约、释放与超时回收写入锁，保证同一时刻仅一人可写。
// 表 4-13：acquire / queueView / cancelQueue / shiftQueue / setLock / renew / release / checkTimeout / holderOf
// 表 4-17：write_locks 与 write_queue 均为内存表，不落盘；重启即清空。
// 数值约定：锁 TTL 60s，心跳 20s 续约，每 5s 扫描超时。
// 第 2 轮迭代：写入权释放时按 FIFO 交接给队首，不再由「谁先点到」决定。
const LOCK_TTL_MS = 60 * 1000;

class LockService {
  constructor() {
    this.locks = new Map();  // docId -> WriteLock
    this.queues = new Map(); // docId -> QueueItem[]（先申请先得）
  }

  _queue(docId) {
    if (!this.queues.has(docId)) this.queues.set(docId, []);
    return this.queues.get(docId);
  }

  setLock(docId, item) {
    const now = Date.now();
    const lock = {
      docId,
      holderToken: item.token,
      holderName: item.name,
      holderConnId: item.connId,
      acquiredAt: now,
      expiresAt: now + LOCK_TTL_MS
    };
    this.locks.set(docId, lock);
    return lock;
  }

  acquire(docId, token, name, connId) {
    const now = Date.now();
    const cur = this.locks.get(docId);
    if (cur && cur.expiresAt > now) {
      if (cur.holderToken === token) {
        // 同一链接重复申请（如刷新页面）视为续约
        cur.expiresAt = now + LOCK_TTL_MS;
        cur.holderConnId = connId;
        return { ok: true, holder: cur };
      }
      return this._enqueue(docId, { token, name, connId }, cur);
    }
    // 空闲但队列非空时也不许插队，防止释放与交接之间被新申请抢占
    if (this._queue(docId).length) {
      return this._enqueue(docId, { token, name, connId }, null);
    }
    return { ok: true, holder: this.setLock(docId, { token, name, connId }) };
  }

  _enqueue(docId, item, holder) {
    const q = this._queue(docId);
    const i = q.findIndex((x) => x.connId === item.connId || x.token === item.token);
    if (i >= 0) {
      return { ok: false, queued: true, position: i + 1, queueLength: q.length, holder, duplicate: true };
    }
    q.push(Object.assign({}, item, { enqueuedAt: Date.now() }));
    return { ok: false, queued: true, position: q.length, queueLength: q.length, holder, duplicate: false };
  }

  queueView(docId) {
    return this._queue(docId).map((x, i) => ({ connId: x.connId, name: x.name, position: i + 1 }));
  }

  cancelQueue(docId, connId) {
    const q = this._queue(docId);
    const i = q.findIndex((x) => x.connId === connId);
    if (i < 0) return false;
    q.splice(i, 1);
    return true;
  }

  // 由 RealtimeHub 在释放锁后同步调用：队首出队并立即置为持锁者。
  // 整个交接在同一事件循环内完成，中间不会插入其他 WS 消息。
  shiftQueue(docId) {
    return this._queue(docId).shift() || null;
  }

  renew(docId, token) {
    const lock = this.locks.get(docId);
    if (!lock || lock.holderToken !== token) return false;
    lock.expiresAt = Date.now() + LOCK_TTL_MS;
    return true;
  }

  release(docId, token) {
    const lock = this.locks.get(docId);
    if (!lock || lock.holderToken !== token) return false;
    this.locks.delete(docId);
    return true;
  }

  holderOf(docId) {
    const lock = this.locks.get(docId);
    if (!lock || lock.expiresAt <= Date.now()) return null;
    return lock;
  }

  // 每 5s 由 server.js 调用；返回已回收的锁，供 RealtimeHub 补生成版本快照并交接队列。
  checkTimeout() {
    const expired = [];
    const now = Date.now();
    for (const [docId, lock] of this.locks) {
      if (lock.expiresAt <= now) {
        this.locks.delete(docId);
        expired.push(lock);
      }
    }
    return expired;
  }
}

module.exports = { LockService, LOCK_TTL_MS };
