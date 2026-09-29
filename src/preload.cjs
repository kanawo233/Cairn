const { contextBridge, ipcRenderer } = require('electron');
const on = (channel, callback) => { const listener = (_, value) => callback(value); ipcRenderer.on(channel, listener); return () => ipcRenderer.removeListener(channel, listener); };
contextBridge.exposeInMainWorld('harbor', {
  create: folder => ipcRenderer.invoke('terminal:create', Boolean(folder)),
  ready: id => ipcRenderer.send('terminal:ready', id),
  input: (id, data) => ipcRenderer.send('terminal:input', { id, data }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  close: id => ipcRenderer.invoke('terminal:close', id),
  onData: callback => on('terminal:data', callback),
  onExit: callback => on('terminal:exit', callback),
  onAction: callback => on('app:action', callback)
});
