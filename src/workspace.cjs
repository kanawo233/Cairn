const fs = require('node:fs');
const path = require('node:path');
const { normalize } = require('./layout.cjs');
function loadWorkspace(file) {
  const initial = { restoreEnabled: true, sessions: null, activeIndex: 0 };
  try {
    if (fs.statSync(file).size > 256 * 1024) throw new Error('Oversized workspace');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.version !== 1 || typeof data.restoreEnabled !== 'boolean' || !Array.isArray(data.sessions) || data.sessions.length > 30 || data.sessions.some(s => !s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 40 || typeof s.cwd !== 'string' || !path.isAbsolute(s.cwd) || s.cwd.includes('\0'))) throw new Error('Invalid workspace');
    return { layout: normalize(data.layout, data.sessions.map((_, index) => index)), restoreEnabled: data.restoreEnabled, sessions: data.sessions, activeIndex: Number.isInteger(data.activeIndex) ? Math.max(0, Math.min(data.sessions.length - 1, data.activeIndex)) : 0 };
  } catch (error) {
    if (error.code === 'ENOENT') return initial;
    try { fs.renameSync(file, `${file}.invalid-${Date.now()}`); } catch {}
    return { ...initial, warning: '上次工作区无法读取，已启动新的工作区。' };
  }
}
function saveWorkspace(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, ...data }), { mode: 0o600 });
  fs.renameSync(temp, file);
}
module.exports = { loadWorkspace, saveWorkspace };
