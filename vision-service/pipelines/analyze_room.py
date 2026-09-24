"""Quality-mode room analysis (SAM 3.1 + MoGe-3) — placeholder for the Phase 3 benchmark.

The production analysis runs in the browser (SegFormer-B2 + SAM 2.1 Tiny + MoGe-2 ViT-S, see
workers/analysis.worker.ts). This module is where a GPU worker would run the larger models and
return the same SurfaceAnalysis contract, once benchmarked against the browser pipeline.
"""


def analyze_room(*_args, **_kwargs):
    raise NotImplementedError('Quality-mode analysis needs a GPU host with SAM 3.1 and MoGe-3 installed.')
