#version 300 es
// Full-screen quad. vUv.y = 0 on the framebuffer's bottom row, which readPixels returns first,
// so pixels come back in image order (top row first) and image textures need no flip.
in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
