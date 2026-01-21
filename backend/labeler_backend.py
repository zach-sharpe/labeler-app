"""
labeler_backend.py
Python backend for Electron labeler app.
Receives JSON messages via stdin, executes methods, returns results via stdout.
"""

import sys
import json
import os
import h5py
import pandas as pd
import numpy as np
from scipy import signal
from pathlib import Path
from config import load_config

# Load configuration
config = load_config()
LABELS_DIR = config["labels_directory"]

# Constants (not configurable) - now loaded dynamically from HDF5 metadata
# SAMPLING_FREQ = 250  # Hz - now read from metadata
# SEGMENT_LENGTH = 2000  # samples - now read from metadata as chunk_size

def strip_hdf5_extension(filename):
    """Remove .h5 or .hdf5 extension from filename for cleaner label file names."""
    if filename.lower().endswith('.h5'):
        return filename[:-3]
    elif filename.lower().endswith('.hdf5'):
        return filename[:-5]
    return filename

def log_error(message):
    """Log error to stderr and to a file."""
    print(f"ERROR: {message}", file=sys.stderr, flush=True)
    try:
        with open('backend_debug.log', 'a') as f:
            f.write(f"{message}\n")
    except:
        pass

def get_csv_files(params):
    """Get all HDF5 files in the specified folder."""
    folder = params.get('folder', '.')
    log_error(f"get_csv_files called with folder: {folder}")
    log_error(f"Folder exists: {os.path.exists(folder)}")

    if not os.path.exists(folder):
        log_error(f"Folder does not exist, returning empty list")
        return []

    all_files = os.listdir(folder)
    log_error(f"All files in folder: {all_files}")

    files = [f for f in all_files
             if f.endswith('.h5') or f.endswith('.hdf5') or f.endswith('.csv')]
    log_error(f"Filtered files: {files}")
    return sorted(files)

def compute_abp_derivatives(df, sampling_rate):
    """Compute first and second derivatives of ABP signal using Savitzky-Golay filter.

    Args:
        df: DataFrame containing signal data
        sampling_rate: Sampling rate in Hz

    Returns:
        df: DataFrame with added ABP_d1 and ABP_d2 columns (if ABP signal exists)
    """
    # Find ABP signal (case-insensitive)
    abp_col = None
    for col in df.columns:
        if col.upper() == 'ABP' or 'ABP' in col.upper():
            abp_col = col
            break

    if abp_col is None:
        return df

    # Get ABP signal as numpy array
    abp_signal = df[abp_col].values

    # Savitzky-Golay filter parameters
    # Window length: 0.06 * sampling_rate (should be ~15 for 250 Hz)
    window_length = int(0.06 * sampling_rate)
    # Ensure window_length is odd (required by savgol_filter)
    if window_length % 2 == 0:
        window_length += 1
    # Ensure window_length is at least 5 (minimum for polyorder=3)
    window_length = max(window_length, 5)
    polyorder = 3

    try:
        # Compute first derivative (velocity)
        abp_d1 = signal.savgol_filter(abp_signal, window_length, polyorder, deriv=1)

        # Compute second derivative (acceleration)
        abp_d2 = signal.savgol_filter(abp_signal, window_length, polyorder, deriv=2)

        # Add to DataFrame
        df['ABP_d1'] = abp_d1
        df['ABP_d2'] = abp_d2

        log_error(f"Computed ABP derivatives with window_length={window_length}, polyorder={polyorder}")
    except Exception as e:
        log_error(f"Error computing ABP derivatives: {e}")

    return df


def load_patient_file(params):
    """Load patient file (HDF5 or CSV) into a serializable format with metadata.

    Supports both legacy flat format and new chunked format.

    Returns:
        dict with 'columns', 'data', 'metadata', and 'annotations'
    """
    filename = params['filename']
    folder = params.get('folder', '.')
    filepath = os.path.join(folder, filename)

    if filename.endswith('.h5') or filename.endswith('.hdf5'):
        # Load HDF5 file
        with h5py.File(filepath, 'r') as hf:
            # Detect format by checking for metadata group
            is_chunked = 'metadata' in hf

            if is_chunked:
                # New chunked format
                # Read patient_id
                patient_id_raw = hf['metadata/patient_id'][()]
                if isinstance(patient_id_raw, bytes):
                    patient_id = patient_id_raw.decode('utf-8')
                else:
                    patient_id = str(patient_id_raw)

                # Handle skip_size: may be single value or separate CPR/non-CPR values
                if 'metadata/skip_size' in hf:
                    skip_size = int(hf['metadata/skip_size'][()])
                elif 'metadata/skip_size_cpr' in hf:
                    # Use CPR skip size as default (or could average them)
                    skip_size = int(hf['metadata/skip_size_cpr'][()])
                else:
                    # Fallback to chunk_size (no overlap)
                    skip_size = int(hf['metadata/chunk_size'][()])

                metadata = {
                    'patient_id': patient_id,
                    'chunk_size': int(hf['metadata/chunk_size'][()]),
                    'skip_size': skip_size,
                    'sampling_rate': int(hf['metadata/sampling_rate'][()]),
                    'drop_incomplete': bool(hf['metadata/drop_incomplete'][()])
                }

                # Include additional metadata if present
                if 'metadata/skip_size_cpr' in hf:
                    metadata['skip_size_cpr'] = int(hf['metadata/skip_size_cpr'][()])
                if 'metadata/skip_size_non_cpr' in hf:
                    metadata['skip_size_non_cpr'] = int(hf['metadata/skip_size_non_cpr'][()])
                if 'metadata/block_length_seconds' in hf:
                    metadata['block_length_seconds'] = float(hf['metadata/block_length_seconds'][()])
                if 'metadata/target_num_blocks' in hf:
                    metadata['target_num_blocks'] = int(hf['metadata/target_num_blocks'][()])

                # Load chunked signals - flatten to 1D for compatibility
                signal_names = list(hf['signals'].keys())
                data = {}
                for signal_name in signal_names:
                    chunks = hf['signals'][signal_name][:]  # (n_chunks, chunk_size)
                    # Flatten: concatenate all chunks
                    data[signal_name] = chunks.flatten().tolist()

                df = pd.DataFrame(data)

                # Optionally load annotations
                annotations = {}
                if 'annotations' in hf:
                    for ann_type in ['pause_times', 'rosc_times', 'bad_data_times']:
                        if f'annotations/{ann_type}' in hf:
                            annotations[ann_type] = hf[f'annotations/{ann_type}'][:].tolist()

                # Load CPR labels if present (one label per chunk: 0=non-CPR, 1=CPR)
                cpr_labels = None
                if 'labels/cpr_label' in hf:
                    cpr_labels = hf['labels/cpr_label'][:].tolist()

            else:
                # Legacy flat format
                signal_names = list(hf['signals'].keys())
                data = {}
                for signal_name in signal_names:
                    data[signal_name] = hf['signals'][signal_name][:].tolist()

                df = pd.DataFrame(data)

                # Default metadata for legacy files
                metadata = {
                    'patient_id': filename,
                    'chunk_size': 2000,
                    'skip_size': 2000,
                    'sampling_rate': 250,
                    'drop_incomplete': True
                }
                annotations = {}
                cpr_labels = None  # Legacy format doesn't have CPR labels

    else:
        # Load CSV file
        df = pd.read_csv(filepath)

        # Default metadata for CSV files
        metadata = {
            'patient_id': filename,
            'chunk_size': 2000,
            'skip_size': 2000,
            'sampling_rate': 250,
            'drop_incomplete': True
        }
        annotations = {}
        cpr_labels = None  # CSV format doesn't have CPR labels

    # Compute ABP derivatives
    sampling_rate = metadata.get('sampling_rate', 250)
    df = compute_abp_derivatives(df, sampling_rate)

    # Return data in serializable format
    return {
        'columns': df.columns.tolist(),
        'data': df.values.tolist(),
        'metadata': metadata,
        'annotations': annotations,
        'cpr_labels': cpr_labels
    }

def load_labels(params):
    """Load labels for a specific patient file."""
    filename = params['filename']
    labeler_name = params['labeler_name']
    # Use passed labels_directory if provided, otherwise fall back to config
    labels_dir = params.get('labels_directory', LABELS_DIR)
    # Strip .h5/.hdf5 extension for cleaner label file names
    base_filename = strip_hdf5_extension(filename)
    label_file = os.path.join(labels_dir, labeler_name, f"{base_filename}.json")

    if os.path.exists(label_file):
        with open(label_file, 'r') as f:
            return json.load(f)
    return {}

def save_labels(params):
    """Save labels for a specific patient file."""
    filename = params['filename']
    labeler_name = params['labeler_name']
    labels = params['labels']
    # Use passed labels_directory if provided, otherwise fall back to config
    labels_dir = params.get('labels_directory', LABELS_DIR)

    # Create directory if it doesn't exist
    label_dir = os.path.join(labels_dir, labeler_name)
    os.makedirs(label_dir, exist_ok=True)

    # Strip .h5/.hdf5 extension for cleaner label file names
    base_filename = strip_hdf5_extension(filename)
    label_file = os.path.join(label_dir, f"{base_filename}.json")
    with open(label_file, 'w') as f:
        json.dump(labels, f, indent=2)

    return {"success": True}

def load_done_files(params):
    """Load list of files marked as done for a labeler."""
    labeler_name = params['labeler_name']
    # Use passed labels_directory if provided, otherwise fall back to config
    labels_dir = params.get('labels_directory', LABELS_DIR)
    done_file = os.path.join(labels_dir, labeler_name, "done_files.json")

    if os.path.exists(done_file):
        with open(done_file, 'r') as f:
            return json.load(f)
    return []

def toggle_done_file(params):
    """Toggle a file's done status for a labeler."""
    filename = params['filename']
    labeler_name = params['labeler_name']
    # Use passed labels_directory if provided, otherwise fall back to config
    labels_dir = params.get('labels_directory', LABELS_DIR)

    # Create directory if it doesn't exist
    label_dir = os.path.join(labels_dir, labeler_name)
    os.makedirs(label_dir, exist_ok=True)

    done_file = os.path.join(label_dir, "done_files.json")

    # Load existing done files
    done_files = []
    if os.path.exists(done_file):
        with open(done_file, 'r') as f:
            done_files = json.load(f)

    # Toggle the file
    if filename in done_files:
        done_files.remove(filename)
        is_done = False
    else:
        done_files.append(filename)
        is_done = True

    # Save updated list
    with open(done_file, 'w') as f:
        json.dump(done_files, f, indent=2)

    return {"success": True, "is_done": is_done, "done_files": done_files}

def load_review_files(params):
    """Load list of files that have any segment marked for review for a labeler."""
    labeler_name = params['labeler_name']
    # Use passed labels_directory if provided, otherwise fall back to config
    labels_dir = params.get('labels_directory', LABELS_DIR)
    labeler_dir = os.path.join(labels_dir, labeler_name)

    review_files = []

    if not os.path.exists(labeler_dir):
        return review_files

    # Scan all label JSON files in the labeler's directory
    for filename in os.listdir(labeler_dir):
        if filename.endswith('.json') and filename != 'done_files.json':
            label_file = os.path.join(labeler_dir, filename)
            try:
                with open(label_file, 'r') as f:
                    labels = json.load(f)
                    # Check if any segment has review: true
                    for segment_id, segment_data in labels.items():
                        if isinstance(segment_data, dict) and segment_data.get('review', False):
                            # Add the original file name (with extension)
                            # The label file is named without extension, need to find actual file
                            base_name = filename[:-5]  # Remove .json
                            # Return the base name - frontend will match against h5/hdf5 files
                            review_files.append(base_name)
                            break  # Once we find one review segment, file is marked
            except Exception as e:
                log_error(f"Error reading label file {filename}: {e}")

    return review_files


def find_peaks(params):
    """Find peaks in signal data using scipy.signal.find_peaks."""
    signal_data = params['signal_data']
    segment_index = params['segment_index']

    # Convert to numpy array
    signal_array = np.array(signal_data)

    # Find peaks (systolic points - maxima)
    systolic_peaks, _ = signal.find_peaks(signal_array, height=None, distance=50)


    # Find diastolic points (minima) by inverting signal
    diastolic_peaks, _ = signal.find_peaks(-signal_array, height=None, distance=50)

    return {
        'systolic': systolic_peaks.tolist(),
        'diastolic': diastolic_peaks.tolist()
    }

def get_segment(params):
    """Extract a specific segment from file data.

    Args:
        params: dict with 'file_data', 'segment_index', and 'segment_length'
    """
    file_data = params['file_data']
    segment_index = params['segment_index']
    segment_length = params.get('segment_length', 2000)  # Default to 2000 for backward compatibility

    # Convert file_data back to DataFrame
    df = pd.DataFrame(file_data['data'], columns=file_data['columns'])

    # Extract segment
    start_idx = segment_index * segment_length
    end_idx = min(start_idx + segment_length, len(df))
    segment_df = df.iloc[start_idx:end_idx]

    return {
        'columns': segment_df.columns.tolist(),
        'data': segment_df.values.tolist()
    }

def calculate_derivative(params):
    """Calculate derivative of arterial line signal using Savitzky-Golay filter."""
    signal_data = params['signal_data']

    # Convert to numpy array
    signal_array = np.array(signal_data)

    # Apply Savitzky-Golay filter for derivative
    window_length = 11
    polyorder = 3
    derivative = signal.savgol_filter(signal_array, window_length, polyorder, deriv=1)

    return derivative.tolist()


def find_onset_compression(params):
    """Find compression onset points using second derivative peaks.

    Uses the same logic as get_onset_compression from abp_features.py:
    For each systolic peak, finds the nearest second derivative peak
    within a specified window before the peak.

    Args:
        params: dict with 'signal_data', 'systolic_peaks', optional 'window', and optional 'offset'

    Returns:
        list of onset indices (with offset subtracted)
    """
    signal_data = params['signal_data']
    systolic_peaks = params['systolic_peaks']
    window = params.get('window', 30)
    offset = params.get('offset', 10)

    # Convert to numpy array
    signal_array = np.array(signal_data)

    # Compute second derivative using same parameters as ABP derivative computation
    window_length = 15
    if window_length % 2 == 0:
        window_length += 1
    polyorder = 3

    try:
        der2 = signal.savgol_filter(signal_array, window_length, polyorder, deriv=2)

        # Find peaks in second derivative (same params as abp_features.py)
        der2_peaks, _ = signal.find_peaks(der2, distance=20, prominence=0.05)

        # Find onset for each systolic peak
        onsets = []
        for p in systolic_peaks:
            # Find der2 peaks within window before systolic peak
            o = der2_peaks[(der2_peaks < p) & (p - der2_peaks < window)]
            if len(o) != 0:
                # Take the last one (closest to systolic peak) and subtract offset
                onset_idx = int(o[-1]) - offset
                # Ensure index doesn't go negative
                onsets.append(max(0, onset_idx))

        log_error(f"Found {len(onsets)} onset points from {len(systolic_peaks)} systolic peaks (offset={offset})")
        return onsets

    except Exception as e:
        log_error(f"Error in find_onset_compression: {e}")
        return []


def find_upslope(params):
    """Find upslope points where first derivative rises above a threshold.

    Detects points where the first derivative crosses above a computed threshold,
    then filters to keep only points within a specified distance range of systolic peaks.

    Args:
        params: dict with:
            - signal_data: ABP signal values
            - systolic_peaks: indices of systolic peaks for filtering
            - threshold_method: 'percentile', 'std', or 'fixed'
            - threshold_value: value for the chosen method
            - min_distance: minimum distance from systolic peak to keep
            - max_distance: maximum distance from systolic peak to keep

    Returns:
        list of upslope indices
    """
    signal_data = params['signal_data']
    systolic_peaks = params.get('systolic_peaks', [])
    threshold_method = params.get('threshold_method', 'percentile')
    threshold_value = params.get('threshold_value', 75)
    min_distance = params.get('min_distance', 0)
    max_distance = params.get('max_distance', 50)

    # Convert to numpy array
    signal_array = np.array(signal_data)

    # Compute first derivative using savgol_filter
    window_length = 15
    if window_length % 2 == 0:
        window_length += 1
    polyorder = 3

    try:
        der1 = signal.savgol_filter(signal_array, window_length, polyorder, deriv=1)

        # Compute threshold based on method
        if threshold_method == 'percentile':
            threshold = np.percentile(der1, threshold_value)
        elif threshold_method == 'std':
            threshold = np.mean(der1) + threshold_value * np.std(der1)
        else:  # fixed
            threshold = threshold_value

        log_error(f"Upslope threshold ({threshold_method}): {threshold}")

        # Find where derivative crosses above threshold
        above_threshold = der1 > threshold
        # Find rising edges (0 -> 1 transitions)
        crossings = np.where(np.diff(above_threshold.astype(int)) == 1)[0]

        log_error(f"Found {len(crossings)} threshold crossings")

        # Filter by distance from systolic peaks
        if len(systolic_peaks) > 0 and (min_distance > 0 or max_distance > 0):
            filtered = []
            for c in crossings:
                for p in systolic_peaks:
                    dist = abs(int(c) - int(p))
                    if dist >= min_distance and (max_distance == 0 or dist <= max_distance):
                        filtered.append(int(c))
                        break
            log_error(f"After filtering by distance ({min_distance}-{max_distance}): {len(filtered)} points")
            return filtered
        else:
            # No filtering, return all crossings
            return [int(c) for c in crossings]

    except Exception as e:
        log_error(f"Error in find_upslope: {e}")
        return []


# Method dispatcher
METHODS = {
    'get_csv_files': get_csv_files,
    'load_patient_file': load_patient_file,
    'load_labels': load_labels,
    'save_labels': save_labels,
    'load_done_files': load_done_files,
    'toggle_done_file': toggle_done_file,
    'load_review_files': load_review_files,
    'find_peaks': find_peaks,
    'get_segment': get_segment,
    'calculate_derivative': calculate_derivative,
    'find_onset_compression': find_onset_compression,
    'find_upslope': find_upslope
}

def process_message(message):
    """Process a single message from Electron."""
    try:
        msg_id = message.get('id')
        method = message.get('method')
        params = message.get('params', {})

        if method not in METHODS:
            return {
                'id': msg_id,
                'error': f"Unknown method: {method}"
            }

        result = METHODS[method](params)

        return {
            'id': msg_id,
            'result': result
        }

    except Exception as e:
        log_error(f"Error processing message: {str(e)}")
        return {
            'id': message.get('id'),
            'error': str(e)
        }

def main():
    """Main loop: read JSON from stdin, process, write JSON to stdout."""
    log_error("Python backend started")

    # Set stdout and stdin to unbuffered mode
    sys.stdout.reconfigure(line_buffering=True)
    sys.stdin.reconfigure(line_buffering=True)

    while True:
        try:
            # Read line from stdin
            line = sys.stdin.readline()

            # Check for EOF
            if not line:
                log_error("EOF reached on stdin")
                break

            line = line.strip()

            # Skip empty lines
            if not line:
                log_error("Empty line received, continuing")
                continue

            log_error(f"Raw line received: {line[:100]}...")  # Log first 100 chars

            # Parse JSON message
            try:
                message = json.loads(line)
            except json.JSONDecodeError as e:
                log_error(f"JSON decode error: {e}, line was: {line}")
                continue

            log_error(f"Received message: {message.get('method')}")

            # Process message
            response = process_message(message)

            # Send response to stdout
            response_json = json.dumps(response)
            print(response_json, flush=True)
            log_error(f"Sent response for: {message.get('method')}")

            # Force flush
            sys.stdout.flush()

        except KeyboardInterrupt:
            log_error("Keyboard interrupt received")
            break
        except Exception as e:
            log_error(f"Unexpected error: {e}")
            import traceback
            log_error(traceback.format_exc())

    log_error("Python backend stopped")

if __name__ == '__main__':
    main()
