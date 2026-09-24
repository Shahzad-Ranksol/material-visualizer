import base64
import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

import app as service
from pipelines.matswap_harmonize import harmonize


def _img(value, size=(40, 60)):
    return np.full((*size, 3), value, dtype=np.uint8)


def _mask(size=(40, 60)):
    m = np.zeros(size)
    m[10:30, 15:45] = 1.0
    return m


def test_identical_ai_changes_nothing():
    exact = _img(120)
    assert np.array_equal(harmonize(exact, exact.copy(), _mask()), exact)


def test_outside_mask_is_byte_identical():
    exact = np.random.default_rng(1).integers(0, 255, (40, 60, 3), dtype=np.uint8)
    ai = np.clip(exact.astype(int) + 20, 0, 255).astype(np.uint8)
    out = harmonize(exact, ai, _mask())
    outside = _mask() == 0
    assert np.array_equal(out[outside], exact[outside])


def test_brightening_is_clamped():
    exact = _img(100)
    ai = _img(255)  # far brighter than +0.25 in log space
    out = harmonize(exact, ai, _mask())
    inside = out[20, 30].astype(float)
    # exp(0.25) ~ 1.28x linear light: well below full white
    assert inside.max() < 140


def test_hue_drift_is_rejected():
    exact = _img(128)
    ai = exact.copy()
    ai[..., 0] = 250  # the AI turned the product red
    assert harmonize(exact, ai, _mask()) is None


def _b64(arr, mode='RGB'):
    buf = io.BytesIO()
    Image.fromarray(arr if mode == 'RGB' else (arr * 255).astype(np.uint8)).save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


def test_api_returns_501_without_the_model():
    client = TestClient(service.app)
    img = _img(120)
    payload = {'original': _b64(img), 'exact': _b64(img), 'mask': _b64(_mask(), 'L'), 'material': _b64(img)}
    res = client.post('/harmonize', json=payload)
    assert res.status_code == 501


def test_api_validates_sizes():
    client = TestClient(service.app)
    payload = {'original': _b64(_img(1)), 'exact': _b64(_img(1, (10, 10))), 'mask': _b64(_mask(), 'L'), 'material': _b64(_img(1))}
    assert client.post('/harmonize', json=payload).status_code == 400
