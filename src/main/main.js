const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const PythonBridge = require('./python-bridge');

let mainWindow;
let pythonBridge;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    title: 'Labeler App'
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Open DevTools in development mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize Python bridge
  pythonBridge = new PythonBridge();
  pythonBridge.start();

  createWindow();

  // Check for updates (skip in dev mode)
  // TEMPORARILY DISABLED - uncomment to re-enable auto-updates
  if (!process.argv.includes('--dev')) {
    autoUpdater.checkForUpdatesAndNotify();
   }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Auto-updater event handlers
autoUpdater.on('checking-for-update', () => {
  console.log('Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Available',
    message: `A new version (${info.version}) is available. It will be downloaded in the background.`
  });
});

autoUpdater.on('update-not-available', () => {
  console.log('No updates available.');
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`Download progress: ${Math.round(progress.percent)}%`);
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('Update downloaded:', info.version);
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Update Ready',
    message: `Version ${info.version} has been downloaded. The application will restart to install the update.`,
    buttons: ['Restart Now', 'Later']
  }).then((result) => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

autoUpdater.on('error', (error) => {
  console.error('Auto-updater error:', error);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (pythonBridge) {
      pythonBridge.stop();
    }
    app.quit();
  }
});

app.on('before-quit', () => {
  if (pythonBridge) {
    pythonBridge.stop();
  }
});

// IPC Handlers

// Folder selection dialog
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false };
});

// Get CSV files in folder
ipcMain.handle('get-csv-files', async (event, folderPath) => {
  console.log('get-csv-files called with folder:', folderPath);
  try {
    const files = await pythonBridge.call('get_csv_files', { folder: folderPath });
    console.log('get-csv-files result:', files);
    return { success: true, files };
  } catch (error) {
    console.error('get-csv-files error:', error);
    return { success: false, error: error.message };
  }
});

// Load patient file
ipcMain.handle('load-file', async (event, filename, folderPath) => {
  console.log('load-file called with:', filename, folderPath);
  try {
    const data = await pythonBridge.call('load_patient_file', {
      filename,
      folder: folderPath
    });
    console.log('load-file result received, columns:', data?.columns);
    return { success: true, data };
  } catch (error) {
    console.error('load-file error:', error);
    return { success: false, error: error.message };
  }
});

// Load labels
ipcMain.handle('load-labels', async (event, filename, labelerName, labelsDir) => {
  try {
    const labels = await pythonBridge.call('load_labels', {
      filename,
      labeler_name: labelerName,
      labels_directory: labelsDir
    });
    return { success: true, labels };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save labels
ipcMain.handle('save-labels', async (event, filename, labelerName, labels, labelsDir) => {
  try {
    await pythonBridge.call('save_labels', {
      filename,
      labeler_name: labelerName,
      labels,
      labels_directory: labelsDir
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Load done files
ipcMain.handle('load-done-files', async (event, labelerName, labelsDir) => {
  try {
    const doneFiles = await pythonBridge.call('load_done_files', {
      labeler_name: labelerName,
      labels_directory: labelsDir
    });
    return { success: true, done_files: doneFiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Toggle done file
ipcMain.handle('toggle-done-file', async (event, filename, labelerName, labelsDir) => {
  try {
    const result = await pythonBridge.call('toggle_done_file', {
      filename,
      labeler_name: labelerName,
      labels_directory: labelsDir
    });
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Load review files (files with any segment marked for review)
ipcMain.handle('load-review-files', async (event, labelerName, labelsDir) => {
  try {
    const reviewFiles = await pythonBridge.call('load_review_files', {
      labeler_name: labelerName,
      labels_directory: labelsDir
    });
    return { success: true, review_files: reviewFiles };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Find peaks
ipcMain.handle('find-peaks', async (event, signalData, segmentIndex) => {
  try {
    const peaks = await pythonBridge.call('find_peaks', {
      signal_data: signalData,
      segment_index: segmentIndex
    });
    return { success: true, peaks };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Find onset compression points
ipcMain.handle('find-onset-compression', async (event, signalData, systolicPeaks, windowSize, offset) => {
  try {
    const onsets = await pythonBridge.call('find_onset_compression', {
      signal_data: signalData,
      systolic_peaks: systolicPeaks,
      window: windowSize,
      offset: offset
    });
    return { success: true, onsets };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Find upslope points
ipcMain.handle('find-upslope', async (event, signalData, systolicPeaks, thresholdMethod, thresholdValue, minDistance, maxDistance) => {
  try {
    const upslopes = await pythonBridge.call('find_upslope', {
      signal_data: signalData,
      systolic_peaks: systolicPeaks,
      threshold_method: thresholdMethod,
      threshold_value: thresholdValue,
      min_distance: minDistance,
      max_distance: maxDistance
    });
    return { success: true, upslopes };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get segment data
ipcMain.handle('get-segment', async (event, fileData, segmentIndex) => {
  try {
    const segmentData = await pythonBridge.call('get_segment', {
      file_data: fileData,
      segment_index: segmentIndex
    });
    return { success: true, data: segmentData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Configuration handlers
// Use userData directory for config file (writable in packaged apps)
function getConfigPath() {
  const fs = require('fs');
  const userDataPath = app.getPath('userData');
  // Ensure the directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
  }
  return path.join(userDataPath, 'config.json');
}

ipcMain.handle('load-config', async () => {
  try {
    const fs = require('fs');
    const configPath = getConfigPath();

    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      return { success: true, config };
    } else {
      // Create default config
      const defaultConfig = {
        labeler_name: 'labeler1',
        labels_directory: 'labels',
        data_folder: '.',
        version: '1.0'
      };
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      return { success: true, config: defaultConfig };
    }
  } catch (error) {
    console.error('Error loading config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    const fs = require('fs');
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});

// Get app version
ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});
