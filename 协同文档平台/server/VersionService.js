// VersionService：生成版本快照、版本列表、取指定版本、还原。
// 表 4-13：snapshot / list / get / restore
// 表 4-18：仅在写锁释放或超时时生成一次快照；每篇最多 50 条，超出丢弃最旧。
class VersionService {
  constructor(store) {
    this.store = store;
  }

  snapshot(docId, author, summary) {
    const data = this.store.read();
    const doc = data.documents[docId];
    if (!doc) return null;
    const version = {
      versionId: 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      docId,
      html: doc.html,
      author: author || '未知成员',
      summary: summary || '一次编辑会话',
      createdAt: new Date().toISOString()
    };
    data.versions.push(version);

    const mine = data.versions.filter((v) => v.docId === docId);
    if (mine.length > 50) {
      const drop = new Set(mine.slice(0, mine.length - 50).map((v) => v.versionId));
      data.versions = data.versions.filter((v) => !drop.has(v.versionId));
    }
    doc.versionNo = (doc.versionNo || 0) + 1;
    doc.updatedAt = new Date().toISOString();
    this.store.write(data);
    return version;
  }

  // 只返回元数据，不带正文
  list(docId) {
    return this.store.read().versions
      .filter((v) => v.docId === docId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((v) => ({
        versionId: v.versionId,
        createdAt: v.createdAt,
        author: v.author,
        summary: v.summary
      }));
  }

  get(versionId) {
    return this.store.read().versions.find((v) => v.versionId === versionId) || null;
  }

  restore(versionId) {
    const data = this.store.read();
    const version = data.versions.find((v) => v.versionId === versionId);
    if (!version) return null;
    const doc = data.documents[version.docId];
    if (!doc) return null;
    doc.html = version.html;
    doc.updatedAt = new Date().toISOString();
    doc.versionNo = (doc.versionNo || 0) + 1;
    this.store.write(data);
    return version;
  }
}

module.exports = { VersionService };
