// 多人实时协同文档编辑平台 —— 启动入口
// 表 4-1：单机 B/S 三层；一条 `node server.js` 启动；端口 3000
// 表 4-18：重启后 sessions 与 write_locks 清空，documents / versions / links 从文件恢复。
const http = require('http');
const { WebSocketServer } = require('ws');

const { LinkService } = require('./server/LinkService');
const { LockService } = require('./server/LockService');
const { DocService } = require('./server/DocService');
const { VersionService } = require('./server/VersionService');
const { RealtimeHub } = require('./server/RealtimeHub');
const { HttpRouter } = require('./server/HttpRouter');

const links = new LinkService();
const locks = new LockService();
const docs = new DocService();
const versions = new VersionService(docs.getStore());
const hub = new RealtimeHub({ linkService: links, lockService: locks, docService: docs, versionService: versions });
// 第 5 轮：把 hub 传给 HTTP 层，成员管理页据此显示在线连接数。
const router = new HttpRouter({ links, docs, versions, hub });

const server = http.createServer(router.app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => hub.onConnection(ws, req));

// 每 5s 扫描并回收过期写入锁（TTL 60s，心跳 20s 续约）
setInterval(() => hub.checkTimeout(), 5000).unref();

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  多人实时协同文档编辑平台 已启动');
  console.log('  链接管理: http://localhost:' + PORT + '/admin.html');
  console.log('  文档查看: http://localhost:' + PORT + '/view.html');
  console.log('  成员管理: http://localhost:' + PORT + '/members.html');
  console.log('  WebSocket: ws://localhost:' + PORT + '/ws');
  console.log('  数据文件: data/links.json, data/store.json');
  console.log('  停止服务: Ctrl + C');
  console.log('');
});
