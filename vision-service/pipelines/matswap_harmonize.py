"""Low-frequency lighting harmonisation (rendering plan, section 7).

    H       = low_pass(log(R_ai + eps) - log(R_exact + eps))      inside the mask
    H       = clamp(H, -0.25, +0.25)
    R_final = exp(log(R_exact + eps) + strength * H)

Only the smooth lighting difference of the AI render is kept; product detail and every pixel
outside the mask come from the exact render. Mirrors services/renderer/studioLighting.ts.
"""
from __future__ import annotations

import numpy as np

EPS = 1e-3
MAX_LOG_CHANGE = 0.25
# Mean colour change above this means the AI altered the product, not the light
MAX_MEAN_DRIFT = 0.18
LOW_PASS_CELLS = 40


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    c = c.astype(np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0.0, 1.0)
    s = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.round(s * 255).astype(np.uint8)


def _cell_means(diff: np.ndarray, inside: np.ndarray, cell: int) -> tuple[np.ndarray, np.ndarray]:
    h, w, _ = diff.shape
    gh, gw = -(-h // cell), -(-w // cell)
    sums = np.zeros((gh, gw, 3))
    counts = np.zeros((gh, gw))
    ys, xs = np.nonzero(inside)
    np.add.at(sums, (ys // cell, xs // cell), diff[ys, xs])
    np.add.at(counts, (ys // cell, xs // cell), 1)
    means = np.divide(sums, counts[..., None], out=np.zeros_like(sums), where=counts[..., None] > 0)
    return means, counts


def _upsample(grid: np.ndarray, h: int, w: int, cell: int) -> np.ndarray:
    gh, gw, _ = grid.shape
    fy = np.clip((np.arange(h) + 0.5) / cell - 0.5, 0, gh - 1.0001)
    fx = np.clip((np.arange(w) + 0.5) / cell - 0.5, 0, gw - 1.0001)
    y0, x0 = fy.astype(int), fx.astype(int)
    y1, x1 = np.minimum(y0 + 1, gh - 1), np.minimum(x0 + 1, gw - 1)
    ty, tx = (fy - y0)[:, None, None], (fx - x0)[None, :, None]
    top = grid[y0][:, x0] * (1 - tx) + grid[y0][:, x1] * tx
    bottom = grid[y1][:, x0] * (1 - tx) + grid[y1][:, x1] * tx
    return top * (1 - ty) + bottom * ty


def harmonize(exact: np.ndarray, ai: np.ndarray, mask: np.ndarray, strength: float = 1.0) -> np.ndarray | None:
    """exact/ai: HxWx3 uint8 sRGB; mask: HxW float in [0, 1]. None = AI drifted, keep exact."""
    if exact.shape != ai.shape:
        return None
    h, w, _ = exact.shape
    cell = max(4, round(max(h, w) / LOW_PASS_CELLS))
    lin_exact = srgb_to_linear(exact)
    diff = np.log(srgb_to_linear(ai) + EPS) - np.log(lin_exact + EPS)
    means, counts = _cell_means(diff, mask >= 0.5, cell)
    filled = counts > 0
    if not filled.any():
        return None
    # Hue drift: channels changing differently means the colour changed, not just the light
    avg = means.mean(axis=2, keepdims=True)
    drift = (np.abs(means - avg).sum(axis=2) * counts)[filled].sum() / counts[filled].sum()
    if drift > MAX_MEAN_DRIFT:
        return None
    H = _upsample(np.clip(means, -MAX_LOG_CHANGE, MAX_LOG_CHANGE), h, w, cell)
    harmonized = np.exp(np.log(lin_exact + EPS) + strength * H) - EPS
    a = mask[..., None]
    out = linear_to_srgb(lin_exact * (1 - a) + harmonized * a)
    # Outside the surface the exact render is kept byte-for-byte
    out[mask <= 0] = exact[mask <= 0]
    return out
