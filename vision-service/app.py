"""Studio Lighting worker API. Called only by the Node API (never by browsers directly)."""
from __future__ import annotations

import base64
import io
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image
from pydantic import BaseModel, Field

from models import ModelUnavailable, run_matswap
from pipelines.matswap_harmonize import harmonize

app = FastAPI(title='material-visualizer vision-service')


def _decode(b64: str, mode: str) -> np.ndarray:
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(b64))).convert(mode))


def _encode(img: np.ndarray) -> str:
    buf = io.BytesIO()
    Image.fromarray(img).save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode()


class HarmonizeRequest(BaseModel):
    original: str = Field(description='Original room photo, base64 PNG/JPEG')
    exact: str = Field(description='Exact render, base64 PNG')
    mask: str = Field(description='Surface mask, base64 PNG (white = surface)')
    material: str = Field(description='Material albedo, base64 PNG/JPEG')
    strength: float = Field(1.0, ge=0, le=1)
    seed: int = 0


class HarmonizeResponse(BaseModel):
    image: Optional[str]
    applied: bool
    reason: str


@app.get('/health')
def health() -> dict:
    return {'ok': True}


@app.post('/harmonize', response_model=HarmonizeResponse)
def harmonize_endpoint(req: HarmonizeRequest) -> HarmonizeResponse:
    original = _decode(req.original, 'RGB')
    exact = _decode(req.exact, 'RGB')
    mask = _decode(req.mask, 'L').astype(np.float64) / 255.0
    material = _decode(req.material, 'RGB')
    if exact.shape[:2] != mask.shape or exact.shape != original.shape:
        raise HTTPException(status_code=400, detail='original, exact and mask must have the same size')
    try:
        ai = run_matswap(original, mask, material, seed=req.seed)
    except ModelUnavailable as err:
        raise HTTPException(status_code=501, detail=str(err)) from err
    result = harmonize(exact, ai, mask, req.strength)
    if result is None:
        return HarmonizeResponse(image=None, applied=False, reason='AI result drifted from the product; exact render kept')
    return HarmonizeResponse(image=_encode(result), applied=True, reason='ok')
