const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { stat } = require('node:fs/promises');
const run = promisify(execFile);

// Read only the local shell's cwd; never interpret terminal output as a path.
async function readDirectories(pids) {
  if (!pids.length) return new Map();
  const { stdout } = await run('/usr/sbin/lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fpn0'], { timeout: 2000, maxBuffer: 1024 * 1024 });
  const result = new Map();
  let pid;
  for (const raw of stdout.split('\0')) {
    const field = raw.replace(/^\n/, '');
    if (field[0] === 'p') pid = Number(field.slice(1));
    if (field[0] === 'n' && pid && field[1] === '/') result.set(pid, field.slice(1));
  }
  return result;
}
async function requireDirectory(cwd) {
  try { if ((await stat(cwd)).isDirectory()) return cwd; } catch {}
  throw new Error('目录不存在或无法访问，请使用文件夹按钮重新选择。');
}
module.exports = { readDirectories, requireDirectory };
