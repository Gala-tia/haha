// LockService：申请、授予、续约、释放与超时回收写入锁，保证同一时刻仅一人可写。
// 表 4-13：acquire(docId, token, name) / renew / release / checkTimeout / holderOf
// 表 4-17：write_locks 内存表，不落盘；重启即清空。
// 数值约定：锁 TTL 60s，心跳 20s 续约，每 5s 扫描超时。
const LOCK_TTL_MS = 60 * 1000;

class LockService {
  constructor() {
    this.locks = new Map(); // docId -> WriteLock
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
      return { ok: false, holder: cur };
    }
    const lock = {
      docId,
      holderToken: token,
      holderName: name,
      holderConnId: connId,
      acquiredAt: now,
      expiresAt: now + LOCK_TTL_MS
    };
    this.locks.set(docId, lock);
    return { ok: true, holder: lock };
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

  // 每 5s 由 server.js 调用；返回已回收的锁，供 RealtimeHub 补生成版本快照并广播。
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
