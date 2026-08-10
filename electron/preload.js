const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    retryConnection: () => ipcRenderer.invoke('retry-connection')
});
