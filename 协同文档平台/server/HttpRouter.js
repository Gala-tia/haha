// HttpRouter：静态页、首屏数据、版本列表与下载、链接管理接口、成员聚合视图。
// 表 4-13 中的 HTTP 路由逐条对应下面的 app.get / app.post。
const express = require('express');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

class HttpRouter {
  // 第 5 轮：hub 只用于成员管理页读在线连接数，为空时退化为 0，不影响其它路由。
  constructor({ links, docs, versions, hub }) {
    this.links = links;
    this.docs = docs;
    this.versions = versions;
    this.hub = hub || null;
    this.app = express();
    this.app.use(express.json());
    this.app.use('/static', express.static(PUBLIC_DIR));

    this.app.get('/', (req, res) => res.redirect('/admin.html'));
    this.app.get('/admin.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
    // 第 3 轮：与链接管理并列的免链接只读查看页（不校验 token）
    this.app.get('/view.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'view.html')));
    // 第 5 轮：成员管理单独成页，与链接管理 / 文档查看并列
    this.app.get('/members.html', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'members.html')));

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
    // 第 4 轮：批量管理。清除记录默认连带停用，前端点击前必须弹确认框。
    this.app.post('/api/links/bulk-disable', (req, res) => {
      const tokens = (req.body || {}).tokens;
      if (!Array.isArray(tokens) || !tokens.length) return res.status(400).json({ error: '未选择任何链接' });
      res.json({ ok: true, disabled: this.links.bulkDisable(tokens) });
    });
    this.app.post('/api/links/bulk-clear', (req, res) => {
      const tokens = (req.body || {}).tokens;
      if (!Array.isArray(tokens) || !tokens.length) return res.status(400).json({ error: '未选择任何链接' });
      res.json({ ok: true, cleared: this.links.clearRecords(tokens) });
    });
    // 第 5 轮：批量延长有效期。hours 限定 1~8760（1 小时 ~ 1 年），防止误填把链接改成永久或超长。
    this.app.post('/api/links/bulk-extend', (req, res) => {
      const body = req.body || {};
      const hours = Number(body.hours);
      if (!Array.isArray(body.tokens) || !body.tokens.length) {
        return res.status(400).json({ error: '未选择任何链接' });
      }
      if (!Number.isFinite(hours) || hours < 1 || hours > 8760) {
        return res.status(400).json({ error: '延长时长需为 1~8760 小时' });
      }
      res.json(Object.assign({ ok: true, hours }, this.links.extendLinks(body.tokens, hours)));
    });

    // 第 5 轮：成员聚合视图。成员按签发时填写的 memberName 归并（系统无账号体系，
    // 同名视为同一人）；只读聚合，写操作仍复用上面的批量接口，避免另开一套逻辑。
    this.app.get('/api/members', (req, res) => {
      const now = Date.now();
      const online = (this.hub && typeof this.hub.onlineByMember === 'function')
        ? this.hub.onlineByMember() : {};
      const map = new Map();
      for (const l of this.links.list()) {
        const name = l.memberName || '未命名成员';
        if (!map.has(name)) {
          map.set(name, {
            memberName: name, roles: [], linkCount: 0,
            active: 0, expired: 0, disabled: 0,
            lastIssuedAt: '', latestExpiresAt: '', hasPermanent: false,
            online: online[name] || 0, tokens: [], links: []
          });
        }
        const m = map.get(name);
        const expired = !!(l.expiresAt && now > Date.parse(l.expiresAt));
        const usable = !!l.enabled && !expired;
        m.linkCount++;
        if (!l.enabled) m.disabled++;
        else if (expired) m.expired++;
        else m.active++;
        if (!m.roles.includes(l.role)) m.roles.push(l.role);
        if (l.createdAt && l.createdAt > m.lastIssuedAt) m.lastIssuedAt = l.createdAt;
        if (!l.expiresAt) m.hasPermanent = true;
        else if (l.expiresAt > m.latestExpiresAt) m.latestExpiresAt = l.expiresAt;
        m.tokens.push(l.token);
        m.links.push({
          token: l.token, role: l.role, docId: l.docId, enabled: l.enabled,
          createdAt: l.createdAt || '', expiresAt: l.expiresAt || null,
          expired, usable
        });
      }
      res.json([...map.values()]);
    });

    // 第 3 轮：免链接只读预览。只读正文与版本元数据，不返回任何链接或令牌。
    // 直接读 store 而不用 getDocument()，避免任意 docId 请求顺带创建新文档并写盘。
    this.app.get('/api/preview/:docId', (req, res) => {
      const docId = req.params.docId;
      const doc = this.docs.getStore().read().documents[docId];
      if (!doc) return res.status(404).json({ error: '文档不存在' });
      res.json({
        docId,
        title: doc.title,
        html: doc.html,
        updatedAt: doc.updatedAt || '',
        versionNo: doc.versionNo || 0,
        versions: this.versions.list(docId),
        readOnly: true
      });
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
