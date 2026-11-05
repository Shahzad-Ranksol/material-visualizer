"""
Bakes each scene photo's light, once and offline: Marigold-IID "lighting" (prs-eth, OpenRAIL++
weights, Apache-2.0 code) splits the photo into albedo × diffuse shading + a non-diffuse residual
(reflections, highlights), all in linear light. The studio then renders a finish as
new albedo × shading + residual: the photo's real shadows, sun and window light stay, the old
surface's own colour and grain go. No model runs in the browser.

Writes, for every scene and every baked design style (on the photo with its patch drawn in):
  public/scenes/<scene>/shading.png      sRGB-encoded (linear shading × the scene's shadingScale)
  public/scenes/<scene>/reflection.png   sRGB-encoded linear residual
  public/scenes/<scene>/styles/<key>/shading.png, reflection.png   the style's rect, with the
      patch's own alpha so it is drawn over the scene's layers exactly like the patch
and scenes/intrinsics.json listing them.

  npm run scenes:intrinsic [-- scene|scene/styleKey …]
"""
import json
import os
import sys
import time

import numpy as np
import torch
from diffusers import MarigoldIntrinsicsPipeline
from PIL import Image

ROOT = os.getcwd()
# Shading is stored × a per-scene scale (in scenes/intrinsics.json, read by the renderer): 0.5 —
# light up to twice a white sheet's — unless the scene's light is brighter (direct sun outdoors),
# then small enough that its brightest 0.1% still fits. A scene's styles use the scene's scale
DEFAULT_SHADING_SCALE = 0.5


def shading_scale(shading):
    peak = float(np.percentile(shading.max(axis=2), 99.9))
    return min(DEFAULT_SHADING_SCALE, 0.98 / max(peak, 1e-6))
MODEL = os.environ.get("INTRINSIC_MODEL", "prs-eth/marigold-iid-lighting-v1-1")
# Marigold's working resolution (longest side); outputs are resized back to the photo
RESOLUTION = int(os.environ.get("INTRINSIC_RES", "1024"))
STEPS = int(os.environ.get("INTRINSIC_STEPS", "4"))
ENSEMBLE = int(os.environ.get("INTRINSIC_ENSEMBLE", "1"))
# Context kept around a style's rect when decomposing it
MARGIN = 48


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


def srgb_decode(s):
    return np.where(s <= 0.04045, s / 12.92, np.power((s + 0.055) / 1.055, 2.4))


def to_png(lin, path, alpha=None):
    rgb = (srgb_encode(lin) * 255 + 0.5).astype(np.uint8)
    if alpha is not None:
        rgb = np.dstack([rgb, alpha])
    Image.fromarray(rgb).save(path, optimize=True)


def load_pipe():
    # The half-size fp16 weights (2.6 GB instead of 5.2), computed in fp32 (CPUs need it)
    pipe = MarigoldIntrinsicsPipeline.from_pretrained(MODEL, variant="fp16", torch_dtype=torch.float32)
    pipe.set_progress_bar_config(disable=True)
    return pipe


def decompose(pipe, rgb8):
    """rgb8: HxWx3 uint8 photo → (albedo, shading, residual), linear HxWx3 float, photo-sized."""
    h, w = rgb8.shape[:2]
    out = pipe(
        Image.fromarray(rgb8),
        num_inference_steps=STEPS,
        ensemble_size=ENSEMBLE,
        processing_resolution=RESOLUTION,
        match_input_resolution=True,
        generator=torch.Generator().manual_seed(0),
    )
    pred = np.asarray(out.prediction)  # (targets, H, W, 3) in [0, 1]
    names = list(pipe.target_properties["target_names"])
    layers = {}
    for k, name in enumerate(names):
        v = pred[k]
        space = pipe.target_properties.get(name, {}).get("space", "linear")
        layers[name] = srgb_decode(v) if space == "srgb" else v
    albedo, shading, residual = layers["albedo"], layers["shading"], layers["residual"]
    assert shading.shape[:2] == (h, w), (shading.shape, (h, w))
    # Marigold's three layers are each normalised on their own; rescale the shading so
    # albedo × shading + residual reproduces the photo (least squares over the image)
    photo = srgb_decode(rgb8.astype(np.float64) / 255)
    diffuse = np.clip(photo - residual, 0, None)
    ab = albedo * shading
    scale = float((ab * diffuse).sum() / max(1e-9, (ab * ab).sum()))
    shading = shading * scale
    err = np.abs(albedo * shading + residual - photo).mean()
    # Reflections of white light are colourless; the model's residual also carries some of the
    # surface's own colour (a teal door's residual is teal), which would tint every new finish.
    # Keep only its brightness
    lum = residual @ np.array([0.2126, 0.7152, 0.0722])
    residual = np.repeat(lum[:, :, None], 3, axis=2)
    return albedo, shading, residual, err


def photo_path(scene):
    d = os.path.join(ROOT, "public", "scenes", scene)
    for f in ("photo.png", "photo.jpg"):
        if os.path.exists(os.path.join(d, f)):
            return os.path.join(d, f)
    raise FileNotFoundError(d)


def main():
    styles = json.load(open(os.path.join(ROOT, "scenes", "styles.baked.json")))
    index_path = os.path.join(ROOT, "scenes", "intrinsics.json")
    index = json.load(open(index_path)) if os.path.exists(index_path) else {}
    scenes_dir = os.path.join(ROOT, "public", "scenes")
    scenes = sorted(s for s in os.listdir(scenes_dir) if any(os.path.exists(os.path.join(scenes_dir, s, f)) for f in ("photo.png", "photo.jpg")))
    wanted = sys.argv[1:]
    jobs = []
    for scene in scenes:
        if not wanted or scene in wanted:
            jobs.append((scene, None))
        for key in sorted(styles.get(scene, {})):
            if not wanted or scene in wanted or f"{scene}/{key}" in wanted:
                jobs.append((scene, key))

    pipe = load_pipe()
    print(f"{MODEL}: {len(jobs)} job(s), {RESOLUTION}px, {STEPS} steps, ensemble {ENSEMBLE}", flush=True)
    for scene, key in jobs:
        t0 = time.time()
        photo = np.asarray(Image.open(photo_path(scene)).convert("RGB"))
        base = f"/scenes/{scene}"
        entry = index.setdefault(scene, {"styles": {}})
        if key is None:
            _, shading, residual, err = decompose(pipe, photo)
            entry["shadingScale"] = round(shading_scale(shading), 4)
            d = os.path.join(ROOT, "public", "scenes", scene)
            to_png(shading * entry["shadingScale"], os.path.join(d, "shading.png"))
            to_png(residual, os.path.join(d, "reflection.png"))
            entry["shading"] = f"{base}/shading.png"
            entry["reflection"] = f"{base}/reflection.png"
            entry["size"] = [photo.shape[1], photo.shape[0]]
        else:
            bake = styles[scene][key]
            r = bake["rect"]
            patch = Image.open(os.path.join(ROOT, "public", bake["patch"].split("?")[0].lstrip("/"))).convert("RGBA").resize((r["w"], r["h"]), Image.LANCZOS)
            composed = Image.fromarray(photo).convert("RGBA")
            composed.alpha_composite(patch, (r["x"], r["y"]))
            composed = np.asarray(composed.convert("RGB"))
            h, w = composed.shape[:2]
            x0, y0 = max(0, r["x"] - MARGIN), max(0, r["y"] - MARGIN)
            x1, y1 = min(w, r["x"] + r["w"] + MARGIN), min(h, r["y"] + r["h"] + MARGIN)
            _, shading, residual, err = decompose(pipe, np.ascontiguousarray(composed[y0:y1, x0:x1]))
            cx, cy = r["x"] - x0, r["y"] - y0
            crop = lambda a: a[cy : cy + r["h"], cx : cx + r["w"]]
            alpha = np.asarray(patch)[:, :, 3]
            d = os.path.join(ROOT, "public", "scenes", scene, "styles", key)
            assert "shadingScale" in entry, f"bake {scene} itself before its styles"
            to_png(crop(shading) * entry["shadingScale"], os.path.join(d, "shading.png"), alpha)
            to_png(crop(residual), os.path.join(d, "reflection.png"), alpha)
            entry["styles"][key] = {"shading": f"{base}/styles/{key}/shading.png", "reflection": f"{base}/styles/{key}/reflection.png"}
        clipped = float((shading * entry["shadingScale"] > 1).mean())
        print(f"  {scene}{'/' + key if key else ''}: reconstruction error {err:.4f}, shading clipped {clipped:.2%}, {time.time() - t0:.0f}s", flush=True)
        with open(index_path, "w") as f:
            json.dump(index, f, indent=2, sort_keys=True)
            f.write("\n")


if __name__ == "__main__":
    main()
