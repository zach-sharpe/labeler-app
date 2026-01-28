"""
Data Utilities for Arterial Waveform Heart Phase Classification

Helper functions for:
- Creating label sequences from peak annotations
- Splitting continuous data into segments
- Combining predictions from segments
"""

import numpy as np
from typing import List, Tuple, Optional, Union


# Heart phase constants
UPSTROKE = 0
DOWNSTROKE = 1


def extract_phases_from_peaks(
    signal_length: int,
    peak_indices: np.ndarray,
    trough_indices: Optional[np.ndarray] = None
) -> np.ndarray:
    """
    Create heart phase labels from peak (and optionally trough) annotations.

    Upstroke: from trough to peak (rising phase)
    Downstroke: from peak to trough (falling phase)

    Parameters
    ----------
    signal_length : int
        Length of the signal
    peak_indices : np.ndarray
        Indices of systolic peaks
    trough_indices : np.ndarray, optional
        Indices of diastolic troughs. If not provided, troughs are
        estimated as midpoints between peaks.

    Returns
    -------
    labels : np.ndarray
        Label array of shape (signal_length,) with 0=upstroke, 1=downstroke

    Example
    -------
    >>> signal_length = 1000
    >>> peaks = np.array([50, 150, 250, 350, 450])
    >>> labels = extract_phases_from_peaks(signal_length, peaks)
    >>> # Labels will alternate between upstroke and downstroke
    """
    labels = np.zeros(signal_length, dtype=np.int32)

    if len(peak_indices) == 0:
        return labels

    peak_indices = np.sort(peak_indices)

    # Estimate troughs if not provided
    if trough_indices is None:
        # Troughs are approximately halfway between peaks
        trough_indices = []
        # First trough: before first peak
        if peak_indices[0] > 0:
            trough_indices.append(peak_indices[0] // 2)
        # Troughs between peaks
        for i in range(len(peak_indices) - 1):
            mid = (peak_indices[i] + peak_indices[i + 1]) // 2
            trough_indices.append(mid)
        # Last trough: after last peak
        if peak_indices[-1] < signal_length - 1:
            trough_indices.append((peak_indices[-1] + signal_length) // 2)
        trough_indices = np.array(trough_indices)
    else:
        trough_indices = np.sort(trough_indices)

    # Combine and sort all landmarks
    all_landmarks = []
    for p in peak_indices:
        all_landmarks.append((p, 'peak'))
    for t in trough_indices:
        all_landmarks.append((t, 'trough'))
    all_landmarks.sort(key=lambda x: x[0])

    # Label each segment
    for i in range(len(all_landmarks) - 1):
        start_idx, start_type = all_landmarks[i]
        end_idx, end_type = all_landmarks[i + 1]

        if start_type == 'trough' and end_type == 'peak':
            # Upstroke: rising from trough to peak
            labels[start_idx:end_idx] = UPSTROKE
        elif start_type == 'peak' and end_type == 'trough':
            # Downstroke: falling from peak to trough
            labels[start_idx:end_idx] = DOWNSTROKE

    # Handle edges
    if len(all_landmarks) > 0:
        first_idx, first_type = all_landmarks[0]
        last_idx, last_type = all_landmarks[-1]

        # Beginning of signal to first landmark
        if first_type == 'peak':
            labels[:first_idx] = UPSTROKE
        else:
            labels[:first_idx] = DOWNSTROKE

        # Last landmark to end of signal
        if last_type == 'peak':
            labels[last_idx:] = DOWNSTROKE
        else:
            labels[last_idx:] = UPSTROKE

    return labels


def create_label_sequence(
    upstroke_ranges: List[Tuple[int, int]],
    signal_length: int,
    default_label: int = DOWNSTROKE
) -> np.ndarray:
    """
    Create label sequence from upstroke time ranges.

    Parameters
    ----------
    upstroke_ranges : list of (start, end) tuples
        Time ranges where signal is in upstroke phase
    signal_length : int
        Total length of the signal
    default_label : int
        Label for regions outside upstroke ranges (default: DOWNSTROKE)

    Returns
    -------
    labels : np.ndarray
        Label array of shape (signal_length,)

    Example
    -------
    >>> upstroke_ranges = [(0, 30), (100, 130), (200, 230)]
    >>> labels = create_label_sequence(upstroke_ranges, signal_length=300)
    """
    labels = np.full(signal_length, default_label, dtype=np.int32)

    for start, end in upstroke_ranges:
        start = max(0, start)
        end = min(signal_length, end)
        labels[start:end] = UPSTROKE

    return labels


def split_into_segments(
    signal: np.ndarray,
    labels: Optional[np.ndarray] = None,
    segment_length: int = 500,
    overlap: int = 0,
    min_length: int = 100
) -> Tuple[List[np.ndarray], List[np.ndarray], List[Tuple[int, int]]]:
    """
    Split continuous signal into overlapping segments for processing.

    Parameters
    ----------
    signal : np.ndarray
        Input signal of shape (N,) or (N, n_features)
    labels : np.ndarray, optional
        Label array of shape (N,)
    segment_length : int
        Length of each segment
    overlap : int
        Number of samples to overlap between segments
    min_length : int
        Minimum length for the last segment

    Returns
    -------
    signal_segments : list of np.ndarray
        List of signal segments
    label_segments : list of np.ndarray
        List of label segments (empty if labels not provided)
    boundaries : list of (start, end) tuples
        Start and end indices for each segment in original signal

    Example
    -------
    >>> signal = np.random.randn(1000)
    >>> labels = np.random.randint(0, 2, 1000)
    >>> sig_segs, lbl_segs, bounds = split_into_segments(
    ...     signal, labels, segment_length=200, overlap=50
    ... )
    """
    n = len(signal)
    step = segment_length - overlap

    signal_segments = []
    label_segments = []
    boundaries = []

    start = 0
    while start < n:
        end = min(start + segment_length, n)

        # Check minimum length for last segment
        if n - start < min_length and len(signal_segments) > 0:
            # Extend previous segment instead
            prev_start, _ = boundaries[-1]
            signal_segments[-1] = signal[prev_start:n]
            if labels is not None:
                label_segments[-1] = labels[prev_start:n]
            boundaries[-1] = (prev_start, n)
            break

        signal_segments.append(signal[start:end])
        if labels is not None:
            label_segments.append(labels[start:end])
        boundaries.append((start, end))

        start += step

    return signal_segments, label_segments, boundaries


def combine_segments(
    predictions: List[np.ndarray],
    boundaries: List[Tuple[int, int]],
    total_length: int,
    overlap_strategy: str = 'average'
) -> np.ndarray:
    """
    Combine predictions from overlapping segments back into continuous sequence.

    Parameters
    ----------
    predictions : list of np.ndarray
        Predictions for each segment (can be class labels or probabilities)
    boundaries : list of (start, end) tuples
        Segment boundaries from split_into_segments
    total_length : int
        Total length of original signal
    overlap_strategy : str
        How to handle overlapping regions:
        - 'average': Average probabilities (for probability predictions)
        - 'first': Use prediction from first segment
        - 'last': Use prediction from last segment
        - 'vote': Majority vote (for class labels)

    Returns
    -------
    combined : np.ndarray
        Combined predictions of shape (total_length,) or (total_length, n_classes)

    Example
    -------
    >>> # Combine probability predictions
    >>> combined_probs = combine_segments(
    ...     predictions, boundaries, total_length=1000, overlap_strategy='average'
    ... )
    """
    # Determine output shape
    first_pred = predictions[0]
    if first_pred.ndim == 1:
        combined = np.zeros(total_length, dtype=first_pred.dtype)
        counts = np.zeros(total_length, dtype=np.float32)
    else:
        n_classes = first_pred.shape[1]
        combined = np.zeros((total_length, n_classes), dtype=np.float32)
        counts = np.zeros(total_length, dtype=np.float32)

    for pred, (start, end) in zip(predictions, boundaries):
        seg_len = end - start
        pred_len = len(pred)

        # Handle length mismatch
        actual_len = min(seg_len, pred_len)

        if overlap_strategy == 'first':
            # Only fill if not already filled
            mask = counts[start:start + actual_len] == 0
            if pred.ndim == 1:
                combined[start:start + actual_len][mask] = pred[:actual_len][mask]
            else:
                combined[start:start + actual_len][mask] = pred[:actual_len][mask]
            counts[start:start + actual_len][mask] = 1

        elif overlap_strategy == 'last':
            # Always overwrite
            combined[start:start + actual_len] = pred[:actual_len]
            counts[start:start + actual_len] = 1

        else:  # 'average' or 'vote'
            combined[start:start + actual_len] += pred[:actual_len]
            counts[start:start + actual_len] += 1

    # Normalize for averaging
    if overlap_strategy in ['average', 'vote']:
        counts[counts == 0] = 1  # Avoid division by zero
        if combined.ndim == 1:
            combined = combined / counts
        else:
            combined = combined / counts[:, np.newaxis]

        if overlap_strategy == 'vote':
            combined = np.round(combined).astype(np.int32)

    return combined


def normalize_signal(
    signal: np.ndarray,
    method: str = 'zscore',
    axis: int = 0
) -> np.ndarray:
    """
    Normalize arterial waveform signal.

    Parameters
    ----------
    signal : np.ndarray
        Input signal
    method : str
        Normalization method:
        - 'zscore': (x - mean) / std
        - 'minmax': (x - min) / (max - min)
        - 'robust': (x - median) / IQR
    axis : int
        Axis along which to normalize

    Returns
    -------
    normalized : np.ndarray
        Normalized signal

    Example
    -------
    >>> signal = np.random.randn(1000) * 50 + 100
    >>> normalized = normalize_signal(signal, method='zscore')
    """
    signal = signal.astype(np.float32)

    if method == 'zscore':
        mean = np.mean(signal, axis=axis, keepdims=True)
        std = np.std(signal, axis=axis, keepdims=True)
        std[std < 1e-8] = 1.0
        return (signal - mean) / std

    elif method == 'minmax':
        min_val = np.min(signal, axis=axis, keepdims=True)
        max_val = np.max(signal, axis=axis, keepdims=True)
        range_val = max_val - min_val
        range_val[range_val < 1e-8] = 1.0
        return (signal - min_val) / range_val

    elif method == 'robust':
        median = np.median(signal, axis=axis, keepdims=True)
        q75, q25 = np.percentile(signal, [75, 25], axis=axis, keepdims=True)
        iqr = q75 - q25
        iqr[iqr < 1e-8] = 1.0
        return (signal - median) / iqr

    else:
        raise ValueError(f"Unknown normalization method: {method}")
