// 数据层：JSON 文件读写。
// 表 4-18 约定：写 store.json.tmp / links.json.tmp 后 rename 覆盖，避免写入中途文件损坏。
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

function atomicWrite(fullPath, obj) {
  const tmp = fullPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, fullPath);
}

class JsonStore {
  constructor(filename, defaults) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    this.file = path.join(DATA_DIR, filename);
    this.defaults = defaults;
    if (!fs.existsSync(this.file)) atomicWrite(this.file, defaults);
  }

  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      // 文件损坏时回到初始状态，保证服务仍能启动
      atomicWrite(this.file, JSON.parse(JSON.stringify(this.defaults)));
      return JSON.parse(JSON.stringify(this.defaults));
    }
  }

  write(obj) {
    atomicWrite(this.file, obj);
  }
}

module.exports = { JsonStore, DATA_DIR };
