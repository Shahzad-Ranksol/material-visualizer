import vertexSource from './material.vert.glsl?raw';
import fragmentSource from './material.frag.glsl?raw';

export class WebGLUnavailableError extends Error {
  constructor() {
    super('This browser cannot render materials (WebGL2 is unavailable). Please use a current Chrome, Edge, Safari or Firefox.');
  }
}

interface MaterialGL {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
  maxAnisotropy: number;
  anisotropyExt: EXT_texture_filter_anisotropic | null;
}

let shared: MaterialGL | null = null;

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
};

/** The one WebGL2 context the renderer reuses across renders. */
export const getMaterialGL = (): MaterialGL => {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new WebGLUnavailableError();

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const anisotropyExt = gl.getExtension('EXT_texture_filter_anisotropic');
  const locations = new Map<string, WebGLUniformLocation | null>();
  shared = {
    gl,
    canvas,
    program,
    uniform: (name) => {
      if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
      return locations.get(name)!;
    },
    anisotropyExt,
    maxAnisotropy: anisotropyExt ? gl.getParameter(anisotropyExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1,
  };
  return shared;
};

type TexSource = TexImageSource | { data: Uint8Array; width: number; height: number };

/**
 * Uploads a texture. `srgb` textures are stored as SRGB8_ALPHA8 so every sample (and every
 * mip level) is filtered in linear light; `repeat` textures get mipmaps + anisotropic filtering.
 */
export const createTexture = (m: MaterialGL, source: TexSource, opts: { srgb: boolean; repeat: boolean }): WebGLTexture => {
  const { gl } = m;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const internal = opts.srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
  if ('data' in source) {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  const wrap = opts.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  if (opts.repeat) {
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    if (m.anisotropyExt) gl.texParameterf(gl.TEXTURE_2D, m.anisotropyExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, m.maxAnisotropy));
  } else {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  }
  return tex;
};

export type UniformValue =
  | { type: 'int'; value: number }
  | { type: 'float'; value: number }
  | { type: 'vec2' | 'vec3' | 'vec4'; value: number[] }
  | { type: 'mat3'; value: number[] }; // column-major

/** Draws the full-screen pass at w x h and returns RGBA bytes, top image row first. */
export const drawPass = (
  m: MaterialGL,
  w: number,
  h: number,
  textures: Record<string, WebGLTexture>,
  uniforms: Record<string, UniformValue>
): Uint8Array => {
  const { gl, canvas } = m;
  const maxSize = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
  if (w > maxSize[0] || h > maxSize[1]) throw new Error(`Photo is too large to render (${w}x${h}); the limit here is ${maxSize[0]}x${maxSize[1]}.`);
  canvas.width = w;
  canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(m.program);

  Object.entries(textures).forEach(([name, tex], unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(m.uniform(name), unit);
  });
  for (const [name, u] of Object.entries(uniforms)) {
    const loc = m.uniform(name);
    if (!loc) continue;
    if (u.type === 'int') gl.uniform1i(loc, u.value);
    else if (u.type === 'float') gl.uniform1f(loc, u.value);
    else if (u.type === 'vec2') gl.uniform2fv(loc, u.value);
    else if (u.type === 'vec3') gl.uniform3fv(loc, u.value);
    else if (u.type === 'vec4') gl.uniform4fv(loc, u.value);
    else gl.uniformMatrix3fv(loc, false, u.value);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const out = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
  return out;
};

export const deleteTexture = (m: MaterialGL, tex: WebGLTexture) => m.gl.deleteTexture(tex);
