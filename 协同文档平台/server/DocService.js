// DocService：读取文档正文、保存正文。
// 表 4-13：getDocument(docId) / saveHtml(docId, html)
// 表 4-17：documents 字段 docId / title / html / updatedAt / versionNo
const { JsonStore } = require('./JsonStore');

const DEFAULT_STORE = {
  documents: {
    'doc-1': {
      docId: 'doc-1',
      title: '项目协作文档',
      html: '<h1>项目协作文档</h1><p>初始正文。</p>',
      updatedAt: '',
      versionNo: 0
    }
  },
  versions: []
};

class DocService {
  constructor() {
    this.store = new JsonStore('store.json', DEFAULT_STORE);
  }

  getStore() {
    return this.store;
  }

  getDocument(docId) {
    const data = this.store.read();
    if (!data.documents[docId]) {
      data.documents[docId] = {
        docId,
        title: '未命名文档',
        html: '<p></p>',
        updatedAt: new Date().toISOString(),
        versionNo: 0
      };
      this.store.write(data);
    }
    return data.documents[docId];
  }

  saveHtml(docId, html) {
    const data = this.store.read();
    if (!data.documents[docId]) this.getDocument(docId);
    const fresh = this.store.read();
    fresh.documents[docId].html = html;
    fresh.documents[docId].updatedAt = new Date().toISOString();
    this.store.write(fresh);
  }
}

module.exports = { DocService };
