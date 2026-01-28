"""
Arterial Waveform HSMM Package

Hidden Semi-Markov Model for heart phase classification from arterial waveform.

States:
    0 - Upstroke (systolic rise)
    1 - Downstroke (diastolic descent)

Main Components:
    - HeartPhaseHSMM: Core HSMM with Viterbi decoding
    - hsmm_utils: Helper functions for transition matrices and duration statistics
    - arterial_data: Data utilities for creating label sequences
"""

from .models.heart_phase_hsmm import HeartPhaseHSMM, UPSTROKE, DOWNSTROKE, PHASE_NAMES
from .models.hsmm_utils import (
    calculate_transition_matrix,
    extract_duration_statistics,
    fit_gamma_parameters,
    compute_cdf_tables,
    get_cyclic_transition_matrix,
    validate_label_sequence,
    smooth_predictions,
)
from .data.arterial_data import (
    extract_phases_from_peaks,
    create_label_sequence,
    split_into_segments,
    combine_segments,
    normalize_signal,
)

__all__ = [
    # Core HSMM
    'HeartPhaseHSMM',

    # Constants
    'UPSTROKE',
    'DOWNSTROKE',
    'PHASE_NAMES',

    # HSMM utilities
    'calculate_transition_matrix',
    'extract_duration_statistics',
    'fit_gamma_parameters',
    'compute_cdf_tables',
    'get_cyclic_transition_matrix',
    'validate_label_sequence',
    'smooth_predictions',

    # Data utilities
    'extract_phases_from_peaks',
    'create_label_sequence',
    'split_into_segments',
    'combine_segments',
    'normalize_signal',
]
