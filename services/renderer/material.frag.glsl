#version 300 es
// Exact material renderer, all maths in linear light. For each pixel of the surface:
//   1. map the pixel to real millimetres on the surface (3D plane or four-corner homography)
//   2. lay the material out at its physical size and repeat mode, with joints drawn in mm
//   3. light it with the illumination recovered from the original photo, plus restrained GGX
// Output alpha 0 means "not on this surface" — the caller keeps the original pixel.
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uAlbedo;   // SRGB8_ALPHA8 — the GPU converts samples to linear light
uniform sampler2D uLight;    // rgb = illumination x 0.5 (linear), a = contact-shadow detail x 0.5
uniform sampler2D uRoom;     // original photo (SRGB8_ALPHA8), for debug views
uniform sampler2D uNormalMap;    // optional tangent-space normal map (OpenGL: +y up), linear
uniform sampler2D uRoughnessMap; // optional roughness map (red channel), linear
uniform int uHasNormalMap;
uniform int uHasRoughnessMap;
uniform float uOrientation;  // material rotation (radians) applied to its maps
uniform vec2 uImageSize;

uniform int uGeometry;       // 0 = homography, 1 = 3D plane
uniform mat3 uImageToPlane;  // homography: image px -> plane mm
uniform vec3 uPlaneN;
uniform vec3 uPlaneO;
uniform vec3 uAxisU;
uniform vec3 uAxisV;
uniform vec4 uIntrinsics;    // fx, fy, cx, cy as fractions of image width/height
uniform float uScale;        // calibration correction

uniform vec2 uTileMm;        // real size of one copy of the albedo
uniform int uRepeat;         // 0 seamless, 1 sheet, 2 tile, 3 plank, 4 bookmatch, 5 none
uniform float uJointMm;
uniform vec3 uJointColor;    // linear
uniform float uToneVariation;
uniform float uRoughness;
uniform float uMetallic;
uniform float uNormalStrength;
uniform vec3 uLightDir;      // camera space, towards the dominant light
uniform int uDebug;          // 0 none, 1 layout grid, 2 recovered lighting

const float PI = 3.14159265;
const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
// Share of specular kept: the photo's real lights are unknown and usually soft
const float SPECULAR_STRENGTH = 0.35;

float hash(vec2 c, float salt) {
  return fract(sin(dot(c, vec2(127.1, 311.7)) + salt * 74.7) * 43758.5453);
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// Highlight roll-off: linear up to SHOULDER, then compressed smoothly towards white instead of
// clipping. A light material under a lamp pool that lit a dark wall can be several times over
// range; hard clipping turns that into flat white blotches. Scaled per pixel by its brightest
// channel, so hue is kept.
const float SHOULDER = 0.8;
vec3 rollOffHighlights(vec3 c) {
  float peak = max(c.r, max(c.g, c.b));
  if (peak <= SHOULDER) return c;
  float span = 1.0 - SHOULDER;
  float mapped = SHOULDER + span * (1.0 - exp(-(peak - SHOULDER) / span));
  return c * (mapped / peak);
}

vec3 cameraRay(vec2 px) {
  vec2 f = px / uImageSize;
  return vec3((f.x - uIntrinsics.z) / uIntrinsics.x, (f.y - uIntrinsics.w) / uIntrinsics.y, 1.0);
}

// Surface position in mm (xy); z = 0 when the pixel's ray misses the plane
vec3 planeMm(vec2 px) {
  if (uGeometry == 1) {
    vec3 r = cameraRay(px);
    float d = dot(uPlaneN, r);
    if (abs(d) < 1e-6) return vec3(0.0);
    float t = dot(uPlaneN, uPlaneO) / d;
    if (t <= 0.0) return vec3(0.0);
    vec3 p = r * t - uPlaneO;
    return vec3(dot(p, uAxisU) * 1000.0 * uScale, dot(p, uAxisV) * 1000.0 * uScale, 1.0);
  }
  vec3 h = uImageToPlane * vec3(px, 1.0);
  if (abs(h.z) < 1e-9) return vec3(0.0);
  return vec3(h.xy / h.z * uScale, 1.0);
}

void main() {
  vec2 px = vUv * uImageSize;
  vec3 pm = planeMm(px);
  vec2 mm = pm.xy;
  // All derivatives up front, before any divergent branch
  vec2 grid = mm / uTileMm;
  vec2 dgx = dFdx(grid);
  vec2 dgy = dFdy(grid);
  float pixelMm = max(length(dFdx(mm)), length(dFdy(mm)));
  if (pm.z == 0.0) {
    outColor = vec4(0.0);
    return;
  }

  if (uRepeat == 3) {
    // Planks: each row shifted by its own random offset
    grid.x += hash(vec2(0.0, floor(grid.y)), 5.0);
  }
  vec2 cell = floor(grid);
  vec2 local = grid - cell;
  vec2 st = local;
  vec2 gx = dgx;
  vec2 gy = dgy;
  float tone = 1.0;
  vec2 mirror = vec2(1.0); // -1 where the layout mirrors a cell (normals must flip with it)

  if (uRepeat == 0) {
    st = grid; // continuous: the albedo was made seamless
  } else if (uRepeat == 1 || uRepeat == 3) {
    // Each sheet/plank mirrored at random so neighbours never match
    if (hash(cell, 2.0) < 0.5) {
      st.x = 1.0 - st.x;
      gx.x = -gx.x;
      gy.x = -gy.x;
      mirror.x = -1.0;
    }
  } else if (uRepeat == 4) {
    // Book-matched: mirrored in pairs across both axes
    if (mod(cell.x, 2.0) >= 1.0) { st.x = 1.0 - st.x; gx.x = -gx.x; gy.x = -gy.x; mirror.x = -1.0; }
    if (mod(cell.y, 2.0) >= 1.0) { st.y = 1.0 - st.y; gx.y = -gx.y; gy.y = -gy.y; mirror.y = -1.0; }
  } else if (uRepeat == 5 && cell != vec2(0.0)) {
    outColor = vec4(0.0);
    return;
  }
  bool jointed = uRepeat == 1 || uRepeat == 2 || uRepeat == 3;
  if (jointed) tone = 1.0 + (hash(cell, 3.0) - 0.5) * 2.0 * uToneVariation;

  vec2 edgeMm = min(local, 1.0 - local) * uTileMm;
  float edgeDist = min(edgeMm.x, edgeMm.y);

  if (uDebug == 1) {
    vec3 room = texture(uRoom, vUv).rgb;
    float line = 1.0 - smoothstep(0.0, pixelMm * 1.5, edgeDist);
    outColor = vec4(linearToSrgb(mix(room, vec3(0.2, 0.75, 1.0), line * 0.9)), 1.0);
    return;
  }

  vec3 albedo = textureGrad(uAlbedo, st, gx, gy).rgb * tone;

  // Surface relief as a slope along the layout's u (right) and v (down) axes: from the
  // vendor's normal map when there is one, else a conservative estimate from the albedo
  vec2 bump;
  if (uHasNormalMap == 1) {
    vec3 nm = textureGrad(uNormalMap, st, gx, gy).xyz * 2.0 - 1.0;
    vec2 slope = vec2(-nm.x, nm.y) / max(nm.z, 0.2); // OpenGL +y up -> image v down
    float c = cos(uOrientation);
    float s = sin(uOrientation);
    slope = vec2(c * slope.x - s * slope.y, s * slope.x + c * slope.y) * mirror;
    bump = slope * (0.5 + uNormalStrength);
  } else {
    vec2 texel = 1.0 / vec2(textureSize(uAlbedo, 0));
    float h0 = dot(albedo, LUM);
    float hx = dot(textureGrad(uAlbedo, st + vec2(texel.x * 2.0, 0.0), gx, gy).rgb * tone, LUM);
    float hy = dot(textureGrad(uAlbedo, st + vec2(0.0, texel.y * 2.0), gx, gy).rgb * tone, LUM);
    bump = vec2(hx - h0, hy - h0) * uNormalStrength * 4.0;
  }
  float roughness = uHasRoughnessMap == 1 ? textureGrad(uRoughnessMap, st, gx, gy).r : uRoughness;

  vec3 ray = cameraRay(px);
  vec3 N = uGeometry == 1 ? uPlaneN : vec3(0.0, 0.0, -1.0);
  if (dot(N, ray) > 0.0) N = -N;
  vec3 T = uGeometry == 1 ? uAxisU : vec3(1.0, 0.0, 0.0);
  vec3 B = uGeometry == 1 ? uAxisV : vec3(0.0, 1.0, 0.0);
  vec3 Nb = normalize(N - bump.x * T - bump.y * B);

  vec4 lt = texture(uLight, vUv);
  vec3 illum = lt.rgb * 2.0;
  float detail = lt.a * 2.0;

  if (uDebug == 2) {
    outColor = vec4(linearToSrgb(illum * detail * 0.5), 1.0);
    return;
  }

  // Restrained GGX specular towards the dominant light
  vec3 V = -normalize(ray);
  vec3 L = normalize(uLightDir);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(Nb, L), 0.0);
  float NdotV = max(dot(Nb, V), 1e-3);
  float NdotH = max(dot(Nb, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);
  float a = max(roughness * roughness, 0.02);
  float a2 = a * a;
  float dTerm = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dTerm * dTerm);
  float k = a * 0.5;
  float G = (NdotL / (NdotL * (1.0 - k) + k)) * (NdotV / (NdotV * (1.0 - k) + k));
  vec3 F0 = mix(vec3(0.04), albedo, uMetallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdotH, 5.0);
  vec3 spec = D * G * F / (4.0 * NdotL * NdotV + 1e-4) * NdotL;
  float lightLevel = dot(illum, LUM);

  vec3 diffuse = albedo * (1.0 - uMetallic) * illum * detail;
  // Metals mostly reflect their surroundings; approximate that with the recovered light
  vec3 metalAmbient = F0 * illum * detail * uMetallic * 0.8;
  vec3 color = diffuse + metalAmbient + spec * lightLevel * detail * SPECULAR_STRENGTH;

  if (jointed && uJointMm > 0.0) {
    // Recessed joints take the joint colour and sit in shadow
    float cover = 1.0 - smoothstep(uJointMm * 0.5 - pixelMm * 0.5, uJointMm * 0.5 + pixelMm * 0.5, edgeDist);
    color = mix(color, uJointColor * illum * detail * 0.6, cover);
  }

  outColor = vec4(linearToSrgb(rollOffHighlights(color)), 1.0);
}
