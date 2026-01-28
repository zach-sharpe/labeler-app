"""
Heart Phase Hidden Semi-Markov Model (HSMM)

Duration-based HSMM with CDF-based dynamic transition probabilities
for classifying arterial waveform into upstroke and downstroke phases.

States:
    0 - Upstroke (systolic rise)
    1 - Downstroke (diastolic descent)

Transition pattern: Upstroke -> Downstroke -> Upstroke -> ...
"""

import numpy as np
from scipy.stats import gamma
from typing import Dict, Optional, List

try:
    from numba import jit
    NUMBA_AVAILABLE = True
except ImportError:
    NUMBA_AVAILABLE = False
    def jit(*args, **kwargs):
        def decorator(func):
            return func
        return decorator


# Heart phase constants
UPSTROKE = 0
DOWNSTROKE = 1
N_PHASES = 2
PHASE_NAMES = {0: 'Upstroke', 1: 'Downstroke'}


class HeartPhaseHSMM:
    """
    Duration-based HSMM for heart phase classification.

    Uses CDF-based dynamic transition probabilities:
      - P(stay in state s | duration d) = 1 - CDF(d) = survival probability
      - P(transition to next state | duration d) = CDF(d)

    This makes transitions more likely as we exceed the expected duration
    for each phase, which is physiologically appropriate for cardiac cycles.

    Parameters
    ----------
    max_duration : int
        Maximum duration in each state (in samples)
    min_duration : int
        Minimum duration before transitions are allowed

    Attributes
    ----------
    duration_params : dict
        Gamma distribution parameters for each state
    transition_order : list
        Cyclic transition order [UPSTROKE, DOWNSTROKE]
    """

    def __init__(self, max_duration: int = 100, min_duration: int = 5):
        self.n_states = N_PHASES
        self.max_duration = max_duration
        self.min_duration = min_duration

        # Duration parameters (gamma distribution)
        # Will be fit from data or set manually
        self.duration_params = {}

        # Cyclic transition order: Upstroke -> Downstroke -> Upstroke
        self.transition_order = [UPSTROKE, DOWNSTROKE]

        # Default duration parameters (can be overridden)
        # These are typical for ~100 Hz sampling
        self._set_default_duration_params()

    def _set_default_duration_params(self):
        """Set default duration parameters for heart phases."""
        # Typical cardiac cycle: ~60-100 bpm
        # At 100 Hz: systolic phase ~30-50 samples, diastolic ~50-100 samples

        # Upstroke (systolic rise) - typically shorter
        self.duration_params[UPSTROKE] = {
            'shape': 3.0,  # Gamma shape parameter
            'scale': 10.0,  # Gamma scale parameter
            'mean': 30.0,
            'std': 15.0,
            'min': 5,
            'max': 60
        }

        # Downstroke (diastolic descent) - typically longer
        self.duration_params[DOWNSTROKE] = {
            'shape': 4.0,
            'scale': 15.0,
            'mean': 60.0,
            'std': 25.0,
            'min': 10,
            'max': 150
        }

    def set_duration_params(self, state: int, shape: float, scale: float,
                            mean: float = None, std: float = None,
                            min_dur: int = None, max_dur: int = None):
        """
        Set duration parameters for a specific state.

        Parameters
        ----------
        state : int
            State index (0=Upstroke, 1=Downstroke)
        shape : float
            Gamma distribution shape parameter
        scale : float
            Gamma distribution scale parameter
        mean : float, optional
            Mean duration (informational)
        std : float, optional
            Std duration (informational)
        min_dur : int, optional
            Minimum duration constraint
        max_dur : int, optional
            Maximum duration constraint
        """
        if mean is None:
            mean = shape * scale
        if std is None:
            std = np.sqrt(shape) * scale

        self.duration_params[state] = {
            'shape': shape,
            'scale': scale,
            'mean': mean,
            'std': std,
            'min': min_dur if min_dur is not None else self.min_duration,
            'max': max_dur if max_dur is not None else self.max_duration
        }

    def fit_durations_from_data(self, label_sequences: List[np.ndarray]):
        """
        Fit duration parameters from labeled data.

        Parameters
        ----------
        label_sequences : list of np.ndarray
            List of label sequences (each containing 0s and 1s)
        """
        from .hsmm_utils import extract_duration_statistics, fit_gamma_parameters

        stats = extract_duration_statistics(label_sequences, self.n_states)

        for state in range(self.n_states):
            durations = stats['all_durations'][state]
            if len(durations) >= 3:  # Need at least 3 samples to fit
                shape, scale = fit_gamma_parameters(durations)
                self.set_duration_params(
                    state=state,
                    shape=shape,
                    scale=scale,
                    mean=stats['mean_durations'][state],
                    std=stats['std_durations'][state],
                    min_dur=int(stats['min_durations'][state]),
                    max_dur=int(stats['max_durations'][state])
                )

    def _prepare_cdf_tables(self):
        """
        Precompute CDF values for all states and durations.

        Returns
        -------
        stay_prob : np.ndarray
            P(stay | duration) = 1 - CDF(duration) for each state
        trans_prob : np.ndarray
            P(transition | duration) = CDF(duration) for each state
        """
        stay_prob = np.ones((self.n_states, self.max_duration)) * 0.5
        trans_prob = np.ones((self.n_states, self.max_duration)) * 0.5

        for state in range(self.n_states):
            if state in self.duration_params:
                params = self.duration_params[state]
                shape = params['shape']
                scale = params['scale']
                min_dur = params.get('min', self.min_duration)

                for d in range(1, self.max_duration):
                    if d < min_dur:
                        # Must stay if below minimum duration
                        stay_prob[state, d] = 1.0
                        trans_prob[state, d] = 0.0
                    else:
                        # CDF = probability that duration <= d
                        cdf_val = gamma.cdf(d, a=shape, scale=scale)
                        cdf_val = np.clip(cdf_val, 0.01, 0.99)

                        # Survival probability (stay) = 1 - CDF
                        stay_prob[state, d] = 1.0 - cdf_val
                        # Transition probability = CDF
                        trans_prob[state, d] = cdf_val

        return stay_prob, trans_prob

    def _get_next_state(self, state: int) -> int:
        """Get the next state in the cyclic transition pattern."""
        idx = self.transition_order.index(state)
        return self.transition_order[(idx + 1) % len(self.transition_order)]

    def viterbi_decode(self, emission_probs: np.ndarray) -> np.ndarray:
        """
        Viterbi decoding with CDF-based dynamic transition probabilities.

        Parameters
        ----------
        emission_probs : np.ndarray
            Emission probabilities of shape (T, n_states) from DNN/classifier

        Returns
        -------
        path : np.ndarray
            Decoded state sequence of length T
        """
        T = len(emission_probs)

        # Precompute CDF-based transition tables
        stay_prob, trans_prob = self._prepare_cdf_tables()

        # Build next_states array
        next_states = np.array([self._get_next_state(s) for s in range(self.n_states)],
                               dtype=np.int32)

        # Run Viterbi
        if NUMBA_AVAILABLE:
            path = _viterbi_heart_numba(
                emission_probs, stay_prob, trans_prob,
                next_states, self.n_states, self.max_duration, T
            )
        else:
            path = _viterbi_heart_python(
                emission_probs, stay_prob, trans_prob,
                next_states, self.n_states, self.max_duration, T
            )

        if path is None:
            print("Warning: No valid Viterbi path found, returning argmax predictions")
            return np.argmax(emission_probs, axis=1)

        return path

    def get_phase_name(self, state: int) -> str:
        """Get the name of a phase given its index."""
        return PHASE_NAMES.get(state, f"Unknown({state})")


@jit(nopython=True, cache=True)
def _viterbi_heart_numba(emission_probs, stay_prob, trans_prob,
                         next_states, n_states, max_duration, T):
    """
    JIT-compiled Viterbi for heart phase decoding.

    State: (state, duration_in_state)
    Transitions:
      - Stay: score += log(stay_prob[s, d]) + log(emission[s])
      - Trans: score += log(trans_prob[s, d]) + log(emission[next_s])
    """
    # DP table: delta[t, s, d] = best log-prob to be in state s with duration d at time t
    delta = np.full((T, n_states, max_duration), -np.inf)
    # Backpointer: psi[t, s, d] = (prev_state, prev_duration)
    psi = np.zeros((T, n_states, max_duration, 2), dtype=np.int32)

    # Initialization (t=0)
    for s in range(n_states):
        emission_ll = np.log(emission_probs[0, s] + 1e-10)
        delta[0, s, 1] = emission_ll
        psi[0, s, 1, 0] = -1
        psi[0, s, 1, 1] = -1

    # Forward pass
    for t in range(1, T):
        for s in range(n_states):
            emission_ll = np.log(emission_probs[t, s] + 1e-10)

            # Option 1: STAY in same state (increment duration)
            for d in range(2, min(t + 2, max_duration)):
                prev_d = d - 1
                if delta[t-1, s, prev_d] > -np.inf:
                    stay_ll = np.log(stay_prob[s, prev_d] + 1e-10)
                    score = delta[t-1, s, prev_d] + stay_ll + emission_ll

                    if score > delta[t, s, d]:
                        delta[t, s, d] = score
                        psi[t, s, d, 0] = s
                        psi[t, s, d, 1] = prev_d

            # Option 2: TRANSITION from previous state
            prev_s = (s - 1) % n_states  # Previous state in cycle
            next_s_for_prev = next_states[prev_s]

            if next_s_for_prev == s:  # Valid transition
                for prev_d in range(1, max_duration):
                    if delta[t-1, prev_s, prev_d] > -np.inf:
                        trans_ll = np.log(trans_prob[prev_s, prev_d] + 1e-10)
                        score = delta[t-1, prev_s, prev_d] + trans_ll + emission_ll

                        if score > delta[t, s, 1]:
                            delta[t, s, 1] = score
                            psi[t, s, 1, 0] = prev_s
                            psi[t, s, 1, 1] = prev_d

    # Find best final state
    best_state = 0
    best_duration = 1
    best_score = -np.inf

    for s in range(n_states):
        for d in range(1, max_duration):
            if delta[T-1, s, d] > best_score:
                best_score = delta[T-1, s, d]
                best_state = s
                best_duration = d

    if best_score == -np.inf:
        return None

    # Backtrack to reconstruct path
    path = np.zeros(T, dtype=np.int32)
    current_state = best_state
    current_duration = best_duration

    for t in range(T-1, -1, -1):
        path[t] = current_state
        prev_state = psi[t, current_state, current_duration, 0]
        prev_duration = psi[t, current_state, current_duration, 1]

        if prev_state == -1:
            for tt in range(t-1, -1, -1):
                path[tt] = current_state
            break

        current_state = prev_state
        current_duration = prev_duration

    return path


def _viterbi_heart_python(emission_probs, stay_prob, trans_prob,
                          next_states, n_states, max_duration, T):
    """Python fallback for heart phase Viterbi decoding."""
    delta = np.full((T, n_states, max_duration), -np.inf)
    psi = np.zeros((T, n_states, max_duration, 2), dtype=np.int32)

    # Initialization
    for s in range(n_states):
        emission_ll = np.log(emission_probs[0, s] + 1e-10)
        delta[0, s, 1] = emission_ll
        psi[0, s, 1] = [-1, -1]

    # Forward pass
    for t in range(1, T):
        for s in range(n_states):
            emission_ll = np.log(emission_probs[t, s] + 1e-10)

            # Option 1: STAY
            for d in range(2, min(t + 2, max_duration)):
                prev_d = d - 1
                if delta[t-1, s, prev_d] > -np.inf:
                    stay_ll = np.log(stay_prob[s, prev_d] + 1e-10)
                    score = delta[t-1, s, prev_d] + stay_ll + emission_ll

                    if score > delta[t, s, d]:
                        delta[t, s, d] = score
                        psi[t, s, d] = [s, prev_d]

            # Option 2: TRANSITION
            prev_s = (s - 1) % n_states
            if next_states[prev_s] == s:
                for prev_d in range(1, max_duration):
                    if delta[t-1, prev_s, prev_d] > -np.inf:
                        trans_ll = np.log(trans_prob[prev_s, prev_d] + 1e-10)
                        score = delta[t-1, prev_s, prev_d] + trans_ll + emission_ll

                        if score > delta[t, s, 1]:
                            delta[t, s, 1] = score
                            psi[t, s, 1] = [prev_s, prev_d]

    # Find best final state
    best_state = 0
    best_duration = 1
    best_score = -np.inf

    for s in range(n_states):
        for d in range(1, max_duration):
            if delta[T-1, s, d] > best_score:
                best_score = delta[T-1, s, d]
                best_state = s
                best_duration = d

    if best_score == -np.inf:
        return None

    # Backtrack
    path = np.zeros(T, dtype=np.int32)
    current_state = best_state
    current_duration = best_duration

    for t in range(T-1, -1, -1):
        path[t] = current_state
        prev_state, prev_duration = psi[t, current_state, current_duration]

        if prev_state == -1:
            for tt in range(t-1, -1, -1):
                path[tt] = current_state
            break

        current_state = prev_state
        current_duration = prev_duration

    return path
