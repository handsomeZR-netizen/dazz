import { createGLRenderer } from './gl.js';
import { createCPURenderer } from './cpu.js';

// 优先 WebGL2，失败回退 Canvas2D。返回值带 .kind ∈ {'gl', 'cpu'}。
export function createRenderer(canvas) {
  const gl = createGLRenderer(canvas);
  if (gl) return gl;
  console.warn('WebGL2 不可用，使用 CPU 渲染');
  return createCPURenderer(canvas);
}

export { NOISE_SIZE } from './noise.js';
