import { z } from 'zod';

// Request validation for showcase hotspots and surfaces (kept free of DB imports so it can be
// unit-tested on its own).

export const hotspotSchema = z.object({
  label: z.string().min(1).max(191),
  xPct: z.number().min(0).max(100),
  yPct: z.number().min(0).max(100),
  allowedCategories: z.array(z.string().min(1)).min(1),
  // The analysed surface this hotspot re-surfaces (must belong to the same image); null unlinks it
  surfaceId: z.string().min(1).nullable().optional(),
});

const httpUrl = z.string().url().max(2048).regex(/^https?:\/\//i, 'Must be an http(s) URL');
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const planePoint = z.object({ xPct: z.number().min(-50).max(150), yPct: z.number().min(-50).max(150) });

// Geometry of a surface: a fitted 3D plane (camera space, metres) with the camera intrinsics it
// was fitted under, and/or the four-corner homography fallback the vendor can edit by hand
export const planeSchema = z
  .object({
    normal: vec3.optional(),
    origin: vec3.optional(),
    axisU: vec3.optional(),
    axisV: vec3.optional(),
    residual: z.number().min(0).optional(),
    // Focal lengths and principal point as fractions of image width/height
    intrinsics: z.object({ fx: z.number().positive(), fy: z.number().positive(), cx: z.number(), cy: z.number() }).optional(),
    homographyFallback: z.object({ corners: z.array(planePoint).length(4), heightMm: z.number().min(100).max(100000) }).optional(),
  })
  .refine((p) => (p.normal && p.origin && p.axisU && p.axisV) || p.homographyFallback, {
    message: 'A plane needs either a fitted 3D plane or a four-corner fallback',
  });

export const surfaceSchema = z.object({
  kind: z.enum(['wall', 'floor', 'ceiling', 'cabinet', 'countertop', 'door', 'furniture', 'custom']),
  label: z.string().min(1).max(191),
  maskUrl: httpUrl,
  occluderMaskUrl: httpUrl.nullable().optional(),
  analysisVersion: z.string().min(1).max(64),
  modelVersions: z.record(z.string()).optional(),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  plane: planeSchema.nullable().optional(),
  // Two image points (fractions of width/height) a known real distance apart
  calibration: z
    .object({ p1: z.tuple([z.number(), z.number()]), p2: z.tuple([z.number(), z.number()]), distanceMm: z.number().positive() })
    .nullable()
    .optional(),
  lightingMapUrl: httpUrl.nullable().optional(),
  // Another surface of the same image this one is an extra plane of
  parentSurfaceId: z.string().min(1).nullable().optional(),
});

