// HttpRouter：静态页、首屏数据、版本列表与下载、链接管理接口。
// 表 4-13 中的 HTTP 路由逐条对应下面的 app.get / app.post。
const express = require('express');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

class HttpRouter {
  constructor({ links, docs, versions }) {
    this.links = links;
    this.docs = docs;
    this.versions = versions;
    this.app = express();
    this.app.use(express.json());
    this.app.use('/static', express.static(PUBLIC_DIR));

    this.app.get('/', (req, res) => res.redirect('/admin.html'));
    this.app.get('/admin.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

    // GET /d/:token —— 首屏页面与文档初始内容（页面内联 bootstrap，避免二次请求）
    this.app.get('/d/:token', (req, res) => {
      const link = this.links.verify(req.params.token);
      if (!link) {
        return res.status(403).type('html').send(
          '<meta charset="utf-8"><h2>链接无效、已过期或已停用</h2><p>请向管理员重新索取专属链接。</p>'
        );
      }
      const doc = this.docs.getDocument(link.docId);
      const boot = {
        token: link.token, memberName: link.memberName, role: link.role,
        docId: link.docId, title: doc.title, html: doc.html
      };
      const tpl = fs.readFileSync(path.join(PUBLIC_DIR, 'index.template.html'), 'utf8');
      const json = JSON.stringify(boot).replace(/</g, '\\u003c');
      res.type('html').send(tpl.replace('__BOOT_DATA__', json));
    });

    // 链接管理
    this.app.get('/api/links', (req, res) => res.json(this.links.list()));
    this.app.post('/api/links', (req, res) => {
      const { memberName, role, docId, validHours } = req.body || {};
      if (!memberName || !String(memberName).trim()) {
        return res.status(400).json({ error: '成员名不能为空' });
      }
      const link = this.links.issueLink(memberName, role, docId, validHours);
      res.json({ link, url: '/d/' + link.token });
    });
    this.app.post('/api/links/:token/disable', (req, res) => {
      const ok = this.links.disable(req.params.token);
      res.json({ ok });
    });

    // 版本列表与内容（?download=1 触发下载）
    this.app.get('/api/versions/:docId', (req, res) => {
      res.json(this.versions.list(req.params.docId));
    });
    this.app.get('/api/versions/:docId/:vid', (req, res) => {
      const v = this.versions.get(req.params.vid);
      if (!v || v.docId !== req.params.docId) return res.status(404).json({ error: '版本不存在' });
      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', 'attachment; filename="version-' + v.versionId + '.html"');
        return res.type('html').send(
          '<!doctype html><meta charset="utf-8"><title>历史版本 ' + v.versionId + '</title>' + v.html
        );
      }
      res.json(v);
    });
    this.app.post('/api/versions/:vid/restore', (req, res) => {
      const v = this.versions.restore(req.params.vid);
      if (!v) return res.status(404).json({ error: '版本不存在' });
      res.json({ ok: true, versionId: v.versionId, docId: v.docId });
    });

    this.app.use((req, res) => res.status(404).type('html').send('<meta charset="utf-8"><h2>404</h2>'));
  }
}

module.exports = { HttpRouter };
