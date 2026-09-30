const { app, BrowserWindow, ipcMain, dialog, Menu, shell: desktopShell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const pty = require('node-pty');
const { readDirectories, requireDirectory } = require('./directories.cjs');
const { loadWorkspace, saveWorkspace } = require('./workspace.cjs');
const layoutTools = require('./layout.cjs');
let dockLayout = null;
const sessions = new Map();
let workspaceStarted = false;
let restoringWorkspace = false;
let restoreEnabled = true;
let activeSessionId = null;
let sessionSerial = 0;
let saveFailed = false;
function persistWorkspace() {
  if (!workspaceStarted || restoringWorkspace) return;
  try {
    saveWorkspace(path.join(app.getPath('userData'), 'workspace.json'), {
      restoreEnabled,
      sessions: restoreEnabled ? [...sessions.values()].map(s => ({ name: s.name, cwd: s.cwd })) : [],
      activeIndex: Math.max(0, [...sessions.keys()].indexOf(activeSessionId)),
      layout: restoreEnabled ? layoutTools.mapIds(layoutTools.normalize(dockLayout, [...sessions.keys()]), id => [...sessions.keys()].indexOf(id)) : null
    });
    saveFailed = false;
  } catch {
    if (!saveFailed) send('workspace:error', '工作区暂时无法保存，请检查磁盘空间或目录权限。');
    saveFailed = true;
  }
}
let directoryRefresh;
function refreshDirectories() {
  if (directoryRefresh) return directoryRefresh;
  const live = [...sessions.entries()].filter(([, s]) => s.live);
  directoryRefresh = readDirectories(live.map(([, s]) => s.process.pid)).then(paths => {
    let changed = false;
    for (const [id, s] of live) {
      const cwd = paths.get(s.process.pid);
      if (!cwd || !sessions.has(id)) continue;
      if (cwd !== s.cwd || !s.cwdTracked) {
        s.cwd = cwd; s.cwdTracked = true; changed = true;
        if (s.ready) send('terminal:cwd', { id, cwd, cwdTracked: true });
      }
    }
    if (changed) persistWorkspace();
  }).catch(() => {}).finally(() => { directoryRefresh = null; });
  return directoryRefresh;
}
async function sessionDirectory(id) {
  await refreshDirectories();
  const s = sessions.get(id);
  if (!s) throw new Error('终端已关闭');
  return requireDirectory(s.cwd);
}
let win;
let quitting = false;
app.setName('Cairn');
// Preserve existing appearance preferences when renaming the app.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Harbor'));
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function closeSession(id, remember = true) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  dockLayout = layoutTools.remove(dockLayout, id);
  if (remember) persistWorkspace();
  if (s.live) s.process.kill();
}
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender'); }
ipcMain.handle('terminal:create', async (event, chooseFolder = false, sourceId = null) => {
  trusted(event);
  if (sessions.size >= 30) throw new Error('最多同时打开 30 个终端');
  let cwd = sourceId && !chooseFolder ? await sessionDirectory(sourceId) : os.homedir();
  if (chooseFolder) {
    const result = await dialog.showOpenDialog(win, { title: '选择终端工作目录', properties: ['openDirectory'], defaultPath: cwd });
    if (result.canceled) return null;
    cwd = result.filePaths[0];
  }
  await requireDirectory(cwd);
  return spawnSession(cwd);
});
function spawnSession(cwd, name) {
  const id = randomUUID();
  const shell = process.env.SHELL || '/bin/zsh';
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Cairn' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols: 100, rows: 30, cwd, env });
  const s = { name: name || `终端 ${++sessionSerial}`, cwd, cwdTracked: false, process: child, live: true, ready: false, pending: '', exit: null };
  sessions.set(id, s);
  child.onData(data => {
    if (!s.ready) s.pending = (s.pending + data).slice(-1000000);
    else send('terminal:data', { id, data });
  });
  child.onExit(({ exitCode }) => {
    s.live = false;
    s.exit = exitCode;
    if (s.ready) send('terminal:exit', { id, exitCode });
  });
  persistWorkspace();
  return { id, cwd, name: s.name, shell: path.basename(shell) };
}
ipcMain.handle('workspace:startup', async event => {
  trusted(event);
  if (workspaceStarted) throw new Error('工作区已启动');
  workspaceStarted = true; restoringWorkspace = true;
  const saved = loadWorkspace(path.join(app.getPath('userData'), 'workspace.json'));
  restoreEnabled = saved.restoreEnabled;
  const entries = restoreEnabled && saved.sessions !== null ? saved.sessions : [{ name: '终端 1', cwd: os.homedir() }];
  sessionSerial = entries.length;
  const terminals = []; const warnings = saved.warning ? [saved.warning] : [];
  let selectedId = null;
  const restoredIds = [];
  try {
    for (const [index, entry] of entries.entries()) {
      let cwd = entry.cwd;
      try { await requireDirectory(cwd); } catch {
        cwd = os.homedir(); warnings.push(`「${entry.name}」的目录无法访问，已回到主目录。`);
      }
      try {
        const info = spawnSession(cwd, entry.name); terminals.push(info); restoredIds[index] = info.id;
        if (index === saved.activeIndex) selectedId = info.id;
      } catch { warnings.push(`「${entry.name}」启动失败，请重新新建终端。`); }
    }
    activeSessionId = selectedId || terminals[0]?.id || null;
    dockLayout = layoutTools.normalize(layoutTools.mapIds(saved.layout, index => restoredIds[index]), terminals.map(s => s.id)) || (activeSessionId ? { id: activeSessionId } : null);
  } finally { restoringWorkspace = false; }
  persistWorkspace();
  return { terminals, activeId: activeSessionId, restoreEnabled, warnings, layout: dockLayout };
});
ipcMain.on('workspace:arrange', (event, { ids, layout, activeId }) => {
  trusted(event);
  if (!Array.isArray(ids) || ids.length !== sessions.size || new Set(ids).size !== ids.length || ids.some(id => !sessions.has(id))) return;
  const ordered = ids.map(id => [id, sessions.get(id)]);
  sessions.clear(); for (const [id, s] of ordered) sessions.set(id, s);
  dockLayout = layoutTools.normalize(layout, ids);
  if (sessions.has(activeId)) activeSessionId = activeId;
  persistWorkspace();
});
ipcMain.on('workspace:metadata', (event, { id, name, active }) => {
  trusted(event); const s = sessions.get(id); if (!s) return;
  if (typeof name === 'string' && name.trim() && name.length <= 40) s.name = name.trim();
  if (active === true) activeSessionId = id;
  persistWorkspace();
});
ipcMain.handle('workspace:restore-setting', (event, enabled) => {
  trusted(event); if (typeof enabled !== 'boolean') throw new Error('无效设置');
  restoreEnabled = enabled; persistWorkspace(); return restoreEnabled;
});
ipcMain.on('terminal:ready', (e, id) => { trusted(e); const s = sessions.get(id); if (!s || s.ready) return; s.ready = true; send('terminal:cwd', { id, cwd: s.cwd, cwdTracked: s.cwdTracked }); if (s.pending) send('terminal:data', { id, data: s.pending }); s.pending = ''; if (s.exit !== null) send('terminal:exit', { id, exitCode: s.exit }); });
ipcMain.on('terminal:input', (e, { id, data }) => { trusted(e); const s = sessions.get(id); if (s?.live && typeof data === 'string' && data.length <= 1000000) s.process.write(data); });
ipcMain.on('terminal:resize', (e, { id, cols, rows }) => { trusted(e); const s = sessions.get(id); if (s?.live && Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000) s.process.resize(cols, rows); });
ipcMain.handle('terminal:close', async (e, id) => {
  trusted(e);
  const s = sessions.get(id);
  if (s?.live) {
    const result = await dialog.showMessageBox(win, { type: 'question', message: '关闭这个终端？', detail: '此终端中正在运行的命令也会结束。', buttons: ['取消', '关闭终端'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) return false;
  }
  closeSession(id);
  return true;
});
ipcMain.handle('terminal:open-directory', async (event, id) => {
  trusted(event);
  const cwd = await sessionDirectory(id);
  const error = await desktopShell.openPath(cwd);
  if (error) throw new Error(error);
});
function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 800, minWidth: 740, minHeight: 480, title: 'Cairn', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 }, backgroundColor: '#18191b', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Intercept before both the native menu and xterm so each shortcut runs once.
  win.webContents.on('before-input-event', (event, input) => {
    if (!(process.platform === 'darwin' ? input.meta : input.control)) return;
    let action;
    if (!input.alt && input.code === 'KeyD') action = input.shift ? 'pane-split-bottom' : 'pane-split-right';
    if (input.alt && !input.shift) {
      if (input.code === 'KeyW') action = 'pane-hide';
      const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[input.key];
      if (direction) action = `pane-${direction}`;
    }
    if (!action) return;
    event.preventDefault();
    if (input.type === 'keyDown' && (!input.isAutoRepeat || !['pane-split-right', 'pane-split-bottom', 'pane-hide'].includes(action))) send('app:action', action);
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', e => {
    if (!quitting && [...sessions.values()].some(s => s.live)) {
      const answer = dialog.showMessageBoxSync(win, { type: 'question', message: '关闭所有终端并退出？', detail: '正在运行的命令将结束。', buttons: ['取消', '退出'], defaultId: 0, cancelId: 0 });
      if (answer !== 1) { e.preventDefault(); return; }
    }
    persistWorkspace();
    for (const id of sessions.keys()) closeSession(id, false);
  });
  win.on('closed', () => { win = null; });
}
app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Cairn', submenu: [
      { role: 'about', label: '关于 Cairn' },
      { type: 'separator' },
      { role: 'hide', label: '隐藏 Cairn' },
      { role: 'hideOthers', label: '隐藏其他应用' },
      { role: 'unhide', label: '显示全部' },
      { type: 'separator' },
      { role: 'quit', label: '退出 Cairn' }
    ] },
    { label: '终端', submenu: [
      { label: '新建终端', accelerator: 'CmdOrCtrl+N', click: () => send('app:action', 'new') },
      { label: '在文件夹中新建', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('app:action', 'folder') },
      { label: '关闭当前终端', accelerator: 'CmdOrCtrl+W', click: () => send('app:action', 'close') }
    ] },
    { label: '分屏', submenu: [
      { label: '左右分屏', accelerator: 'CmdOrCtrl+D', click: () => send('app:action', 'pane-split-right') },
      { label: '上下分屏', accelerator: 'CmdOrCtrl+Shift+D', click: () => send('app:action', 'pane-split-bottom') },
      { type: 'separator' },
      ...[['左侧', 'Left', 'left'], ['右侧', 'Right', 'right'], ['上方', 'Up', 'up'], ['下方', 'Down', 'down']].map(([label, key, direction]) => ({
        label: `切换到${label}分屏`, accelerator: `CmdOrCtrl+Alt+${key}`, click: () => send('app:action', `pane-${direction}`)
      })),
      { type: 'separator' },
      { label: '收起当前分屏（保留会话）', accelerator: 'CmdOrCtrl+Alt+W', click: () => send('app:action', 'pane-hide') }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
      { role: 'delete', label: '删除' },
      { role: 'selectAll', label: '全选' },
      { type: 'separator' },
      { label: '语音', submenu: [
        { role: 'startSpeaking', label: '开始朗读' },
        { role: 'stopSpeaking', label: '停止朗读' }
      ] }
    ] },
    { label: '显示', submenu: [
      { label: '放大字体', accelerator: 'CmdOrCtrl+=', click: () => send('app:action', 'zoom-in') },
      { label: '缩小字体', accelerator: 'CmdOrCtrl+-', click: () => send('app:action', 'zoom-out') },
      { label: '重置字体', accelerator: 'CmdOrCtrl+0', click: () => send('app:action', 'zoom-reset') },
      { role: 'togglefullscreen', label: '切换全屏' }
    ] },
    { role: 'windowMenu', label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' },
      { role: 'zoom', label: '缩放窗口' },
      { type: 'separator' },
      { role: 'front', label: '前置全部窗口' }
    ] }
  ]));
  createWindow();
  const directoryTimer = setInterval(refreshDirectories, 1000);
  directoryTimer.unref();
  app.once('will-quit', () => clearInterval(directoryTimer));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { quitting = true; for (const id of sessions.keys()) closeSession(id, false); });
