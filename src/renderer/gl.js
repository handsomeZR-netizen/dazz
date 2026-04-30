import { VS_SOURCE, FS_SOURCE } from './shaders.js';
import { NOISE_SIZE, noiseUnsigned } from './noise.js';

export function createGLRenderer(cvs) {
  const gl = cvs.getContext('webgl2', {
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!gl) return null;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('shader compile:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, VS_SOURCE);
  const fs = compile(gl.FRAGMENT_SHADER, FS_SOURCE);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  // pos / uv（uv y 翻转，对齐 video texture y 轴）
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 1,
     1, -1, 1, 1,
    -1,  1, 0, 0,
     1,  1, 1, 0,
  ]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUv = gl.getAttribLocation(prog, 'aUv');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

  const u = {};
  for (const name of [
    'uVideo', 'uLut', 'uNoise', 'uStrength', 'uGrainAmp', 'uVignette',
    'uLeak', 'uMono', 'uNoiseShift', 'uResolution', 'uUvOffset', 'uUvScale',
    'uMirror', 'uHalation', 'uFisheye', 'uFlash',
  ]) {
    u[name] = gl.getUniformLocation(prog, name);
  }

  const videoTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, videoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(256 * 4));

  const noiseTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, noiseTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, noiseUnsigned);

  gl.uniform1i(u.uVideo, 0);
  gl.uniform1i(u.uLut, 1);
  gl.uniform1i(u.uNoise, 2);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  return {
    kind: 'gl',
    gl,
    setSize(w, h) {
      gl.viewport(0, 0, w, h);
    },
    setPreset(p) {
      const lutData = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        lutData[i * 4 + 0] = p.lutR[i];
        lutData[i * 4 + 1] = p.lutG[i];
        lutData[i * 4 + 2] = p.lutB[i];
        lutData[i * 4 + 3] = 255;
      }
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lutTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutData);
    },
    // source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap
    draw(source, opts) {
      const { uvOffset, uvScale, mirror, strength, preset, noiseShift, w, h, effects } = opts;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);

      gl.uniform1f(u.uStrength, strength);
      gl.uniform1f(u.uGrainAmp, preset.grainAmp);
      gl.uniform1f(u.uVignette, preset.vignette);
      gl.uniform1f(u.uLeak, preset.leak ? 1.0 : 0.0);
      gl.uniform1f(u.uMono, preset.mono ? 1.0 : 0.0);
      gl.uniform2f(u.uNoiseShift, noiseShift[0], noiseShift[1]);
      gl.uniform2f(u.uResolution, w, h);
      gl.uniform2f(u.uUvOffset, uvOffset[0], uvOffset[1]);
      gl.uniform2f(u.uUvScale, uvScale[0], uvScale[1]);
      gl.uniform1f(u.uMirror, mirror ? 1.0 : 0.0);
      gl.uniform1f(u.uHalation, effects?.halation || 0);
      gl.uniform1f(u.uFisheye, effects?.fisheye || 0);
      gl.uniform1f(u.uFlash, effects?.flash || 0);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}
