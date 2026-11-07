// LinkService：token 到成员标识、角色、文档范围的最简校验；签发与停用。
// 表 4-13：issueLink / verify / disable / list
// 表 4-17：token(32位十六进制) / memberName / role(owner|editor|viewer) / docId / enabled / createdAt
// 表 4-18：令牌明文存于 links.json，本期不实现哈希、加密与安全防护。
const crypto = require('crypto');
const { JsonStore } = require('./JsonStore');

const ROLES = ['owner', 'editor', 'viewer'];

class LinkService {
  constructor() {
    this.store = new JsonStore('links.json', { links: [] });
  }

  issueLink(memberName, role, docId) {
    const data = this.store.read();
    const link = {
      token: crypto.randomBytes(16).toString('hex'),
      memberName: String(memberName || '').trim() || '未命名成员',
      role: ROLES.includes(role) ? role : 'viewer',
      docId: docId || 'doc-1',
      enabled: true,
      createdAt: new Date().toISOString()
    };
    data.links.push(link);
    this.store.write(data);
    return link;
  }

  verify(token) {
    if (!token) return null;
    const link = this.store.read().links.find((l) => l.token === token);
    if (!link || !link.enabled) return null;
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

module.exports = { LinkService };
