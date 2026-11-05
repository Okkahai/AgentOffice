// The only bridge into the sandboxed UI: ask the main process to add a repository (it shows a native folder picker).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('agentOffice', { addRepository: () => ipcRenderer.invoke('ao:add-repository') });
