// 命令行签发链接：node scripts/gen-link.js 张三 editor doc-1
// 与 AdminPage 共用 LinkService，落盘到 data/links.json。
const { LinkService } = require('../server/LinkService');

const [memberName, role = 'editor', docId = 'doc-1'] = process.argv.slice(2);
if (!memberName) {
  console.log('用法: node scripts/gen-link.js <成员名> [editor|viewer|owner] [docId]');
  console.log('示例: node scripts/gen-link.js 张三 editor doc-1');
  process.exit(1);
}

const link = new LinkService().issueLink(memberName, role, docId);
console.log('成员名  : ' + link.memberName);
console.log('角色    : ' + link.role);
console.log('文档 ID : ' + link.docId);
console.log('令牌    : ' + link.token);
console.log('链接    : http://localhost:' + (process.env.PORT || 3000) + '/d/' + link.token);
