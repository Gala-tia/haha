// LinkService：token 到成员标识、角色、文档范围的最简校验；签发与停用。
// 表 4-13：issueLink / verify / disable / list
// 表 4-17：token(32位十六进制) / memberName / role(owner|editor|viewer) / docId / enabled / createdAt
// 第 1 轮迭代新增字段：expiresAt（ISO 时间字符串；null 表示永久有效，需手动停用）
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

  list() {
    return this.store.read().links.slice().reverse();
  }
}

module.exports = { LinkService, DEFAULT_VALID_HOURS, calcExpiresAt };
