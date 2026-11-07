// 恢复初始数据：清空所有链接与历史版本，正文回到初始示例。
// 用法：npm run reset-data（会覆盖 data/links.json 与 data/store.json，请先备份需要保留的内容）
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function writeAtomic(file, obj) {
  const full = path.join(DATA_DIR, file);
  const tmp = full + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, full);
}

const INITIAL_HTML = '<h1>项目协作文档</h1>'
  + '<p>这是初始正文。点击右上角「开始编辑」申请写入权；同一时刻只有一人可以编辑，其他人会实时看到结果。</p>'
  + '<p>可以在另一个浏览器窗口用另一条链接打开，观察互斥写入与实时同步。</p>';

writeAtomic('links.json', { links: [] });
writeAtomic('store.json', {
  documents: {
    'doc-1': {
      docId: 'doc-1',
      title: '项目协作文档',
      html: INITIAL_HTML,
      updatedAt: '',
      versionNo: 0
    }
  },
  versions: []
});

console.log('已恢复初始数据：链接 0 条，版本 0 条，正文回到初始示例。');
