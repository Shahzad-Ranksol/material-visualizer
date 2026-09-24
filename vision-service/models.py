"""Model loading for the Studio Lighting worker. MatSwap is not bundled: it is a diffusion
model that needs an NVIDIA GPU. Until it is installed, run_matswap raises ModelUnavailable and
the API answers 501, so the app keeps its exact render."""
from __future__ import annotations

import numpy as np


class ModelUnavailable(RuntimeError):
    pass


def run_matswap(original: np.ndarray, mask: np.ndarray, material: np.ndarray, seed: int = 0) -> np.ndarray:
    raise ModelUnavailable('MatSwap is not installed on this worker (requires an NVIDIA GPU).')
