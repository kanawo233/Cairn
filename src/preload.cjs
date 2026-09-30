const { contextBridge, ipcRenderer } = require('electron');
const on = (channel, callback) => { const listener = (_, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('harbor', {
  startup: () => ipcRenderer.invoke('workspace:startup'),
  arrange: data => ipcRenderer.send('workspace:arrange', data),
  metadata: data => ipcRenderer.send('workspace:metadata', data),
  setRestore: enabled => ipcRenderer.invoke('workspace:restore-setting', enabled),
  onWorkspaceError: callback => on('workspace:error', callback),
  create: (folder, sourceId) => ipcRenderer.invoke('terminal:create', Boolean(folder), sourceId),
  openDirectory: id => ipcRenderer.invoke('terminal:open-directory', id),
  onDirectory: callback => on('terminal:cwd', callback),
  ready: id => ipcRenderer.send('terminal:ready', id),
  input: (id, data) => ipcRenderer.send('terminal:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  close: id => ipcRenderer.invoke('terminal:close', id),
  onData: callback => on('terminal:data', callback),
  onExit: callback => on('terminal:exit', callback),
  onAction: callback => on('app:action', callback)
});
