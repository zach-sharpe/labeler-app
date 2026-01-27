/**
 * Security utilities for input validation and path sanitization
 */

const path = require('path');
const fs = require('fs');

// Allowed Python backend methods (whitelist)
const ALLOWED_PYTHON_METHODS = new Set([
  'get_csv_files',
  'load_patient_file',
  'load_labels',
  'save_labels',
  'load_done_files',
  'toggle_done_file',
  'load_review_files',
  'load_in_progress_files',
  'find_peaks',
  'get_segment',
  'calculate_derivative',
  'find_onset_compression',
  'find_upslope'
]);

/**
 * Validates that a path doesn't contain path traversal attempts
 * and resolves to a real, accessible path
 * @param {string} inputPath - The path to validate
 * @param {string} [basePath] - Optional base path that the input must be within
 * @returns {{valid: boolean, sanitized: string|null, error: string|null}}
 */
function validatePath(inputPath, basePath = null) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { valid: false, sanitized: null, error: 'Path must be a non-empty string' };
  }

  // Check for null bytes (common attack vector)
  if (inputPath.includes('\0')) {
    return { valid: false, sanitized: null, error: 'Path contains invalid characters' };
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(inputPath);

  // If a base path is provided, ensure the resolved path is within it
  if (basePath) {
    const resolvedBase = path.resolve(basePath);
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
      return { valid: false, sanitized: null, error: 'Path traversal detected' };
    }
  }

  return { valid: true, sanitized: resolvedPath, error: null };
}

/**
 * Validates a filename (no directory components allowed)
 * @param {string} filename - The filename to validate
 * @returns {{valid: boolean, sanitized: string|null, error: string|null}}
 */
function validateFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return { valid: false, sanitized: null, error: 'Filename must be a non-empty string' };
  }

  // Check for null bytes
  if (filename.includes('\0')) {
    return { valid: false, sanitized: null, error: 'Filename contains invalid characters' };
  }

  // Check for path separators (no directory traversal in filename)
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    return { valid: false, sanitized: null, error: 'Filename cannot contain path separators' };
  }

  // Check for valid file extensions
  const validExtensions = ['.h5', '.hdf5', '.csv', '.json'];
  const ext = path.extname(filename).toLowerCase();
  if (!validExtensions.includes(ext)) {
    return { valid: false, sanitized: null, error: 'Invalid file extension' };
  }

  return { valid: true, sanitized: filename, error: null };
}

/**
 * Validates a labeler name (alphanumeric, underscores, hyphens only)
 * @param {string} labelerName - The labeler name to validate
 * @returns {{valid: boolean, sanitized: string|null, error: string|null}}
 */
function validateLabelerName(labelerName) {
  if (!labelerName || typeof labelerName !== 'string') {
    return { valid: false, sanitized: null, error: 'Labeler name must be a non-empty string' };
  }

  // Only allow alphanumeric, underscores, and hyphens
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(labelerName)) {
    return { valid: false, sanitized: null, error: 'Labeler name can only contain letters, numbers, underscores, and hyphens' };
  }

  // Limit length
  if (labelerName.length > 64) {
    return { valid: false, sanitized: null, error: 'Labeler name too long (max 64 characters)' };
  }

  return { valid: true, sanitized: labelerName, error: null };
}

/**
 * Validates a Python method name against the whitelist
 * @param {string} method - The method name to validate
 * @returns {boolean}
 */
function isAllowedPythonMethod(method) {
  return ALLOWED_PYTHON_METHODS.has(method);
}

/**
 * Validates configuration object structure
 * @param {object} config - The configuration object to validate
 * @returns {{valid: boolean, sanitized: object|null, error: string|null}}
 */
function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, sanitized: null, error: 'Config must be an object' };
  }

  const sanitized = {};

  // Validate labeler_name
  if (config.labeler_name) {
    const labelerResult = validateLabelerName(config.labeler_name);
    if (!labelerResult.valid) {
      return { valid: false, sanitized: null, error: `Invalid labeler_name: ${labelerResult.error}` };
    }
    sanitized.labeler_name = labelerResult.sanitized;
  } else {
    sanitized.labeler_name = 'labeler1'; // default
  }

  // Validate labels_directory (path validation)
  if (config.labels_directory) {
    const pathResult = validatePath(config.labels_directory);
    if (!pathResult.valid) {
      return { valid: false, sanitized: null, error: `Invalid labels_directory: ${pathResult.error}` };
    }
    sanitized.labels_directory = config.labels_directory; // Keep original (may be relative)
  } else {
    sanitized.labels_directory = 'labels'; // default
  }

  // Validate data_folder (path validation)
  if (config.data_folder) {
    const pathResult = validatePath(config.data_folder);
    if (!pathResult.valid) {
      return { valid: false, sanitized: null, error: `Invalid data_folder: ${pathResult.error}` };
    }
    sanitized.data_folder = config.data_folder; // Keep original (may be relative)
  } else {
    sanitized.data_folder = '.'; // default
  }

  // Version string (simple validation)
  sanitized.version = typeof config.version === 'string' ? config.version.slice(0, 10) : '1.0';

  return { valid: true, sanitized, error: null };
}

/**
 * Validates a label_indexes object structure
 * @param {object} labelIndexes - The label_indexes object to validate
 * @returns {{valid: boolean, error: string|null}}
 */
function validateLabelIndexes(labelIndexes) {
  const validKeys = [
    'compression_systolic_points',
    'compression_diastolic_points',
    'spontaneous_systolic_points',
    'spontaneous_diastolic_points'
  ];

  for (const [key, value] of Object.entries(labelIndexes)) {
    if (!validKeys.includes(key)) {
      return { valid: false, error: `Invalid label type: ${key}` };
    }
    if (!Array.isArray(value)) {
      return { valid: false, error: `Label indexes for ${key} must be an array` };
    }
    for (const idx of value) {
      if (typeof idx !== 'number' || idx < 0 || !Number.isInteger(idx)) {
        return { valid: false, error: `Invalid index in ${key}: ${idx}` };
      }
    }
  }
  return { valid: true, error: null };
}

/**
 * Validates labels object structure
 * @param {object} labels - The labels object to validate
 * @returns {{valid: boolean, error: string|null}}
 */
function validateLabels(labels) {
  if (!labels || typeof labels !== 'object') {
    return { valid: false, error: 'Labels must be an object' };
  }

  // Check each segment
  for (const [segmentId, segmentData] of Object.entries(labels)) {
    // Skip _metadata key - it's used for audit information
    if (segmentId === '_metadata') {
      continue;
    }

    // Segment ID should be a numeric string
    if (!/^\d+$/.test(segmentId)) {
      return { valid: false, error: `Invalid segment ID: ${segmentId}` };
    }

    if (typeof segmentData !== 'object') {
      return { valid: false, error: `Segment ${segmentId} data must be an object` };
    }

    // Validate label_indexes if present (old format, backwards compatibility)
    if (segmentData.label_indexes) {
      const result = validateLabelIndexes(segmentData.label_indexes);
      if (!result.valid) return result;
    }

    // Validate signals structure if present (new format)
    if (segmentData.signals) {
      if (typeof segmentData.signals !== 'object') {
        return { valid: false, error: `Segment ${segmentId} signals must be an object` };
      }
      for (const [signalName, signalData] of Object.entries(segmentData.signals)) {
        if (typeof signalData !== 'object') {
          return { valid: false, error: `Signal ${signalName} data must be an object` };
        }
        if (signalData.label_indexes) {
          const result = validateLabelIndexes(signalData.label_indexes);
          if (!result.valid) return result;
        }
      }
    }
  }

  return { valid: true, error: null };
}

module.exports = {
  validatePath,
  validateFilename,
  validateLabelerName,
  isAllowedPythonMethod,
  validateConfig,
  validateLabels,
  ALLOWED_PYTHON_METHODS
};
