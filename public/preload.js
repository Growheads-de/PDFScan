const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (filters) => ipcRenderer.invoke('select-file', filters),
  selectExcelFile: () => ipcRenderer.invoke('select-excel-file'),
  processPdfs: (config) => ipcRenderer.invoke('process-pdfs', config),
  saveApiKey: (apiKey) => ipcRenderer.invoke('save-api-key', apiKey),
  loadApiKey: () => ipcRenderer.invoke('load-api-key'),
  saveMistralApiKey: (apiKey) => ipcRenderer.invoke('save-mistral-api-key', apiKey),
  loadMistralApiKey: () => ipcRenderer.invoke('load-mistral-api-key'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadConfig: () => ipcRenderer.invoke('load-config'),
  onProcessingProgress: (callback) => {
    ipcRenderer.on('processing-progress', (event, data) => callback(data));
  },
  removeProcessingProgressListener: () => {
    ipcRenderer.removeAllListeners('processing-progress');
  }
}); 