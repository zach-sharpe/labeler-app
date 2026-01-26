const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder and file operations
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  getCSVFiles: (folderPath) => ipcRenderer.invoke('get-csv-files', folderPath),
  loadFile: (filename, folderPath) => ipcRenderer.invoke('load-file', filename, folderPath),

  // Label operations
  loadLabels: (filename, labelerName, labelsDir) => ipcRenderer.invoke('load-labels', filename, labelerName, labelsDir),
  saveLabels: (filename, labelerName, labels, labelsDir, appVersion) => ipcRenderer.invoke('save-labels', filename, labelerName, labels, labelsDir, appVersion),
  loadDoneFiles: (labelerName, labelsDir) => ipcRenderer.invoke('load-done-files', labelerName, labelsDir),
  toggleDoneFile: (filename, labelerName, labelsDir) => ipcRenderer.invoke('toggle-done-file', filename, labelerName, labelsDir),
  loadReviewFiles: (labelerName, labelsDir) => ipcRenderer.invoke('load-review-files', labelerName, labelsDir),
  loadInProgressFiles: (labelerName, labelsDir) => ipcRenderer.invoke('load-in-progress-files', labelerName, labelsDir),

  // Signal processing
  findPeaks: (signalData, segmentIndex) => ipcRenderer.invoke('find-peaks', signalData, segmentIndex),
  findOnsetCompression: (signalData, systolicPeaks, windowSize, offset) => ipcRenderer.invoke('find-onset-compression', signalData, systolicPeaks, windowSize, offset),
  findUpslope: (signalData, systolicPeaks, thresholdMethod, thresholdValue, minDistance, maxDistance) => ipcRenderer.invoke('find-upslope', signalData, systolicPeaks, thresholdMethod, thresholdValue, minDistance, maxDistance),
  getSegment: (fileData, segmentIndex) => ipcRenderer.invoke('get-segment', fileData, segmentIndex),

  // Configuration
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
