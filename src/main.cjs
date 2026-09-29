const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const pty = require('node-pty');
const sessions = new Map();
let win;
let quitting = false;
app.setName('Cairn');
// Preserve existing appearance preferences when renaming the app.
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', path.join(app.getPath('appData'), 'Harbor'));
function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }
function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  if (s.live) s.process.kill();
}
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Invalid sender'); }
ipcMain.handle('terminal:create', async (event, chooseFolder = false) => {
  trusted(event);
  if (sessions.size >= 30) throw new Error('最多同时打开 30 个终端');
  let cwd = os.homedir();
  if (chooseFolder) {
    const result = await dialog.showOpenDialog(win, { title: '选择终端工作目录', properties: ['openDirectory'], defaultPath: cwd });
    if (result.canceled) return null;
    cwd = result.filePaths[0];
  }
  const id = randomUUID();
  const shell = process.env.SHELL || '/bin/zsh';
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Cairn' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = pty.spawn(shell, ['-l'], { name: 'xterm-256color', cols: 100, rows: 30, cwd, env });
  const s = { process: child, live: true, ready: false, pending: '', exit: null };
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
  return { id, cwd, shell: path.basename(shell) };
});
ipcMain.on('terminal:ready', (e, id) => { trusted(e); const s = sessions.get(id); if (!s || s.ready) return; s.ready = true; if (s.pending) send('terminal:data', { id, data: s.pending }); s.pending = ''; if (s.exit !== null) send('terminal:exit', { id, exitCode: s.exit }); });
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
function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 800, minWidth: 740, minHeight: 480, title: 'Cairn', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 }, backgroundColor: '#18191b', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
  win.on('close', e => {
    if (!quitting && [...sessions.values()].some(s => s.live)) {
      const answer = dialog.showMessageBoxSync(win, { type: 'question', message: '关闭所有终端并退出？', detail: '正在运行的命令将结束。', buttons: ['取消', '退出'], defaultId: 0, cancelId: 0 });
      if (answer !== 1) { e.preventDefault(); return; }
    }
    for (const id of sessions.keys()) closeSession(id);
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
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { quitting = true; for (const id of sessions.keys()) closeSession(id); });
