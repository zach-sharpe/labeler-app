// Application state
const state = {
  folderPath: null,
  currentFile: null,
  fileData: null,
  metadata: null,  // Store metadata from file
  annotations: null,  // Store annotations from file
  cprLabels: null,  // Store CPR labels per segment (0=non-CPR, 1=CPR)
  doneFiles: [],  // List of files marked as done
  reviewFiles: [],  // List of files with segments marked for review
  segments: [],
  currentSegment: 0,
  labels: {},
  labelerName: 'labeler1',
  appVersion: 'unknown',  // App version for audit metadata
  currentLabelType: 'compression_systolic_points',
  visibleSignals: new Set(),
  signalNames: [],  // Sorted signal names for display order
  columnOrder: [],  // Original column order from file (for data indexing)
  regionSelectionMode: false,
  regionStart: null,
  regionEnd: null,
  // Range slider state
  viewRangeStart: 0,  // Start of visible x-axis range (in seconds)
  viewRangeEnd: 10,   // End of visible x-axis range (in seconds)
  // Auto-save state
  labelsDirty: false,  // True if labels have been modified since last save
  autoSaveTimeout: null,  // Timeout ID for debounced auto-save
  // Eraser state
  eraserActive: false,  // True when shift is held and mouse is down
  eraserModified: false  // True if eraser removed any points during current drag
};

const TOLERANCE = 5;  // Tolerance in samples for peak detection/deletion
const ERASER_TOLERANCE = 8;  // Tolerance in samples for eraser mode

// Color scheme for labels (matching Dash app)
const LABEL_COLORS = {
  compression_systolic_points: 'black',
  compression_diastolic_points: 'blue',
  spontaneous_systolic_points: 'green',
  spontaneous_diastolic_points: 'purple'
};

const PLOTLY_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
  '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'
];

// Helper function to strip file extension for matching label files
function stripExtension(filename) {
  if (filename.toLowerCase().endsWith('.h5')) {
    return filename.slice(0, -3);
  } else if (filename.toLowerCase().endsWith('.hdf5')) {
    return filename.slice(0, -5);
  }
  return filename;
}

// Helper functions for signal color mapping and ordering
function getSignalColor(signalName) {
  const signalUpper = signalName.toUpperCase();
  if (signalUpper === 'ABP') {
    return 'red';
  } else if (signalUpper === 'ABP_D1') {
    return 'orange';  // First derivative - orange
  } else if (signalUpper === 'ABP_D2') {
    return 'purple';  // Second derivative - purple
  } else if (signalUpper.includes('ABP')) {
    return 'red';
  } else if (signalUpper === 'II' || signalUpper === 'ECG') {
    return 'green';
  } else if (signalUpper.includes('SPO2')) {
    return 'blue';
  } else {
    return 'gray';  // Default color for other signals
  }
}

function sortSignalsArtFirst(signalList) {
  // Sort signals: ABP first, then ABP_d1, then ABP_d2, then other signals
  const abpMain = signalList.filter(s => s.toUpperCase() === 'ABP');
  const abpD1 = signalList.filter(s => s.toUpperCase() === 'ABP_D1');
  const abpD2 = signalList.filter(s => s.toUpperCase() === 'ABP_D2');
  const otherAbp = signalList.filter(s =>
    s.toUpperCase().includes('ABP') &&
    s.toUpperCase() !== 'ABP' &&
    s.toUpperCase() !== 'ABP_D1' &&
    s.toUpperCase() !== 'ABP_D2'
  );
  const otherSignals = signalList.filter(s => !s.toUpperCase().includes('ABP'));
  return [...abpMain, ...abpD1, ...abpD2, ...otherAbp, ...otherSignals];
}

// Configuration management
async function loadConfig() {
  try {
    const result = await window.electronAPI.loadConfig();
    if (result.success) {
      return result.config;
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  // Return defaults if loading fails
  return {
    labeler_name: 'labeler1',
    labels_directory: 'labels',
    data_folder: '.',
    sidebar_position: 'left',
    version: '1.0'
  };
}

async function saveConfig(config) {
  try {
    const result = await window.electronAPI.saveConfig(config);
    return result.success;
  } catch (error) {
    console.error('Error saving config:', error);
    return false;
  }
}

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  setupEventListeners();
  focusKeyboardInput();

  // Load and display app version
  try {
    const version = await window.electronAPI.getAppVersion();
    state.appVersion = version;
    document.getElementById('app-version').textContent = `v${version}`;
  } catch (error) {
    console.error('Error getting app version:', error);
  }

  // Load configuration
  const config = await loadConfig();
  state.labelerName = config.labeler_name;
  state.folderPath = config.data_folder;

  // Update UI with config values
  document.getElementById('labeler-name').value = config.labeler_name;
  document.getElementById('settings-labeler-name').value = config.labeler_name;
  document.getElementById('settings-labels-dir').value = config.labels_directory;
  document.getElementById('settings-data-folder').value = config.data_folder;
  document.getElementById('settings-sidebar-position').value = config.sidebar_position || 'left';

  // Apply sidebar position
  applySidebarPosition(config.sidebar_position || 'left');

  // Auto-load files from default data folder if configured
  if (config.data_folder && config.data_folder !== '.') {
    await loadFilesFromFolder(config.data_folder);
  }
});

// Auto-save on app close/window unload
window.addEventListener('beforeunload', async (event) => {
  if (state.labelsDirty && state.currentFile) {
    // Attempt to save
    const result = await saveLabels(false);
    if (!result.success) {
      // Warn user about save failure
      event.preventDefault();
      event.returnValue = 'Labels failed to save. Are you sure you want to close?';
      alert('Warning: Failed to save labels before closing. Error: ' + (result.error || 'Unknown error'));
    }
  }
});

// Tab switching functionality
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      switchToTab(tabName);
    });
  });
}

function switchToTab(tabName) {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  // Update active tab button
  tabButtons.forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }

  // Show selected panel
  tabPanels.forEach(panel => {
    panel.classList.remove('active');
    if (panel.id === `tab-${tabName}`) {
      panel.classList.add('active');
    }
  });
}

function cycleTab() {
  const tabs = ['file', 'labeling', 'signals'];
  const activeBtn = document.querySelector('.tab-btn.active');
  const currentTab = activeBtn ? activeBtn.dataset.tab : 'file';
  const currentIndex = tabs.indexOf(currentTab);
  const nextIndex = (currentIndex + 1) % tabs.length;
  switchToTab(tabs[nextIndex]);
}

function setupEventListeners() {
  // Folder selection
  document.getElementById('select-folder-btn').addEventListener('click', selectFolder);

  // File selection
  document.getElementById('file-dropdown').addEventListener('change', loadFile);

  // Labeler name
  document.getElementById('labeler-name').addEventListener('change', (e) => {
    state.labelerName = e.target.value;
  });

  // Segment navigation
  document.getElementById('prev-segment').addEventListener('click', () => navigateSegment(-1));
  document.getElementById('next-segment').addEventListener('click', () => navigateSegment(1));

  // Label type selection
  document.querySelectorAll('.btn-label').forEach(btn => {
    btn.addEventListener('click', () => selectLabelType(btn.dataset.label));
  });

  // Actions
  document.getElementById('find-comp-sys-btn').addEventListener('click', () => findPeaks('compression_systolic'));
  document.getElementById('find-spon-sys-btn').addEventListener('click', () => findPeaks('spontaneous_systolic'));
  document.getElementById('find-spon-dia-btn').addEventListener('click', () => findPeaks('spontaneous_diastolic'));
  document.getElementById('find-onset-btn').addEventListener('click', findOnsetCompression);
  document.getElementById('erase-labels-btn').addEventListener('click', eraseCurrentTypeLabels);
  document.getElementById('save-labels-btn').addEventListener('click', saveLabels);
  document.getElementById('toggle-region-btn').addEventListener('click', toggleRegionMode);
  document.getElementById('clear-regions-btn').addEventListener('click', clearRegions);
  document.getElementById('review-toggle-btn').addEventListener('click', toggleReview);
  document.getElementById('done-toggle-btn').addEventListener('click', toggleDone);

  // Note textareas - save on change
  document.getElementById('review-note').addEventListener('input', handleReviewNoteChange);
  document.getElementById('region-note').addEventListener('input', handleRegionNoteChange);

  // Experimental tab
  document.getElementById('find-upslope-btn').addEventListener('click', findUpslope);
  document.getElementById('erase-upslope-btn').addEventListener('click', eraseUpslopeLabels);
  document.getElementById('upslope-method').addEventListener('change', updateUpslopeThresholdLabel);

  // Settings tab
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('reset-settings-btn').addEventListener('click', resetSettings);
  document.getElementById('browse-labels-dir-btn').addEventListener('click', browseLabelsDir);
  document.getElementById('browse-data-folder-btn').addEventListener('click', browseDataFolder);

  // Auto-update labeler name in File & Setup tab when settings change
  document.getElementById('settings-labeler-name').addEventListener('change', (e) => {
    document.getElementById('labeler-name').value = e.target.value;
    state.labelerName = e.target.value;
  });

  // Keyboard shortcuts - use global listener instead of hidden input
  document.addEventListener('keydown', handleKeyboard);

  // Eraser mode: track shift key globally for cursor changes
  document.addEventListener('keydown', handleEraserKeyDown);
  document.addEventListener('keyup', handleEraserKeyUp);

  // Keep the click handler for backward compatibility but make it less intrusive
  document.addEventListener('click', focusKeyboardInput);
}

function focusKeyboardInput() {
  // Don't refocus if user is interacting with input elements
  const activeElement = document.activeElement;
  if (activeElement && (
    activeElement.tagName === 'SELECT' ||
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'TEXTAREA' ||
    activeElement.tagName === 'BUTTON'
  )) {
    return;
  }

  setTimeout(() => {
    document.getElementById('keyboard-input').focus();
  }, 50);
}

async function loadFilesFromFolder(folderPath) {
  console.log('loadFilesFromFolder called with:', folderPath);

  state.folderPath = folderPath;
  document.getElementById('folder-path').textContent = folderPath;

  // Load CSV files
  console.log('Getting CSV files from:', folderPath);
  const filesResult = await window.electronAPI.getCSVFiles(folderPath);
  console.log('CSV files result:', filesResult);

  if (filesResult.success) {
    // Load done files for current labeler from the configured labels directory
    const labelsDir = document.getElementById('settings-labels-dir').value || 'labels';
    const doneResult = await window.electronAPI.loadDoneFiles(state.labelerName, labelsDir);
    if (doneResult.success) {
      state.doneFiles = doneResult.done_files || [];
    } else {
      state.doneFiles = [];
    }

    // Load review files for current labeler
    const reviewResult = await window.electronAPI.loadReviewFiles(state.labelerName, labelsDir);
    if (reviewResult.success) {
      state.reviewFiles = reviewResult.review_files || [];
    } else {
      state.reviewFiles = [];
    }

    const dropdown = document.getElementById('file-dropdown');
    dropdown.innerHTML = '<option value="">Select a file...</option>';
    filesResult.files.forEach(file => {
      console.log('Adding file to dropdown:', file);
      const option = document.createElement('option');
      option.value = file;
      option.textContent = file;
      // Apply styling based on status (review/red takes priority over done/green)
      const fileBaseName = stripExtension(file);
      if (state.reviewFiles.includes(fileBaseName)) {
        option.style.backgroundColor = '#f8d7da';  // Red for review
      } else if (state.doneFiles.includes(file)) {
        option.style.backgroundColor = '#d4edda';  // Green for done
      }
      dropdown.appendChild(option);
    });
    dropdown.disabled = false;
    console.log('Dropdown enabled with', filesResult.files.length, 'files');
    return true;
  } else {
    console.error('Failed to get CSV files:', filesResult.error);
    return false;
  }
}

async function selectFolder() {
  console.log('selectFolder called');
  const result = await window.electronAPI.selectFolder();
  console.log('Folder selection result:', result);

  if (result.success) {
    await loadFilesFromFolder(result.path);
  } else {
    console.log('Folder selection cancelled or failed');
  }
}

async function loadFile() {
  console.log('loadFile called');
  const filename = document.getElementById('file-dropdown').value;
  console.log('Selected filename:', filename);
  console.log('Folder path:', state.folderPath);

  if (!filename || !state.folderPath) {
    console.log('Returning early - no filename or folder path');
    return;
  }

  // Auto-save labels from previous file before loading new file
  await saveIfDirty();

  state.currentFile = filename;
  console.log('Loading file:', filename, 'from folder:', state.folderPath);

  // Load file data
  let fileResult;
  try {
    fileResult = await window.electronAPI.loadFile(filename, state.folderPath);
    console.log('File result:', fileResult);

    if (!fileResult.success) {
      console.error('Failed to load file:', fileResult.error);
      alert('Failed to load file: ' + fileResult.error);
      return;
    }
  } catch (error) {
    console.error('Exception loading file:', error);
    alert('Exception loading file: ' + error.message);
    return;
  }

  state.fileData = fileResult.data;
  state.metadata = fileResult.data.metadata;
  state.annotations = fileResult.data.annotations;
  state.cprLabels = fileResult.data.cpr_labels;  // CPR labels per segment (0=non-CPR, 1=CPR)

  // Store original column order for data indexing
  state.columnOrder = fileResult.data.columns;

  // signalNames is for display order (sorted), but use columnOrder for data access
  state.signalNames = sortSignalsArtFirst(fileResult.data.columns.filter(col => col !== 'time'));

  // Create segments using metadata
  createSegments();

  // Load labels from the configured labels directory
  const labelsDir = document.getElementById('settings-labels-dir').value || 'labels';
  const labelsResult = await window.electronAPI.loadLabels(filename, state.labelerName, labelsDir);
  if (labelsResult.success) {
    state.labels = labelsResult.labels || {};
  } else {
    state.labels = {};
  }

  // Initialize visible signals - hide derivatives by default
  state.visibleSignals = new Set(
    state.signalNames.filter(s => !s.toUpperCase().includes('_D1') && !s.toUpperCase().includes('_D2'))
  );

  // Create signal toggle buttons
  createSignalButtons();

  // Enable controls
  document.getElementById('prev-segment').disabled = false;
  document.getElementById('next-segment').disabled = false;
  document.getElementById('find-comp-sys-btn').disabled = false;
  document.getElementById('find-spon-sys-btn').disabled = false;
  document.getElementById('find-spon-dia-btn').disabled = false;
  document.getElementById('find-onset-btn').disabled = false;
  document.getElementById('find-upslope-btn').disabled = false;
  document.getElementById('erase-upslope-btn').disabled = false;
  document.getElementById('erase-labels-btn').disabled = false;
  document.getElementById('save-labels-btn').disabled = false;
  document.getElementById('toggle-region-btn').disabled = false;
  document.getElementById('clear-regions-btn').disabled = false;
  document.getElementById('review-toggle-btn').disabled = false;
  document.getElementById('done-toggle-btn').disabled = false;
  document.getElementById('review-note').disabled = false;
  document.getElementById('region-note').disabled = false;

  // Update Done button state
  updateDoneButton();

  // Display first segment
  state.currentSegment = 0;
  resetViewRange();  // Initialize view range for first segment
  updateDisplay();

  // Remove focus from dropdown so keyboard shortcuts work immediately
  document.getElementById('file-dropdown').blur();
  document.body.focus();
}

function createSegments() {
  const totalSamples = state.fileData.data.length;
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const numSegments = Math.floor(totalSamples / segmentLength);
  state.segments = Array.from({ length: numSegments }, (_, i) => i);
}

function createSignalButtons() {
  const container = document.getElementById('signal-toggles');
  container.innerHTML = '';

  state.signalNames.forEach((signal, index) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-signal';
    btn.textContent = signal;
    btn.dataset.signal = signal;

    // Apply color based on signal name
    const signalColor = getSignalColor(signal);
    const isVisible = state.visibleSignals.has(signal);
    updateButtonStyle(btn, signalColor, isVisible);

    btn.addEventListener('click', () => toggleSignal(signal, btn));
    container.appendChild(btn);
  });
}

function updateButtonStyle(btn, color, isSelected) {
  if (isSelected) {
    // Selected style - filled with signal color
    btn.style.backgroundColor = color;
    btn.style.color = 'white';
    btn.style.borderColor = color;
    btn.style.fontWeight = 'bold';
  } else {
    // Unselected/hidden style - outlined with signal color
    btn.style.backgroundColor = '#f0f0f0';
    btn.style.color = color;
    btn.style.borderColor = color;
    btn.style.fontWeight = 'normal';
  }
}

function toggleSignal(signalName, btn) {
  const signalColor = getSignalColor(signalName);

  if (state.visibleSignals.has(signalName)) {
    state.visibleSignals.delete(signalName);
    updateButtonStyle(btn, signalColor, false);
  } else {
    state.visibleSignals.add(signalName);
    updateButtonStyle(btn, signalColor, true);
  }
  updateGraph();
}

async function navigateSegment(direction) {
  const newSegment = state.currentSegment + direction;
  if (newSegment >= 0 && newSegment < state.segments.length) {
    // Auto-save before changing segments
    await saveIfDirty();
    state.currentSegment = newSegment;
    resetViewRange();  // Reset view when changing segments
    updateDisplay();
  }
}

function selectLabelType(labelType) {
  state.currentLabelType = labelType;

  // Update button styles
  document.querySelectorAll('.btn-label').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.label === labelType);
  });

  updateGraph();
}

function updateDisplay() {
  updateSegmentInfo();
  updateLabelCounts();
  updateReviewButton();
  updateRegionNote();
  updateGraph();
  focusKeyboardInput();
}

function updateReviewButton() {
  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId];
  const isReview = segmentLabels && segmentLabels.review === true;

  const btn = document.getElementById('review-toggle-btn');
  if (isReview) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }

  // Update review note textarea
  const reviewNote = document.getElementById('review-note');
  reviewNote.value = (segmentLabels && segmentLabels.review_note) || '';
}

function updateRegionNote() {
  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId];

  // Update region note textarea
  const regionNote = document.getElementById('region-note');
  regionNote.value = (segmentLabels && segmentLabels.region_note) || '';
}

function handleReviewNoteChange(e) {
  const segmentId = state.currentSegment.toString();

  // Initialize segment labels if needed
  if (!state.labels[segmentId]) {
    state.labels[segmentId] = {
      labeled: false,
      review: false,
      label_indexes: {
        compression_systolic_points: [],
        compression_diastolic_points: [],
        spontaneous_systolic_points: [],
        spontaneous_diastolic_points: []
      }
    };
  }

  state.labels[segmentId].review_note = e.target.value;
  markLabelsDirty();
}

function handleRegionNoteChange(e) {
  const segmentId = state.currentSegment.toString();

  // Initialize segment labels if needed
  if (!state.labels[segmentId]) {
    state.labels[segmentId] = {
      labeled: false,
      review: false,
      label_indexes: {
        compression_systolic_points: [],
        compression_diastolic_points: [],
        spontaneous_systolic_points: [],
        spontaneous_diastolic_points: []
      }
    };
  }

  state.labels[segmentId].region_note = e.target.value;
  markLabelsDirty();
}

function toggleReview() {
  const segmentId = state.currentSegment.toString();

  // Check if file is marked as Done - prevent marking for review if so
  const isDone = state.currentFile && state.doneFiles.includes(state.currentFile);
  const currentReviewState = state.labels[segmentId]?.review === true;

  // Only block if trying to SET review (not unset)
  if (isDone && !currentReviewState) {
    alert('Cannot mark segment for review: This file is marked as "Done". Please unmark "Done" first.');
    return;
  }

  // Initialize segment labels if needed
  if (!state.labels[segmentId]) {
    state.labels[segmentId] = {
      labeled: false,
      review: false,
      label_indexes: {
        compression_systolic_points: [],
        compression_diastolic_points: [],
        spontaneous_systolic_points: [],
        spontaneous_diastolic_points: []
      }
    };
  }

  // Toggle the review flag
  state.labels[segmentId].review = !state.labels[segmentId].review;

  // Update review files list based on whether any segment in current file has review
  updateReviewFilesState();

  // Update button appearance
  updateReviewButton();
  // Update Done button state (may need to enable/disable based on review status)
  updateDoneButton();
  // Update dropdown to reflect review status
  updateDropdownDoneStyles();
  markLabelsDirty();
}

function updateReviewFilesState() {
  // Check if any segment in the current file's labels has review: true
  const fileBaseName = stripExtension(state.currentFile);
  let hasReview = false;

  for (const segmentId in state.labels) {
    if (state.labels[segmentId] && state.labels[segmentId].review === true) {
      hasReview = true;
      break;
    }
  }

  // Update the reviewFiles list
  const index = state.reviewFiles.indexOf(fileBaseName);
  if (hasReview && index === -1) {
    state.reviewFiles.push(fileBaseName);
  } else if (!hasReview && index !== -1) {
    state.reviewFiles.splice(index, 1);
  }
}

function updateDoneButton() {
  const isDone = state.currentFile && state.doneFiles.includes(state.currentFile);
  const btn = document.getElementById('done-toggle-btn');

  if (isDone) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
  // Note: Button stays enabled so click handler can show popup with review segment info
}

// Helper function to get list of segment IDs that have review: true
function getSegmentsWithReview() {
  const reviewSegments = [];
  for (const segmentId in state.labels) {
    if (segmentId === '_metadata') continue;  // Skip metadata key
    if (state.labels[segmentId] && state.labels[segmentId].review === true) {
      reviewSegments.push(parseInt(segmentId) + 1);  // Convert to 1-based for display
    }
  }
  return reviewSegments.sort((a, b) => a - b);
}

async function toggleDone() {
  if (!state.currentFile) return;

  // Check if trying to mark as Done (not already done)
  const isDone = state.doneFiles.includes(state.currentFile);

  if (!isDone) {
    // Trying to mark as Done - check for review segments
    const reviewSegments = getSegmentsWithReview();
    if (reviewSegments.length > 0) {
      const segmentList = reviewSegments.length <= 5
        ? reviewSegments.join(', ')
        : reviewSegments.slice(0, 5).join(', ') + `, ... (${reviewSegments.length} total)`;
      alert(`Cannot mark as Done: Segment(s) ${segmentList} flagged for review.`);
      return;
    }
  }

  const labelsDir = document.getElementById('settings-labels-dir').value || 'labels';
  const result = await window.electronAPI.toggleDoneFile(state.currentFile, state.labelerName, labelsDir);
  if (result.success) {
    state.doneFiles = result.done_files;
    updateDoneButton();
    updateDropdownDoneStyles();
  }
}

function updateDropdownDoneStyles() {
  const dropdown = document.getElementById('file-dropdown');
  const options = dropdown.querySelectorAll('option');
  options.forEach(option => {
    if (option.value) {
      const fileBaseName = stripExtension(option.value);
      // Review (red) takes priority over done (green)
      if (state.reviewFiles.includes(fileBaseName)) {
        option.style.backgroundColor = '#f8d7da';  // Red for review
      } else if (state.doneFiles.includes(option.value)) {
        option.style.backgroundColor = '#d4edda';  // Green for done
      } else {
        option.style.backgroundColor = '';
      }
    }
  });
}

function updateSegmentInfo() {
  const info = `${state.currentSegment + 1} / ${state.segments.length}`;
  document.getElementById('segment-info').textContent = info;

  // Determine CPR status for current segment
  let cprStatus = '';
  if (state.cprLabels && state.cprLabels.length > state.currentSegment) {
    cprStatus = state.cprLabels[state.currentSegment] === 1 ? ' (CPR)' : ' (Non-CPR)';
  }

  // Update the patient ID display
  const patientIdDisplay = document.getElementById('patient-id-display');
  if (state.metadata && state.metadata.patient_id) {
    patientIdDisplay.textContent = `Patient: ${state.metadata.patient_id}`;
  } else if (state.currentFile) {
    // Fall back to filename if no patient_id in metadata
    patientIdDisplay.textContent = `File: ${state.currentFile}`;
  } else {
    patientIdDisplay.textContent = '';
  }

  // Update the segment display bar at the top
  const segmentDisplay = document.getElementById('segment-display');
  if (state.fileData) {
    segmentDisplay.textContent = `Segment ${state.currentSegment + 1} / ${state.segments.length}${cprStatus}`;
  } else {
    segmentDisplay.textContent = 'No file loaded';
  }
}

function updateLabelCounts() {
  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId] || {
    labeled: false,
    label_indexes: {
      compression_systolic_points: [],
      compression_diastolic_points: [],
      spontaneous_systolic_points: [],
      spontaneous_diastolic_points: []
    }
  };

  document.getElementById('count-comp-sys').textContent =
    segmentLabels.label_indexes.compression_systolic_points.length;
  document.getElementById('count-comp-dia').textContent =
    segmentLabels.label_indexes.compression_diastolic_points.length;
  document.getElementById('count-spon-sys').textContent =
    segmentLabels.label_indexes.spontaneous_systolic_points.length;
  document.getElementById('count-spon-dia').textContent =
    segmentLabels.label_indexes.spontaneous_diastolic_points.length;
}

function updateGraph() {
  if (!state.fileData) return;

  // Use dynamic values from metadata
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;

  const startIdx = state.currentSegment * segmentLength;
  const endIdx = Math.min(startIdx + segmentLength, state.fileData.data.length);
  const segmentData = state.fileData.data.slice(startIdx, endIdx);

  const visibleSignalsList = state.signalNames.filter(s => state.visibleSignals.has(s));

  // Sort visible signals with ABP first
  const sortedVisibleSignals = sortSignalsArtFirst(visibleSignalsList);
  const numSignals = sortedVisibleSignals.length;

  if (numSignals === 0) {
    Plotly.purge('main-graph');
    return;
  }

  // Create subplots
  const traces = [];
  const shapes = [];
  let subplotIndex = 1;

  sortedVisibleSignals.forEach((signalName, idx) => {
    // Use columnOrder for data indexing (original column order from file)
    const signalIndex = state.columnOrder.indexOf(signalName);
    const xValues = segmentData.map((_, i) => i / samplingRate);
    const yValues = segmentData.map(row => row[signalIndex]);

    // Get color based on signal name
    const signalColor = getSignalColor(signalName);

    // Main signal trace
    traces.push({
      x: xValues,
      y: yValues,
      type: 'scatter',
      mode: 'lines',
      name: signalName,
      line: { color: signalColor },
      xaxis: 'x',
      yaxis: `y${subplotIndex}`,
      hoverinfo: 'y',  // Show only y-value on hover
      hovertemplate: '%{y:.2f}<extra></extra>'  // Format: 2 decimal places, no trace name
    });

    subplotIndex++;
  });

  // Add label markers
  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId];

  if (segmentLabels) {
    Object.entries(LABEL_COLORS).forEach(([labelType, color]) => {
      const indices = segmentLabels.label_indexes[labelType] || [];
      if (indices.length > 0) {
        // Get the first visible signal for marker placement
        const firstVisibleSignal = sortedVisibleSignals[0];
        const signalIndex = state.columnOrder.indexOf(firstVisibleSignal);
        const yValues = segmentData.map(row => row[signalIndex]);

        const xMarkers = indices.map(i => i / samplingRate);
        const yMarkers = indices.map(i => yValues[i]);

        traces.push({
          x: xMarkers,
          y: yMarkers,
          type: 'scatter',
          mode: 'markers',
          name: labelType.replace(/_/g, ' '),
          marker: {
            color: color,
            size: 7,
            symbol: 'circle',
            line: {
              color: 'white',
              width: 1
            }
          },
          xaxis: 'x',
          yaxis: 'y1',
          showlegend: true,
          hoverinfo: 'none'  // Disable hover tooltip but allow clicks
        });
      }
    });
  }

  // Layout configuration
  // Calculate height to fit on screen: max 600px total, divided among subplots
  // This ensures all plots are visible without scrolling
  const plotHeight = Math.min(600, Math.max(200 * numSignals, 400));
  const layout = {
    height: plotHeight,
    hovermode: 'x',  // Hover triggers anywhere at same x-position
    showlegend: true,
    legend: { orientation: 'h', y: -0.15 },
    margin: { l: 60, r: 30, t: 30, b: 80 },  // Increased bottom margin for x-axis label and legend
    plot_bgcolor: '#e8e8e8',  // Light gray background for better contrast
    paper_bgcolor: '#f5f5f5',  // Slightly lighter gray for paper
    xaxis: {
      title: {
        text: 'Time (seconds)',
        standoff: 10  // Add space between axis and title
      },
      side: 'bottom',  // Ensure x-axis appears at bottom
      anchor: 'free',  // Don't anchor to any specific y-axis
      position: 0,     // Position at very bottom
      domain: [0, 1],
      range: [state.viewRangeStart, state.viewRangeEnd],  // Use view range from slider
      showspikes: true,  // Enable spike line
      spikemode: 'across',  // Show spike across entire plot
      spikethickness: 1,
      spikecolor: '#666666',
      spikedash: '3px,3px'
    }
  };

  // Create y-axes for each subplot
  // Reverse the order so first signal (ABP) appears at top
  // Increase spacing between subplots to prevent overlap
  const spacing = 0.05;  // 5% spacing between subplots
  sortedVisibleSignals.forEach((_, idx) => {
    const yaxisKey = idx === 0 ? 'yaxis' : `yaxis${idx + 1}`;
    // Calculate from top to bottom: reverse idx so idx=0 gets top position
    const reversedIdx = numSignals - 1 - idx;
    const subplotHeight = (1.0 - spacing * (numSignals - 1)) / numSignals;
    const position = reversedIdx * (subplotHeight + spacing);
    const nextPosition = position + subplotHeight;

    layout[yaxisKey] = {
      title: sortedVisibleSignals[idx],
      domain: [position, nextPosition]
    };
  });

  // Add highlighted regions if they exist
  layout.shapes = [];

  // Support both old single region format and new multiple regions format
  if (segmentLabels) {
    const regions = segmentLabels.highlighted_regions ||
                   (segmentLabels.highlighted_region ? [segmentLabels.highlighted_region] : []);

    regions.forEach(region => {
      const startTime = region.start / samplingRate;
      const endTime = region.end / samplingRate;

      // Add a semi-transparent rectangle to highlight the region on all subplots
      layout.shapes.push({
        type: 'rect',
        xref: 'x',
        yref: 'paper',  // Use paper coordinates for y to span all subplots
        x0: startTime,
        x1: endTime,
        y0: 0,
        y1: 1,
        fillcolor: 'yellow',
        opacity: 0.2,
        line: {
          width: 0
        }
      });
    });
  }

  const config = {
    responsive: true,
    displayModeBar: true
  };

  Plotly.newPlot('main-graph', traces, layout, config).then(() => {
    // Add click handler for labeling after plot is created
    const graphDiv = document.getElementById('main-graph');
    console.log('Attaching click handler to graph');

    // Remove any existing handlers first
    graphDiv.removeAllListeners('plotly_click');
    graphDiv.removeAllListeners('plotly_doubleclick');

    // Use direct DOM click handler to get x-position from cursor
    graphDiv.removeEventListener('click', handleDirectClick);
    graphDiv.addEventListener('click', handleDirectClick);

    // Still keep double-click for deletion
    graphDiv.on('plotly_doubleclick', handleGraphDoubleClick);

    // Eraser mode handlers - use capture phase to intercept before Plotly
    graphDiv.removeEventListener('mousedown', handleEraserMouseDown, true);
    graphDiv.addEventListener('mousedown', handleEraserMouseDown, true);
    graphDiv.removeEventListener('mousemove', handleEraserMouseMove, true);
    graphDiv.addEventListener('mousemove', handleEraserMouseMove, true);
    graphDiv.removeEventListener('mouseup', handleEraserMouseUp, true);
    graphDiv.addEventListener('mouseup', handleEraserMouseUp, true);
    graphDiv.removeEventListener('mouseleave', handleEraserMouseUp, true);
    graphDiv.addEventListener('mouseleave', handleEraserMouseUp, true);

    console.log('Click handlers attached successfully');
  });

  // Add right-click (context menu) handler for deleting any peak
  const graphDiv = document.getElementById('main-graph');
  graphDiv.removeEventListener('contextmenu', handleGraphRightClick);
  graphDiv.addEventListener('contextmenu', handleGraphRightClick);

  // Track hover position for right-click
  graphDiv.on('plotly_hover', (data) => {
    if (data.points && data.points.length > 0) {
      state.lastHoverData = data;
    }
  });
}

function handleGraphRightClick(event) {
  console.log('Graph right-clicked!');
  event.preventDefault(); // Prevent context menu

  // Use the last hover data if available
  if (state.lastHoverData && state.lastHoverData.points && state.lastHoverData.points.length > 0) {
    const point = state.lastHoverData.points[0];
    const clickedTime = point.x;
    const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
    const clickedIndex = Math.round(clickedTime * samplingRate);

    console.log('Right-clicked to delete at time:', clickedTime, 'index:', clickedIndex);

    const segmentId = state.currentSegment.toString();

    if (!state.labels[segmentId]) {
      return;
    }

    // Search through ALL label types to find and remove nearby peak
    const labelTypes = [
      'compression_systolic_points',
      'compression_diastolic_points',
      'spontaneous_systolic_points',
      'spontaneous_diastolic_points'
    ];

    let foundAndRemoved = false;

    for (const labelType of labelTypes) {
      const labelArray = state.labels[segmentId].label_indexes[labelType];
      const nearbyIndex = labelArray.findIndex(idx => Math.abs(idx - clickedIndex) <= TOLERANCE);

      if (nearbyIndex !== -1) {
        // Remove the label
        labelArray.splice(nearbyIndex, 1);
        console.log('Right-click removed peak from', labelType, 'at index', clickedIndex);
        foundAndRemoved = true;
        break; // Only remove one peak (the first found)
      }
    }

    if (foundAndRemoved) {
      state.labels[segmentId].labeled = true;
      updateDisplay();
      markLabelsDirty();
    }
  }
}

// Eraser mode functions
function handleEraserKeyDown(event) {
  if (event.key === 'Shift') {
    const graphDiv = document.getElementById('main-graph');
    if (graphDiv) {
      graphDiv.classList.add('eraser-cursor');
      // Disable Plotly's drag mode when shift is pressed
      Plotly.relayout(graphDiv, { dragmode: false });
    }
  }
}

function handleEraserKeyUp(event) {
  if (event.key === 'Shift') {
    const graphDiv = document.getElementById('main-graph');
    if (graphDiv) {
      graphDiv.classList.remove('eraser-cursor');
      // Re-enable Plotly's drag mode when shift is released
      Plotly.relayout(graphDiv, { dragmode: 'zoom' });
    }
    state.eraserActive = false;
  }
}

function handleEraserMouseDown(event) {
  // Only activate eraser when shift is held
  if (!event.shiftKey) return;

  // Don't process clicks on modebar
  if (event.target.classList.contains('modebar-btn') ||
      event.target.closest('.modebar')) {
    return;
  }

  console.log('Eraser mousedown - activating');
  state.eraserActive = true;
  state.eraserModified = false;  // Track if we erased anything

  // Erase at initial click position (don't update display yet)
  eraseAtPositionNoUpdate(event);

  // Prevent default and stop propagation to prevent Plotly drag
  event.preventDefault();
  event.stopPropagation();
}

function handleEraserMouseMove(event) {
  // Only erase if eraser is active (shift held + mouse down)
  if (!state.eraserActive) return;

  // If shift was released during drag, stop erasing
  if (!event.shiftKey) {
    console.log('Shift released during drag, stopping');
    handleEraserMouseUp(event);
    return;
  }

  console.log('Eraser move at', event.clientX, event.clientY);
  eraseAtPositionNoUpdate(event);

  event.preventDefault();
}

function handleEraserMouseUp(event) {
  if (state.eraserActive) {
    console.log('Eraser mouseup - deactivating, modified:', state.eraserModified);
    state.eraserActive = false;

    // Now update display once at the end if we erased anything
    if (state.eraserModified) {
      const segmentId = state.currentSegment.toString();
      state.labels[segmentId].labeled = true;
      updateDisplay();
      markLabelsDirty();
    }
  }
}

function eraseAtPositionNoUpdate(event) {
  if (!state.fileData) return;

  const graphDiv = document.getElementById('main-graph');
  const xaxis = graphDiv._fullLayout?.xaxis;
  if (!xaxis) return;

  // Calculate x position from mouse coordinates
  const bbox = graphDiv.getBoundingClientRect();
  const xPixelInPlotArea = event.clientX - bbox.left - xaxis._offset;
  const clickedTime = xaxis.range[0] + (xPixelInPlotArea / xaxis._length) * (xaxis.range[1] - xaxis.range[0]);

  if (clickedTime === undefined || isNaN(clickedTime)) return;

  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const clickedIndex = Math.round(clickedTime * samplingRate);

  const segmentId = state.currentSegment.toString();
  if (!state.labels[segmentId]) return;

  // All label types to check
  const allLabelTypes = [
    'compression_systolic_points',
    'compression_diastolic_points',
    'spontaneous_systolic_points',
    'spontaneous_diastolic_points'
  ];

  let anyRemoved = false;

  // Check each label type for points to erase
  for (const labelType of allLabelTypes) {
    const labelArray = state.labels[segmentId].label_indexes[labelType];
    if (!labelArray || labelArray.length === 0) continue;

    // Find all points within eraser tolerance (may remove multiple if close together)
    for (let i = labelArray.length - 1; i >= 0; i--) {
      const distance = Math.abs(labelArray[i] - clickedIndex);
      if (distance <= ERASER_TOLERANCE) {
        labelArray.splice(i, 1);
        state.eraserModified = true;
        anyRemoved = true;
      }
    }
  }

  // Update the graph markers in real-time
  if (anyRemoved) {
    updateGraphMarkersOnly();
  }
}

// Fast update of just the marker traces without full graph redraw
function updateGraphMarkersOnly() {
  const graphDiv = document.getElementById('main-graph');
  if (!graphDiv || !graphDiv.data) return;

  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId];
  if (!segmentLabels) return;

  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const startIdx = state.currentSegment * segmentLength;
  const endIdx = Math.min(startIdx + segmentLength, state.fileData.data.length);
  const segmentData = state.fileData.data.slice(startIdx, endIdx);

  // Get the first visible signal for y-values
  const sortedVisibleSignals = sortSignalsArtFirst(
    state.signalNames.filter(s => state.visibleSignals.has(s))
  );
  if (sortedVisibleSignals.length === 0) return;

  const firstSignal = sortedVisibleSignals[0];
  const signalIndex = state.columnOrder.indexOf(firstSignal);
  const yValues = segmentData.map(row => row[signalIndex]);

  // Find and update the marker traces
  const labelTypes = Object.keys(LABEL_COLORS);

  graphDiv.data.forEach((trace, traceIndex) => {
    // Check if this trace is a marker trace (has marker mode and matches a label type name)
    const labelType = labelTypes.find(lt => trace.name === lt.replace(/_/g, ' '));
    if (labelType && trace.mode === 'markers') {
      const indices = segmentLabels.label_indexes[labelType] || [];
      const xMarkers = indices.map(i => i / samplingRate);
      const yMarkers = indices.map(i => yValues[i]);

      // Update trace data in place
      graphDiv.data[traceIndex].x = xMarkers;
      graphDiv.data[traceIndex].y = yMarkers;
    }
  });

  // Use Plotly.react for fast update without full redraw
  Plotly.react(graphDiv, graphDiv.data, graphDiv.layout);
}

function handleDirectClick(event) {
  // Don't process clicks on buttons or other UI elements
  if (event.target.classList.contains('modebar-btn') ||
      event.target.closest('.modebar')) {
    return;
  }

  // If shift is held, eraser mode is active - don't process normal click
  if (event.shiftKey) {
    return;
  }

  // If in region selection mode, handle that instead
  if (state.regionSelectionMode) {
    // We need to convert mouse coords to data coords for region selection
    const graphDiv = document.getElementById('main-graph');
    const xaxis = graphDiv._fullLayout.xaxis;
    const bbox = graphDiv.getBoundingClientRect();

    // Calculate pixel position within the plot area (accounting for margins)
    const xPixelInPlotArea = event.clientX - bbox.left - xaxis._offset;

    // Manual conversion: pixel position in plot area to data coordinate
    const clickedTime = xaxis.range[0] + (xPixelInPlotArea / xaxis._length) * (xaxis.range[1] - xaxis.range[0]);
    const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
    const clickedIndex = Math.round(clickedTime * samplingRate);

    // Handle region selection with the calculated index
    if (state.regionStart === null) {
      state.regionStart = clickedIndex;
      document.getElementById('region-info').textContent =
        `Region start: ${clickedIndex}. Click again to set end.`;
    } else {
      state.regionEnd = clickedIndex;

      // Ensure start < end
      if (state.regionStart > state.regionEnd) {
        [state.regionStart, state.regionEnd] = [state.regionEnd, state.regionStart];
      }

      // Save region to labels
      const segmentId = state.currentSegment.toString();
      if (!state.labels[segmentId]) {
        state.labels[segmentId] = {
          labeled: true,
          label_indexes: {
            compression_systolic_points: [],
            compression_diastolic_points: [],
            spontaneous_systolic_points: [],
            spontaneous_diastolic_points: []
          }
        };
      }

      // Initialize highlighted_regions array if it doesn't exist
      if (!state.labels[segmentId].highlighted_regions) {
        state.labels[segmentId].highlighted_regions = [];
      }

      // Add new region to array
      state.labels[segmentId].highlighted_regions.push({
        start: state.regionStart,
        end: state.regionEnd
      });

      // Update info text to show number of regions
      const numRegions = state.labels[segmentId].highlighted_regions.length;
      document.getElementById('region-info').textContent =
        `Region ${numRegions} added: ${state.regionStart} - ${state.regionEnd}. Total: ${numRegions} region(s)`;

      // Reset for next region but stay in selection mode
      state.regionStart = null;
      state.regionEnd = null;

      // Redraw with region highlight
      updateGraph();
      markLabelsDirty();
    }
    return;
  }

  // Get the graph div and calculate x-position from mouse coordinates
  const graphDiv = document.getElementById('main-graph');
  const xaxis = graphDiv._fullLayout.xaxis;

  if (!xaxis) return;

  // Get bounding box and calculate relative position
  const bbox = graphDiv.getBoundingClientRect();

  // Calculate pixel position within the plot area (accounting for margins)
  const xPixelInPlotArea = event.clientX - bbox.left - xaxis._offset;

  // Manual conversion: pixel position in plot area to data coordinate
  // Linear interpolation based on axis range and length
  const clickedTime = xaxis.range[0] + (xPixelInPlotArea / xaxis._length) * (xaxis.range[1] - xaxis.range[0]);

  if (clickedTime === undefined || isNaN(clickedTime)) {
    return;
  }

  // Convert time to sample index within the segment
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const clickedIndex = Math.round(clickedTime * samplingRate);

  const segmentId = state.currentSegment.toString();

  // Initialize segment labels if needed
  if (!state.labels[segmentId]) {
    state.labels[segmentId] = {
      labeled: false,
      label_indexes: {
        compression_systolic_points: [],
        compression_diastolic_points: [],
        spontaneous_systolic_points: [],
        spontaneous_diastolic_points: []
      }
    };
  }

  // First, check if clicking near ANY existing label (to remove from any type)
  let foundAndRemoved = false;
  for (const labelType in state.labels[segmentId].label_indexes) {
    const labelArray = state.labels[segmentId].label_indexes[labelType];
    const nearbyIndex = labelArray.findIndex(idx => Math.abs(idx - clickedIndex) <= TOLERANCE);

    if (nearbyIndex !== -1) {
      labelArray.splice(nearbyIndex, 1);
      foundAndRemoved = true;
      break; // Only remove one peak (the first found)
    }
  }

  if (!foundAndRemoved) {
    // Add new peak to current label type
    const labelArray = state.labels[segmentId].label_indexes[state.currentLabelType];
    labelArray.push(clickedIndex);
    labelArray.sort((a, b) => a - b);
  }

  // Mark segment as labeled
  state.labels[segmentId].labeled = true;

  // Update the graph to show new labels
  updateDisplay();
  markLabelsDirty();
}

function handleGraphClick(data) {
  console.log('Graph clicked!', data);

  if (!data.points || data.points.length === 0) {
    console.log('No points in click data');
    return;
  }

  // If in region selection mode, handle region selection instead of labeling
  if (state.regionSelectionMode) {
    handleRegionSelection(data);
    return;
  }

  const point = data.points[0];
  const clickedTime = point.x;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const clickedIndex = Math.round(clickedTime * samplingRate);

  console.log('Clicked at time:', clickedTime, 'index:', clickedIndex);

  const segmentId = state.currentSegment.toString();

  // Initialize segment labels if needed
  if (!state.labels[segmentId]) {
    state.labels[segmentId] = {
      labeled: false,
      label_indexes: {
        compression_systolic_points: [],
        compression_diastolic_points: [],
        spontaneous_systolic_points: [],
        spontaneous_diastolic_points: []
      }
    };
  }

  // First, check if clicking near ANY existing label (to remove from any type)
  const labelTypes = [
    'compression_systolic_points',
    'compression_diastolic_points',
    'spontaneous_systolic_points',
    'spontaneous_diastolic_points'
  ];

  let foundAndRemoved = false;

  for (const labelType of labelTypes) {
    const labelArray = state.labels[segmentId].label_indexes[labelType];
    const nearbyIndex = labelArray.findIndex(idx => Math.abs(idx - clickedIndex) <= TOLERANCE);

    if (nearbyIndex !== -1) {
      // Remove label from whichever type it belongs to
      labelArray.splice(nearbyIndex, 1);
      console.log('Removed peak from', labelType, 'at index', clickedIndex);
      foundAndRemoved = true;
      break; // Only remove one peak
    }
  }

  // If no nearby label found, add new label to current type
  if (!foundAndRemoved) {
    const labelArray = state.labels[segmentId].label_indexes[state.currentLabelType];
    labelArray.push(clickedIndex);
    labelArray.sort((a, b) => a - b);
    console.log('Added peak to', state.currentLabelType, 'at index', clickedIndex);
  }

  state.labels[segmentId].labeled = true;

  updateDisplay();
  markLabelsDirty();
}

function handleGraphDoubleClick(data) {
  console.log('Graph double-clicked for delete!', data);

  // Prevent default plotly zoom reset on double-click
  if (data) {
    return false;
  }

  // Use the same approach as single click but search all label types
  if (!data || !data.points || data.points.length === 0) {
    return;
  }

  const point = data.points[0];
  const clickedTime = point.x;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const clickedIndex = Math.round(clickedTime * samplingRate);

  console.log('Double-clicked to delete at time:', clickedTime, 'index:', clickedIndex);

  const segmentId = state.currentSegment.toString();

  if (!state.labels[segmentId]) {
    return;
  }

  // Search through ALL label types to find and remove nearby peak
  const labelTypes = [
    'compression_systolic_points',
    'compression_diastolic_points',
    'spontaneous_systolic_points',
    'spontaneous_diastolic_points'
  ];

  let foundAndRemoved = false;

  for (const labelType of labelTypes) {
    const labelArray = state.labels[segmentId].label_indexes[labelType];
    const nearbyIndex = labelArray.findIndex(idx => Math.abs(idx - clickedIndex) <= TOLERANCE);

    if (nearbyIndex !== -1) {
      // Remove the label
      labelArray.splice(nearbyIndex, 1);
      console.log('Removed peak from', labelType, 'at index', clickedIndex);
      foundAndRemoved = true;
      break; // Only remove one peak (the first found)
    }
  }

  if (foundAndRemoved) {
    state.labels[segmentId].labeled = true;
    updateDisplay();
    markLabelsDirty();
  }

  // Prevent default double-click zoom
  return false;
}

async function findPeaks(targetLabelType) {
  console.log('Finding peaks for:', targetLabelType);

  if (!state.fileData || !state.signalNames.length) {
    alert('Please load a file first');
    return;
  }

  // Find the arterial line signal (ABP or Art)
  const artSignal = state.signalNames.find(name =>
    name.toUpperCase().includes('ABP') || name.toLowerCase() === 'abp'
  );

  if (!artSignal) {
    alert('No arterial line (ABP) signal found. Peak finding requires an arterial line signal.');
    return;
  }

  // Get current segment data
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const startIdx = state.currentSegment * segmentLength;
  const endIdx = Math.min(startIdx + segmentLength, state.fileData.data.length);
  const segmentData = state.fileData.data.slice(startIdx, endIdx);

  // Extract arterial line values
  const signalIndex = state.columnOrder.indexOf(artSignal);
  const signalValues = segmentData.map(row => row[signalIndex]);

  console.log('Using signal:', artSignal, 'with', signalValues.length, 'samples');

  try {
    // Call Python backend for peak detection
    const result = await window.electronAPI.findPeaks(signalValues, state.currentSegment);

    if (!result.success) {
      console.error('Peak finding failed:', result.error);
      alert('Peak finding failed: ' + result.error);
      return;
    }

    console.log('Peaks found:', result.peaks);

    // Apply peaks as labels based on current label type
    const segmentId = state.currentSegment.toString();

    // Initialize segment labels if needed
    if (!state.labels[segmentId]) {
      state.labels[segmentId] = {
        labeled: false,
        label_indexes: {
          compression_systolic_points: [],
          compression_diastolic_points: [],
          spontaneous_systolic_points: [],
          spontaneous_diastolic_points: []
        }
      };
    }

    // Apply peaks based on target label type
    if (targetLabelType === 'compression_systolic') {
      state.labels[segmentId].label_indexes['compression_systolic_points'] = result.peaks.systolic || [];
      console.log('Applied', result.peaks.systolic?.length || 0, 'compression systolic peaks');
    } else if (targetLabelType === 'spontaneous_systolic') {
      state.labels[segmentId].label_indexes['spontaneous_systolic_points'] = result.peaks.systolic || [];
      console.log('Applied', result.peaks.systolic?.length || 0, 'spontaneous systolic peaks');
    } else if (targetLabelType === 'spontaneous_diastolic') {
      state.labels[segmentId].label_indexes['spontaneous_diastolic_points'] = result.peaks.diastolic || [];
      console.log('Applied', result.peaks.diastolic?.length || 0, 'spontaneous diastolic peaks');
    }

    state.labels[segmentId].labeled = true;

    // Update display
    updateDisplay();
    markLabelsDirty();

    // Show success message
    let message;
    if (targetLabelType.includes('systolic')) {
      message = `Found ${result.peaks.systolic?.length || 0} systolic peaks`;
    } else {
      message = `Found ${result.peaks.diastolic?.length || 0} diastolic peaks`;
    }
    alert(message);

  } catch (error) {
    console.error('Exception in peak finding:', error);
    alert('Exception in peak finding: ' + error.message);
  }
}

async function findOnsetCompression() {
  console.log('Finding onset compression points');

  if (!state.fileData || !state.signalNames.length) {
    alert('Please load a file first');
    return;
  }

  // Check if we have compression systolic points to use as reference
  const segmentId = state.currentSegment.toString();
  const segmentLabels = state.labels[segmentId];

  if (!segmentLabels || !segmentLabels.label_indexes.compression_systolic_points ||
      segmentLabels.label_indexes.compression_systolic_points.length === 0) {
    alert('Please find Compression Systolic points first. Onset detection requires systolic peaks as reference.');
    return;
  }

  const systolicPeaks = segmentLabels.label_indexes.compression_systolic_points;

  // Find the arterial line signal (ABP)
  const artSignal = state.signalNames.find(name =>
    name.toUpperCase() === 'ABP' || name.toUpperCase().includes('ABP')
  );

  if (!artSignal) {
    alert('No arterial line (ABP) signal found.');
    return;
  }

  // Get window and offset values from inputs
  const windowInput = document.getElementById('onset-window');
  const windowSize = parseInt(windowInput.value) || 30;
  const offsetInput = document.getElementById('onset-offset');
  const offset = parseInt(offsetInput.value) || 10;

  // Get current segment data
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const startIdx = state.currentSegment * segmentLength;
  const endIdx = Math.min(startIdx + segmentLength, state.fileData.data.length);
  const segmentData = state.fileData.data.slice(startIdx, endIdx);

  // Extract arterial line values
  const signalIndex = state.columnOrder.indexOf(artSignal);
  const signalValues = segmentData.map(row => row[signalIndex]);

  console.log('Finding onset compression with window:', windowSize, 'offset:', offset, 'using', systolicPeaks.length, 'systolic peaks');

  try {
    // Call Python backend for onset compression detection
    const result = await window.electronAPI.findOnsetCompression(signalValues, systolicPeaks, windowSize, offset);

    if (!result.success) {
      console.error('Onset compression finding failed:', result.error);
      alert('Onset compression finding failed: ' + result.error);
      return;
    }

    console.log('Onset points found:', result.onsets);

    // Apply onsets as compression diastolic points
    state.labels[segmentId].label_indexes['compression_diastolic_points'] = result.onsets || [];
    state.labels[segmentId].labeled = true;

    // Update display
    updateDisplay();
    markLabelsDirty();

    alert(`Found ${result.onsets?.length || 0} onset compression points`);

  } catch (error) {
    console.error('Exception in onset compression finding:', error);
    alert('Exception in onset compression finding: ' + error.message);
  }
}

function updateUpslopeThresholdLabel() {
  const method = document.getElementById('upslope-method').value;
  const label = document.getElementById('upslope-threshold-label');
  const input = document.getElementById('upslope-threshold');

  if (method === 'percentile') {
    label.textContent = 'Percentile (0-100):';
    input.value = '75';
  } else if (method === 'std') {
    label.textContent = 'Std Multiplier (N):';
    input.value = '1.5';
  } else {
    label.textContent = 'Fixed Value:';
    input.value = '0.5';
  }
}

async function findUpslope() {
  console.log('Finding upslope points');

  if (!state.fileData || !state.signalNames.length) {
    alert('Please load a file first');
    return;
  }

  // Get parameters from UI
  const thresholdMethod = document.getElementById('upslope-method').value;
  const thresholdValue = parseFloat(document.getElementById('upslope-threshold').value);
  const minDistance = parseInt(document.getElementById('upslope-min-distance').value) || 0;
  const maxDistance = parseInt(document.getElementById('upslope-max-distance').value) || 0;
  const labelType = document.getElementById('upslope-label-type').value;

  // Determine which systolic peaks to use based on label type
  const segmentId = state.currentSegment.toString();
  let systolicPeaks = [];
  const useCompression = labelType === 'compression_diastolic_points';
  const systolicType = useCompression ? 'compression_systolic_points' : 'spontaneous_systolic_points';

  // Get systolic peaks for filtering (if distance filtering is enabled)
  if (minDistance > 0 || maxDistance > 0) {
    const segmentLabels = state.labels[segmentId];
    if (segmentLabels && segmentLabels.label_indexes[systolicType]) {
      systolicPeaks = segmentLabels.label_indexes[systolicType];
    }
    if (systolicPeaks.length === 0) {
      const peakTypeName = useCompression ? 'compression' : 'spontaneous';
      alert(`No ${peakTypeName} systolic points found. Please find ${peakTypeName} systolic peaks first, or set both Min and Max Distance to 0 to disable filtering.`);
      return;
    }
  }

  // Find the ABP signal
  const artSignal = state.signalNames.find(name =>
    name.toUpperCase() === 'ABP' || name.toUpperCase().includes('ABP')
  );

  if (!artSignal) {
    alert('No arterial line (ABP) signal found.');
    return;
  }

  // Get current segment data
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const startIdx = state.currentSegment * segmentLength;
  const endIdx = Math.min(startIdx + segmentLength, state.fileData.data.length);
  const segmentData = state.fileData.data.slice(startIdx, endIdx);

  // Extract ABP values
  const signalIndex = state.columnOrder.indexOf(artSignal);
  const signalValues = segmentData.map(row => row[signalIndex]);

  console.log('Finding upslope with method:', thresholdMethod, 'value:', thresholdValue, 'minDistance:', minDistance, 'maxDistance:', maxDistance);

  try {
    const result = await window.electronAPI.findUpslope(
      signalValues,
      systolicPeaks,
      thresholdMethod,
      thresholdValue,
      minDistance,
      maxDistance
    );

    if (!result.success) {
      console.error('Upslope finding failed:', result.error);
      alert('Upslope finding failed: ' + result.error);
      return;
    }

    console.log('Upslope points found:', result.upslopes);

    // Initialize segment labels if needed
    if (!state.labels[segmentId]) {
      state.labels[segmentId] = {
        labeled: false,
        label_indexes: {
          compression_systolic_points: [],
          compression_diastolic_points: [],
          spontaneous_systolic_points: [],
          spontaneous_diastolic_points: []
        }
      };
    }

    // Apply upslopes as selected label type
    state.labels[segmentId].label_indexes[labelType] = result.upslopes || [];
    state.labels[segmentId].labeled = true;

    // Update display
    updateDisplay();
    markLabelsDirty();

    alert(`Found ${result.upslopes?.length || 0} upslope points`);

  } catch (error) {
    console.error('Exception in upslope finding:', error);
    alert('Exception in upslope finding: ' + error.message);
  }
}

function eraseUpslopeLabels() {
  const segmentId = state.currentSegment.toString();
  const labelType = document.getElementById('upslope-label-type').value;

  if (!state.labels[segmentId]) {
    alert('No labels to erase for this segment');
    return;
  }

  const currentCount = state.labels[segmentId].label_indexes[labelType]?.length || 0;

  if (currentCount === 0) {
    alert(`No ${labelType.replace(/_/g, ' ')} labels to erase`);
    return;
  }

  // Clear the selected label type
  state.labels[segmentId].label_indexes[labelType] = [];

  // Update display
  updateDisplay();
  markLabelsDirty();

  alert(`Erased ${currentCount} ${labelType.replace(/_/g, ' ')} labels`);
}

function eraseCurrentTypeLabels() {
  const segmentId = state.currentSegment.toString();

  if (!state.labels[segmentId]) {
    return; // No labels for this segment
  }

  const currentType = state.currentLabelType;
  const labelCount = state.labels[segmentId].label_indexes[currentType]?.length || 0;

  if (labelCount === 0) {
    alert('No labels of this type to erase in current segment');
    return;
  }

  // Confirm before erasing
  const typeName = currentType.replace(/_/g, ' ').replace(/points?/g, '').trim();
  const confirmed = confirm(`Erase all ${labelCount} ${typeName} labels in this segment?`);

  if (confirmed) {
    // Clear the labels for the current type
    state.labels[segmentId].label_indexes[currentType] = [];

    // Update the graph to reflect the changes
    updateGraph();
    updateLabelCounts();
    markLabelsDirty();
  }
}

async function saveLabels(showStatus = true) {
  if (!state.currentFile) return { success: false, error: 'No file loaded' };

  // Get the labels directory from settings
  const labelsDir = document.getElementById('settings-labels-dir').value || 'labels';

  const result = await window.electronAPI.saveLabels(
    state.currentFile,
    state.labelerName,
    state.labels,
    labelsDir,
    state.appVersion
  );

  if (result.success) {
    state.labelsDirty = false;
    if (showStatus) {
      const statusEl = document.getElementById('save-status');
      statusEl.textContent = 'Labels saved successfully!';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 3000);
    }
  } else {
    if (showStatus) {
      alert('Failed to save labels: ' + result.error);
    }
  }

  return result;
}

// Mark labels as modified and trigger debounced auto-save
function markLabelsDirty() {
  state.labelsDirty = true;
  scheduleAutoSave();
}

// Schedule an auto-save after 2 seconds of inactivity
function scheduleAutoSave() {
  // Clear any existing timeout
  if (state.autoSaveTimeout) {
    clearTimeout(state.autoSaveTimeout);
  }

  // Schedule new auto-save (2 second debounce, no status indicator)
  state.autoSaveTimeout = setTimeout(async () => {
    if (state.labelsDirty && state.currentFile) {
      await saveLabels(false);  // Silent save
    }
  }, 2000);
}

// Immediately save if there are unsaved changes (for segment/file changes)
async function saveIfDirty() {
  if (state.labelsDirty && state.currentFile) {
    // Clear any pending auto-save
    if (state.autoSaveTimeout) {
      clearTimeout(state.autoSaveTimeout);
      state.autoSaveTimeout = null;
    }
    await saveLabels(false);  // Silent save
  }
}

function toggleRegionMode() {
  state.regionSelectionMode = !state.regionSelectionMode;
  const btn = document.getElementById('toggle-region-btn');

  if (state.regionSelectionMode) {
    btn.textContent = 'Done Selecting Regions';
    btn.style.backgroundColor = '#ff6b6b';
    state.regionStart = null;
    state.regionEnd = null;
    document.getElementById('region-info').textContent = 'Click twice to select each region';
  } else {
    btn.textContent = 'Select Region on ABP';
    btn.style.backgroundColor = '';
    state.regionStart = null;
    state.regionEnd = null;

    // Show summary of regions when exiting
    const segmentId = state.currentSegment.toString();
    const segmentLabels = state.labels[segmentId];
    const numRegions = segmentLabels?.highlighted_regions?.length || 0;
    document.getElementById('region-info').textContent =
      numRegions > 0 ? `${numRegions} region(s) selected` : '';

    updateGraph();  // Redraw
  }
}

function handleRegionSelection(clickData) {
  if (!state.regionSelectionMode) return;

  // Get the clicked index
  const clickedTime = clickData.points[0].x;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const clickedIndex = Math.round(clickedTime * samplingRate);

  if (state.regionStart === null) {
    // First click - set start
    state.regionStart = clickedIndex;
    document.getElementById('region-info').textContent =
      `Region start: ${clickedIndex}. Click again to set end.`;
  } else {
    // Second click - set end
    state.regionEnd = clickedIndex;

    // Ensure start < end
    if (state.regionStart > state.regionEnd) {
      [state.regionStart, state.regionEnd] = [state.regionEnd, state.regionStart];
    }

    // Save region to labels
    const segmentId = state.currentSegment.toString();
    if (!state.labels[segmentId]) {
      state.labels[segmentId] = {
        labeled: true,
        label_indexes: {
          compression_systolic_points: [],
          compression_diastolic_points: [],
          spontaneous_systolic_points: [],
          spontaneous_diastolic_points: []
        }
      };
    }

    // Initialize highlighted_regions array if it doesn't exist
    if (!state.labels[segmentId].highlighted_regions) {
      state.labels[segmentId].highlighted_regions = [];
    }

    // Add new region to array
    state.labels[segmentId].highlighted_regions.push({
      start: state.regionStart,
      end: state.regionEnd
    });

    // Update info text to show number of regions
    const numRegions = state.labels[segmentId].highlighted_regions.length;
    document.getElementById('region-info').textContent =
      `Region ${numRegions} added: ${state.regionStart} - ${state.regionEnd}. Total: ${numRegions} region(s)`;

    // Reset for next region but stay in selection mode
    state.regionStart = null;
    state.regionEnd = null;

    // Redraw with region highlight
    updateGraph();
    markLabelsDirty();
  }
}

function clearRegions() {
  const segmentId = state.currentSegment.toString();
  if (state.labels[segmentId] && state.labels[segmentId].highlighted_regions) {
    state.labels[segmentId].highlighted_regions = [];
    document.getElementById('region-info').textContent = 'All regions cleared';
    updateGraph();
    markLabelsDirty();
  }
}

function handleKeyboard(e) {
  // Don't handle shortcuts if user is typing in an input field
  const activeElement = document.activeElement;
  if (activeElement && (
    activeElement.tagName === 'INPUT' ||
    activeElement.tagName === 'SELECT' ||
    activeElement.tagName === 'TEXTAREA'
  )) {
    return;
  }

  console.log('Key pressed:', e.key);

  switch (e.key.toLowerCase()) {
    case 'tab':
      console.log('Cycle to next tab');
      cycleTab();
      e.preventDefault();
      break;
    case 'a':
      console.log('Navigate to previous segment');
      navigateSegment(-1);
      e.preventDefault();
      break;
    case 'd':
      console.log('Navigate to next segment');
      navigateSegment(1);
      e.preventDefault();
      break;
    case 'w':
      console.log('Cycle label type backward');
      cycleLabelType(-1);
      e.preventDefault();
      break;
    case 's':
      console.log('Cycle label type forward');
      cycleLabelType(1);
      e.preventDefault();
      break;
  }
}

function cycleLabelType(direction) {
  const labelTypes = [
    'compression_systolic_points',
    'compression_diastolic_points',
    'spontaneous_systolic_points',
    'spontaneous_diastolic_points'
  ];

  const currentIndex = labelTypes.indexOf(state.currentLabelType);
  let newIndex = currentIndex + direction;

  if (newIndex < 0) newIndex = labelTypes.length - 1;
  if (newIndex >= labelTypes.length) newIndex = 0;

  selectLabelType(labelTypes[newIndex]);
}

// Settings functions
async function saveSettings() {
  const sidebarPosition = document.getElementById('settings-sidebar-position').value;

  const config = {
    labeler_name: document.getElementById('settings-labeler-name').value,
    labels_directory: document.getElementById('settings-labels-dir').value,
    data_folder: document.getElementById('settings-data-folder').value,
    sidebar_position: sidebarPosition,
    version: '1.0'
  };

  const success = await saveConfig(config);

  const statusEl = document.getElementById('settings-status');
  if (success) {
    statusEl.textContent = 'Settings saved successfully!';
    statusEl.style.color = '#38a169';

    // Update state
    state.labelerName = config.labeler_name;

    // Apply sidebar position immediately
    applySidebarPosition(sidebarPosition);

    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  } else {
    statusEl.textContent = 'Failed to save settings';
    statusEl.style.color = '#e53e3e';
  }
}

async function resetSettings() {
  const defaultConfig = {
    labeler_name: 'labeler1',
    labels_directory: 'labels',
    data_folder: '.',
    sidebar_position: 'left',
    version: '1.0'
  };

  await saveConfig(defaultConfig);

  // Update UI
  document.getElementById('settings-labeler-name').value = defaultConfig.labeler_name;
  document.getElementById('settings-labels-dir').value = defaultConfig.labels_directory;
  document.getElementById('settings-data-folder').value = defaultConfig.data_folder;
  document.getElementById('settings-sidebar-position').value = defaultConfig.sidebar_position;

  // Apply sidebar position
  applySidebarPosition(defaultConfig.sidebar_position);

  const statusEl = document.getElementById('settings-status');
  statusEl.textContent = 'Settings reset to defaults';
  statusEl.style.color = '#38a169';
}

function applySidebarPosition(position) {
  const appContainer = document.querySelector('.app-container');
  if (position === 'right') {
    appContainer.classList.add('sidebar-right');
  } else {
    appContainer.classList.remove('sidebar-right');
  }

  // Resize Plotly graph to fit new layout
  const graphDiv = document.getElementById('main-graph');
  if (graphDiv && window.Plotly) {
    setTimeout(() => {
      Plotly.Plots.resize(graphDiv);
    }, 100);
  }
}

async function browseLabelsDir() {
  const result = await window.electronAPI.selectFolder();
  if (result.success && result.path) {
    document.getElementById('settings-labels-dir').value = result.path;
  }
}

async function browseDataFolder() {
  const result = await window.electronAPI.selectFolder();
  if (result.success && result.path) {
    document.getElementById('settings-data-folder').value = result.path;
    state.folderPath = result.path;
  }
}

// ============================================================================
// Resizable Bottom Panel
// ============================================================================

function initializeResizablePanel() {
  const divider = document.getElementById('resize-divider');
  const bottomPanel = document.getElementById('bottom-panel');
  const mainContent = document.querySelector('.main-content');

  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  divider.addEventListener('mousedown', (e) => {
    isResizing = true;
    startY = e.clientY;
    startHeight = bottomPanel.offsetHeight;

    // Prevent text selection during drag
    e.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ns-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaY = startY - e.clientY; // Inverted because moving up increases height
    const newHeight = Math.max(50, Math.min(400, startHeight + deltaY));

    bottomPanel.style.height = `${newHeight}px`;

    // Force Plotly to resize
    const graphDiv = document.getElementById('main-graph');
    if (graphDiv && window.Plotly) {
      window.Plotly.Plots.resize(graphDiv);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  });
}

// Initialize resize functionality when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeResizablePanel);
} else {
  initializeResizablePanel();
}

// ============================================================================
// Sidebar Resize Functionality
// ============================================================================

function initializeResizableSidebar() {
  const sidebar = document.getElementById('sidebar');
  const handle = document.getElementById('sidebar-resize-handle');

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;

    handle.classList.add('dragging');
    e.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;

    const deltaX = e.clientX - startX;
    // When sidebar is on right, dragging left (negative deltaX) should increase width
    const isRightSidebar = document.querySelector('.app-container').classList.contains('sidebar-right');
    const adjustedDelta = isRightSidebar ? -deltaX : deltaX;
    const newWidth = Math.max(180, Math.min(400, startWidth + adjustedDelta));

    sidebar.style.width = `${newWidth}px`;

    // Force Plotly to resize
    const graphDiv = document.getElementById('main-graph');
    if (graphDiv && window.Plotly) {
      window.Plotly.Plots.resize(graphDiv);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  });
}

// Initialize sidebar resize functionality when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeResizableSidebar);
} else {
  initializeResizableSidebar();
}

// ============================================================================
// X-Axis Range Slider
// ============================================================================

const rangeSliderState = {
  isDraggingView: false,
  isDraggingLeftEdge: false,
  isDraggingRightEdge: false,
  dragStartX: 0,
  dragStartViewStart: 0,
  dragStartViewEnd: 0,
  maxTime: 10  // Total duration of current segment in seconds
};

function initializeRangeSlider() {
  const svg = document.getElementById('timeline-svg');
  if (!svg) return;

  // Create SVG elements
  svg.innerHTML = `
    <defs>
      <linearGradient id="viewGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#667eea;stop-opacity:0.2" />
        <stop offset="100%" style="stop-color:#764ba2;stop-opacity:0.2" />
      </linearGradient>
    </defs>
    <rect id="slider-track" fill="#e2e8f0" rx="4"/>
    <rect id="view-area" fill="url(#viewGradient)" stroke="#667eea" stroke-width="2" rx="4" style="cursor: move;"/>
    <rect id="left-handle" fill="#667eea" stroke="#4c51bf" stroke-width="1" rx="3" style="cursor: ew-resize;"/>
    <rect id="right-handle" fill="#667eea" stroke="#4c51bf" stroke-width="1" rx="3" style="cursor: ew-resize;"/>
  `;

  updateRangeSliderDisplay();
  attachRangeSliderHandlers();
}

function updateRangeSliderDisplay() {
  if (!state.fileData) return;

  const svg = document.getElementById('timeline-svg');
  if (!svg) return;

  const rect = svg.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;
  const padding = 10;
  const trackY = height / 2 - 15;
  const trackHeight = 30;

  // Update max time based on current segment
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  rangeSliderState.maxTime = segmentLength / samplingRate;

  // Draw background track
  const track = svg.getElementById('slider-track');
  track.setAttribute('x', padding);
  track.setAttribute('y', trackY);
  track.setAttribute('width', width - 2 * padding);
  track.setAttribute('height', trackHeight);

  // Calculate positions for view area
  const viewStartX = padding + (state.viewRangeStart / rangeSliderState.maxTime) * (width - 2 * padding);
  const viewEndX = padding + (state.viewRangeEnd / rangeSliderState.maxTime) * (width - 2 * padding);

  // Update view area
  const viewArea = svg.getElementById('view-area');
  viewArea.setAttribute('x', viewStartX);
  viewArea.setAttribute('y', trackY);
  viewArea.setAttribute('width', viewEndX - viewStartX);
  viewArea.setAttribute('height', trackHeight);

  // Update handles
  const handleWidth = 12;
  const handleHeight = trackHeight;

  const leftHandle = svg.getElementById('left-handle');
  leftHandle.setAttribute('x', viewStartX - handleWidth / 2);
  leftHandle.setAttribute('y', trackY);
  leftHandle.setAttribute('width', handleWidth);
  leftHandle.setAttribute('height', handleHeight);

  const rightHandle = svg.getElementById('right-handle');
  rightHandle.setAttribute('x', viewEndX - handleWidth / 2);
  rightHandle.setAttribute('y', trackY);
  rightHandle.setAttribute('width', handleWidth);
  rightHandle.setAttribute('height', handleHeight);

  // Update info text
  document.getElementById('timeline-current').textContent =
    `View: ${state.viewRangeStart.toFixed(2)}s - ${state.viewRangeEnd.toFixed(2)}s`;
  document.getElementById('timeline-total').textContent =
    `Total: ${rangeSliderState.maxTime.toFixed(2)}s (Segment ${state.currentSegment + 1}/${state.segments.length})`;
}

function attachRangeSliderHandlers() {
  const svg = document.getElementById('timeline-svg');
  const viewArea = svg.getElementById('view-area');
  const leftHandle = svg.getElementById('left-handle');
  const rightHandle = svg.getElementById('right-handle');

  // View area drag (move entire view)
  viewArea.addEventListener('mousedown', (e) => {
    rangeSliderState.isDraggingView = true;
    rangeSliderState.dragStartX = e.clientX;
    rangeSliderState.dragStartViewStart = state.viewRangeStart;
    rangeSliderState.dragStartViewEnd = state.viewRangeEnd;
    e.stopPropagation();
    e.preventDefault();
  });

  // Left handle drag (resize from left)
  leftHandle.addEventListener('mousedown', (e) => {
    rangeSliderState.isDraggingLeftEdge = true;
    rangeSliderState.dragStartX = e.clientX;
    rangeSliderState.dragStartViewStart = state.viewRangeStart;
    e.stopPropagation();
    e.preventDefault();
  });

  // Right handle drag (resize from right)
  rightHandle.addEventListener('mousedown', (e) => {
    rangeSliderState.isDraggingRightEdge = true;
    rangeSliderState.dragStartX = e.clientX;
    rangeSliderState.dragStartViewEnd = state.viewRangeEnd;
    e.stopPropagation();
    e.preventDefault();
  });

  // Mouse move handler
  document.addEventListener('mousemove', (e) => {
    if (!rangeSliderState.isDraggingView && !rangeSliderState.isDraggingLeftEdge && !rangeSliderState.isDraggingRightEdge) return;

    const rect = svg.getBoundingClientRect();
    const deltaX = e.clientX - rangeSliderState.dragStartX;
    const padding = 10;
    const availableWidth = rect.width - 2 * padding;
    const deltaTime = (deltaX / availableWidth) * rangeSliderState.maxTime;

    if (rangeSliderState.isDraggingView) {
      // Move entire view
      const viewSize = rangeSliderState.dragStartViewEnd - rangeSliderState.dragStartViewStart;
      let newStart = rangeSliderState.dragStartViewStart + deltaTime;
      let newEnd = rangeSliderState.dragStartViewEnd + deltaTime;

      // Clamp to bounds
      if (newStart < 0) {
        newStart = 0;
        newEnd = viewSize;
      }
      if (newEnd > rangeSliderState.maxTime) {
        newEnd = rangeSliderState.maxTime;
        newStart = rangeSliderState.maxTime - viewSize;
      }

      state.viewRangeStart = Math.max(0, newStart);
      state.viewRangeEnd = Math.min(rangeSliderState.maxTime, newEnd);
    } else if (rangeSliderState.isDraggingLeftEdge) {
      // Resize from left
      let newStart = rangeSliderState.dragStartViewStart + deltaTime;
      // Minimum view size of 0.5 seconds
      newStart = Math.max(0, Math.min(newStart, state.viewRangeEnd - 0.5));
      state.viewRangeStart = newStart;
    } else if (rangeSliderState.isDraggingRightEdge) {
      // Resize from right
      let newEnd = rangeSliderState.dragStartViewEnd + deltaTime;
      // Minimum view size of 0.5 seconds
      newEnd = Math.max(state.viewRangeStart + 0.5, Math.min(newEnd, rangeSliderState.maxTime));
      state.viewRangeEnd = newEnd;
    }

    updateRangeSliderDisplay();
    updateGraph();  // Update main graph with new x-axis range
  });

  // Mouse up handler
  document.addEventListener('mouseup', () => {
    rangeSliderState.isDraggingView = false;
    rangeSliderState.isDraggingLeftEdge = false;
    rangeSliderState.isDraggingRightEdge = false;
  });
}

// Helper to reset view range (called only when changing segments)
function resetViewRange() {
  const segmentLength = state.metadata ? state.metadata.chunk_size : 2000;
  const samplingRate = state.metadata ? state.metadata.sampling_rate : 250;
  const maxTime = segmentLength / samplingRate;
  state.viewRangeStart = 0;
  state.viewRangeEnd = maxTime;
}

// Wrap updateDisplay to also update range slider
const originalUpdateDisplay = updateDisplay;
updateDisplay = function() {
  originalUpdateDisplay();
  updateRangeSliderDisplay();
};

// Initialize range slider when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeRangeSlider);
} else {
  initializeRangeSlider();
}
