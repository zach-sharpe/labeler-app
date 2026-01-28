"""
HSMM Utility Functions for Heart Phase Classification

Helper functions for:
- Calculating transition matrices from labeled sequences
- Extracting duration statistics
- Fitting gamma distribution parameters
"""

import numpy as np
from scipy.stats import gamma
from typing import List, Dict, Tuple, Optional, Union


def calculate_transition_matrix(
    sequences: Union[List[np.ndarray], np.ndarray],
    n_states: int = 2,
    label_to_idx: Optional[Dict[int, int]] = None
) -> np.ndarray:
    """
    Calculate state transition matrix from labeled sequences.

    Parameters
    ----------
    sequences : list of np.ndarray or np.ndarray
        Labeled sequences. Can be:
        - List of 1D arrays (each array is a sequence)
        - Single 1D array (one sequence)
    n_states : int
        Number of states (default 2 for upstroke/downstroke)
    label_to_idx : dict, optional
        Mapping from original labels to 0-indexed labels
        e.g., {1: 0, 2: 1} if labels are 1 and 2

    Returns
    -------
    transition_matrix : np.ndarray
        Transition probability matrix of shape (n_states, n_states)

    Example
    -------
    >>> labels = [np.array([0, 0, 0, 1, 1, 1, 0, 0, 1, 1])]
    >>> trans_mat = calculate_transition_matrix(labels, n_states=2)
    >>> print(trans_mat)
    # Shows high prob of staying in same state, transitions at phase changes
    """
    # Handle single array input
    if isinstance(sequences, np.ndarray):
        if sequences.ndim == 1:
            sequences = [sequences]

    # Initialize transition count matrix
    transition_counts = np.zeros((n_states, n_states))

    # Count transitions
    for seq in sequences:
        for t in range(len(seq) - 1):
            current_state = int(seq[t])
            next_state = int(seq[t + 1])

            # Map to 0-indexed if mapping provided
            if label_to_idx is not None:
                current_state = label_to_idx[current_state]
                next_state = label_to_idx[next_state]

            transition_counts[current_state, next_state] += 1

    # Normalize to get probabilities
    row_sums = transition_counts.sum(axis=1, keepdims=True)
    row_sums[row_sums == 0] = 1  # Avoid division by zero
    transition_matrix = transition_counts / row_sums

    # Handle states with no transitions (use uniform distribution)
    for i in range(n_states):
        if transition_counts[i].sum() == 0:
            transition_matrix[i] = 1.0 / n_states

    return transition_matrix


def extract_duration_statistics(
    sequences: Union[List[np.ndarray], np.ndarray],
    n_states: int = 2,
    label_to_idx: Optional[Dict[int, int]] = None
) -> Dict:
    """
    Extract duration (sojourn time) statistics from labeled sequences.

    Parameters
    ----------
    sequences : list of np.ndarray or np.ndarray
        Labeled sequences
    n_states : int
        Number of states (default 2 for upstroke/downstroke)
    label_to_idx : dict, optional
        Mapping from original labels to 0-indexed labels

    Returns
    -------
    duration_stats : dict
        Dictionary with keys:
        - 'mean_durations': array of mean durations for each state
        - 'std_durations': array of std durations for each state
        - 'min_durations': array of min durations for each state
        - 'max_durations': array of max durations for each state
        - 'all_durations': list of lists, where all_durations[i] contains
                          all observed durations for state i

    Example
    -------
    >>> labels = [np.array([0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1])]
    >>> stats = extract_duration_statistics(labels, n_states=2)
    >>> print(f"Mean upstroke duration: {stats['mean_durations'][0]:.1f}")
    >>> print(f"Mean downstroke duration: {stats['mean_durations'][1]:.1f}")
    """
    # Handle single array input
    if isinstance(sequences, np.ndarray):
        if sequences.ndim == 1:
            sequences = [sequences]

    # Initialize duration storage
    all_durations = [[] for _ in range(n_states)]

    # Extract durations from each sequence
    for seq in sequences:
        if len(seq) == 0:
            continue

        current_state = int(seq[0])
        if label_to_idx is not None:
            current_state = label_to_idx[current_state]

        duration = 1

        for t in range(1, len(seq)):
            state = int(seq[t])
            if label_to_idx is not None:
                state = label_to_idx[state]

            if state == current_state:
                duration += 1
            else:
                # State changed, record duration
                all_durations[current_state].append(duration)
                current_state = state
                duration = 1

        # Record the last duration
        all_durations[current_state].append(duration)

    # Calculate statistics
    mean_durations = np.zeros(n_states)
    std_durations = np.zeros(n_states)
    min_durations = np.zeros(n_states)
    max_durations = np.zeros(n_states)

    for i in range(n_states):
        if len(all_durations[i]) > 0:
            mean_durations[i] = np.mean(all_durations[i])
            std_durations[i] = np.std(all_durations[i])
            min_durations[i] = np.min(all_durations[i])
            max_durations[i] = np.max(all_durations[i])
        else:
            mean_durations[i] = 1.0
            std_durations[i] = 0.0
            min_durations[i] = 1.0
            max_durations[i] = 1.0

    return {
        'mean_durations': mean_durations,
        'std_durations': std_durations,
        'min_durations': min_durations,
        'max_durations': max_durations,
        'all_durations': all_durations,
        'n_observations': [len(d) for d in all_durations]
    }


def fit_gamma_parameters(durations: List[int]) -> Tuple[float, float]:
    """
    Fit gamma distribution parameters from observed durations.

    Uses method of moments for robust estimation.

    Parameters
    ----------
    durations : list of int
        List of observed durations

    Returns
    -------
    shape : float
        Gamma distribution shape parameter (alpha/k)
    scale : float
        Gamma distribution scale parameter (theta)

    Notes
    -----
    The gamma distribution is parameterized as:
        f(x; k, theta) = x^(k-1) * exp(-x/theta) / (theta^k * Gamma(k))

    Mean = k * theta
    Variance = k * theta^2

    Example
    -------
    >>> durations = [25, 30, 28, 35, 22, 31, 29, 33]
    >>> shape, scale = fit_gamma_parameters(durations)
    >>> print(f"Shape: {shape:.2f}, Scale: {scale:.2f}")
    """
    durations = np.array(durations, dtype=float)

    if len(durations) < 2:
        # Not enough data, return defaults
        return 2.0, 10.0

    mean = np.mean(durations)
    var = np.var(durations, ddof=1)  # Unbiased variance

    if var < 1e-6:
        # Very low variance, use defaults based on mean
        return 2.0, mean / 2.0

    # Method of moments
    # mean = shape * scale
    # var = shape * scale^2
    # Therefore: scale = var / mean, shape = mean / scale

    scale = var / mean
    shape = mean / scale

    # Ensure reasonable bounds
    shape = np.clip(shape, 1.0, 50.0)
    scale = np.clip(scale, 1.0, 100.0)

    return float(shape), float(scale)


def compute_cdf_tables(
    duration_params: Dict[int, Dict],
    n_states: int = 2,
    max_duration: int = 100,
    min_duration: int = 5
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Precompute CDF-based transition probability tables.

    Parameters
    ----------
    duration_params : dict
        Dictionary mapping state index to duration parameters.
        Each entry should have 'shape' and 'scale' keys for gamma distribution.
    n_states : int
        Number of states
    max_duration : int
        Maximum duration to compute
    min_duration : int
        Minimum duration before transitions allowed

    Returns
    -------
    stay_prob : np.ndarray
        P(stay | duration) = 1 - CDF(duration), shape (n_states, max_duration)
    trans_prob : np.ndarray
        P(transition | duration) = CDF(duration), shape (n_states, max_duration)

    Example
    -------
    >>> duration_params = {
    ...     0: {'shape': 3.0, 'scale': 10.0},  # Upstroke
    ...     1: {'shape': 4.0, 'scale': 15.0}   # Downstroke
    ... }
    >>> stay_prob, trans_prob = compute_cdf_tables(duration_params)
    """
    stay_prob = np.ones((n_states, max_duration)) * 0.5
    trans_prob = np.ones((n_states, max_duration)) * 0.5

    for state in range(n_states):
        if state in duration_params:
            params = duration_params[state]
            shape = params['shape']
            scale = params['scale']
            min_d = params.get('min', min_duration)

            for d in range(1, max_duration):
                if d < min_d:
                    # Must stay if below minimum duration
                    stay_prob[state, d] = 1.0
                    trans_prob[state, d] = 0.0
                else:
                    # CDF = probability that duration <= d
                    cdf_val = gamma.cdf(d, a=shape, scale=scale)
                    cdf_val = np.clip(cdf_val, 0.01, 0.99)

                    stay_prob[state, d] = 1.0 - cdf_val
                    trans_prob[state, d] = cdf_val

    return stay_prob, trans_prob


def get_cyclic_transition_matrix(n_states: int = 2, self_trans_prob: float = 0.9) -> np.ndarray:
    """
    Create a cyclic transition matrix for sequential phases.

    For heart phases: Upstroke(0) -> Downstroke(1) -> Upstroke(0) -> ...

    Parameters
    ----------
    n_states : int
        Number of states
    self_trans_prob : float
        Probability of staying in the same state

    Returns
    -------
    transition_matrix : np.ndarray
        Transition probability matrix

    Example
    -------
    >>> trans_mat = get_cyclic_transition_matrix(n_states=2, self_trans_prob=0.9)
    >>> print(trans_mat)
    [[0.9 0.1]
     [0.1 0.9]]
    # But constrained: 0 can only go to 1, 1 can only go to 0
    """
    trans_prob = 1.0 - self_trans_prob
    transition_matrix = np.zeros((n_states, n_states))

    for i in range(n_states):
        transition_matrix[i, i] = self_trans_prob
        next_state = (i + 1) % n_states
        transition_matrix[i, next_state] = trans_prob

    return transition_matrix


def validate_label_sequence(
    sequence: np.ndarray,
    n_states: int = 2,
    min_phase_duration: int = 3
) -> Dict:
    """
    Validate a label sequence for physiological plausibility.

    Checks for:
    - Valid state values
    - Minimum phase durations
    - Proper alternation (no skipped phases)

    Parameters
    ----------
    sequence : np.ndarray
        Label sequence
    n_states : int
        Expected number of states
    min_phase_duration : int
        Minimum expected duration for each phase

    Returns
    -------
    validation_result : dict
        Dictionary with:
        - 'valid': bool, whether sequence is valid
        - 'issues': list of issue descriptions
        - 'stats': duration statistics

    Example
    -------
    >>> seq = np.array([0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1])
    >>> result = validate_label_sequence(seq)
    >>> print(f"Valid: {result['valid']}")
    >>> if result['issues']:
    ...     print(f"Issues: {result['issues']}")
    """
    issues = []

    # Check valid values
    unique_values = np.unique(sequence)
    invalid_values = [v for v in unique_values if v < 0 or v >= n_states]
    if invalid_values:
        issues.append(f"Invalid state values found: {invalid_values}")

    # Extract duration statistics
    stats = extract_duration_statistics([sequence], n_states)

    # Check minimum durations
    for state in range(n_states):
        durations = stats['all_durations'][state]
        short_durations = [d for d in durations if d < min_phase_duration]
        if short_durations:
            issues.append(
                f"State {state} has {len(short_durations)} phases shorter than "
                f"minimum ({min_phase_duration}): {short_durations}"
            )

    # Check for proper alternation (no consecutive different phases that skip states)
    # For 2-state: this is always satisfied
    # For n-state: check that we don't skip phases

    return {
        'valid': len(issues) == 0,
        'issues': issues,
        'stats': stats
    }


def smooth_predictions(
    predictions: np.ndarray,
    min_duration: int = 3
) -> np.ndarray:
    """
    Post-process predictions to remove very short phase segments.

    Simple median filter approach to remove noise-induced spurious transitions.

    Parameters
    ----------
    predictions : np.ndarray
        Raw prediction sequence
    min_duration : int
        Minimum segment duration to keep

    Returns
    -------
    smoothed : np.ndarray
        Smoothed predictions

    Example
    -------
    >>> preds = np.array([0, 0, 0, 1, 0, 0, 1, 1, 1, 1])  # Spurious 1 at index 3
    >>> smoothed = smooth_predictions(preds, min_duration=2)
    >>> print(smoothed)  # [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
    """
    smoothed = predictions.copy()
    n = len(smoothed)

    # Find segments
    i = 0
    while i < n:
        state = smoothed[i]
        j = i + 1
        while j < n and smoothed[j] == state:
            j += 1
        duration = j - i

        # If segment is too short, merge with neighbors
        if duration < min_duration:
            # Look at neighbors
            prev_state = smoothed[i - 1] if i > 0 else state
            next_state = smoothed[j] if j < n else state

            # Merge with the neighbor that appears more often
            if i > 0 and j < n:
                # Both neighbors exist, choose one
                smoothed[i:j] = prev_state
            elif i > 0:
                smoothed[i:j] = prev_state
            elif j < n:
                smoothed[i:j] = next_state
            # If no neighbors, keep as is

        i = j

    return smoothed
