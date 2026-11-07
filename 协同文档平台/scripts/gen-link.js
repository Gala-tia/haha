// 命令行签发链接：node scripts/gen-link.js 张三 editor doc-1 24
// 第 4 个参数为有效时长（小时）；0 表示永久，省略则默认 24 小时自动失效。
// 与 AdminPage 共用 LinkService，落盘到 data/links.json。
const { LinkService } = require('../server/LinkService');

const [memberName, role = 'editor', docId = 'doc-1', validHours] = process.argv.slice(2);
if (!memberName) {
  console.log('用法: node scripts/gen-link.js <成员名> [editor|viewer|owner] [docId] [有效小时数]');
  console.log('示例: node scripts/gen-link.js 张三 editor doc-1 24   （1 天后自动失效）');
  console.log('      node scripts/gen-link.js 张三 editor doc-1 0    （永久有效，需手动停用）');
  process.exit(1);
}

const link = new LinkService().issueLink(memberName, role, docId, validHours);
console.log('成员名  : ' + link.memberName);
console.log('角色    : ' + link.role);
console.log('文档 ID : ' + link.docId);
console.log('令牌    : ' + link.token);
console.log('有效期至: ' + (link.expiresAt ? new Date(link.expiresAt).toLocaleString('zh-CN') : '永久'));
console.log('链接    : http://localhost:' + (process.env.PORT || 3000) + '/d/' + link.token);
