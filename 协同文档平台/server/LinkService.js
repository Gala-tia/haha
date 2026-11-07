// LinkService：token 到成员标识、角色、文档范围的最简校验；签发与停用。
// 表 4-13：issueLink / verify / disable / list / bulkDisable / clearRecords / extendLinks
// 表 4-17：token(32位十六进制) / memberName / role(owner|editor|viewer) / docId / enabled / createdAt
// 第 1 轮迭代新增字段：expiresAt（ISO 时间字符串；null 表示永久有效，需手动停用）
// 第 5 轮迭代：extendLinks 批量顺延 expiresAt，供过期链接复用而不必重新签发。
// 表 4-18：令牌明文存于 links.json，本期不实现哈希、加密与安全防护。
const crypto = require('crypto');
const { JsonStore } = require('./JsonStore');

const ROLES = ['owner', 'editor', 'viewer'];
const DEFAULT_VALID_HOURS = 24; // 默认 1 天自动到期，免除逐条手动停用

// validHours：'0' / 0 / 'forever' / 非法值 → null（永久）；其余按小时数计算到期时间。
function calcExpiresAt(validHours) {
  const h = Number(validHours);
  if (!Number.isFinite(h) || h <= 0) return null;
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

class LinkService {
  constructor() {
    this.store = new JsonStore('links.json', { links: [] });
  }

  issueLink(memberName, role, docId, validHours) {
    const data = this.store.read();
    const hours = (validHours === undefined || validHours === null || validHours === '')
      ? DEFAULT_VALID_HOURS : validHours;
    const now = new Date();
    const link = {
      token: crypto.randomBytes(16).toString('hex'),
      memberName: String(memberName || '').trim() || '未命名成员',
      role: ROLES.includes(role) ? role : 'viewer',
      docId: docId || 'doc-1',
      enabled: true,
      createdAt: now.toISOString(),
      expiresAt: calcExpiresAt(hours)
    };
    data.links.push(link);
    this.store.write(data);
    return link;
  }

  verify(token) {
    if (!token) return null;
    const link = this.store.read().links.find((l) => l.token === token);
    if (!link || !link.enabled) return null;
    // 自动到期：到点即失效，不要求管理员逐条手动停用。
    // 旧链接没有 expiresAt 字段时按永久有效处理，兼容迭代前已签发的数据。
    if (link.expiresAt && Date.now() > Date.parse(link.expiresAt)) return null;
    return link;
  }

  disable(token) {
    const data = this.store.read();
    const link = data.links.find((l) => l.token === token);
    if (!link) return false;
    link.enabled = false;
    this.store.write(data);
    return true;
  }

  // 第 4 轮：一键停用多条链接。返回实际被停用的条数（已停用的不重复计数）。
  bulkDisable(tokens) {
    const set = new Set(Array.isArray(tokens) ? tokens : []);
    const data = this.store.read();
    let n = 0;
    for (const link of data.links) {
      if (set.has(link.token) && link.enabled) { link.enabled = false; n++; }
    }
    if (n) this.store.write(data);
    return n;
  }

  // 第 4 轮：清除记录（默认连带停用）。
  // 分两步写盘：先把命中项标记停用，再移除记录。verify 按 links.json 查令牌，
  // 记录被删后链接即永久失效，所以清除本身就等价于停用；显式先停用一次，
  // 是为了让「清除即停用」在数据上可追溯，也避免只删界面行、后端仍留可用链接的误实现。
  clearRecords(tokens) {
    const set = new Set(Array.isArray(tokens) ? tokens : []);
    const data = this.store.read();
    const hits = data.links.filter((l) => set.has(l.token));
    if (!hits.length) return 0;
    hits.forEach((l) => { l.enabled = false; });
    this.store.write(data);
    const fresh = this.store.read();
    fresh.links = fresh.links.filter((l) => !set.has(l.token));
    this.store.write(fresh);
    return hits.length;
  }

  // 第 5 轮：批量延长有效期（过期链接复用，不必重新签发）。
  // 起点取 max(当前时间, 原到期时间)：已过期的从「现在」重新起算，未过期的在
  // 原期限上顺延，不会因延期反而缩短。永久链接（无 expiresAt）跳过；
  // 延期不改动 enabled —— 手动停用是管理员的主动废弃决定，不应被延期顺带复活。
  extendLinks(tokens, hours) {
    const set = new Set(Array.isArray(tokens) ? tokens : []);
    const data = this.store.read();
    const now = Date.now();
    const span = Number(hours) * 3600 * 1000;
    const items = [];
    let skippedPermanent = 0;
    let stillDisabled = 0;
    for (const link of data.links) {
      if (!set.has(link.token)) continue;
      if (!link.expiresAt) { skippedPermanent++; continue; }
      const base = Math.max(now, Date.parse(link.expiresAt) || now);
      link.expiresAt = new Date(base + span).toISOString();
      if (!link.enabled) stillDisabled++;
      items.push({ token: link.token, memberName: link.memberName, expiresAt: link.expiresAt });
    }
    if (items.length) this.store.write(data);
    return { extended: items.length, skippedPermanent, stillDisabled, items };
  }

  list() {
    return this.store.read().links.slice().reverse();
  }
}

module.exports = { LinkService, DEFAULT_VALID_HOURS, calcExpiresAt };
