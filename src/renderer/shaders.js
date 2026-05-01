export const VS_SOURCE = `#version 300 es
precision mediump float;
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
out vec2 vVideoUv;
uniform vec2 uUvOffset;
uniform vec2 uUvScale;
uniform float uMirror;
void main() {
  vUv = aUv;
  vec2 uv = aUv;
  if (uMirror > 0.5) uv.x = 1.0 - uv.x;
  vVideoUv = uUvOffset + uv * uUvScale;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const FS_SOURCE = `#version 300 es
precision mediump float;
uniform sampler2D uVideo;
uniform sampler2D uLut;
uniform sampler2D uNoise;
uniform sampler2D uLut3D;     // 切片纹理：宽 = N*N，高 = N，z 切片横排
uniform float uUse3DLut;      // > 0.5 启用 3D LUT
uniform float uLutSize;       // N
uniform float uStrength;
uniform float uGrainAmp;
uniform float uVignette;
uniform float uLeak;
uniform float uMono;
uniform vec2  uNoiseShift;
uniform vec2  uResolution;
uniform vec2  uUvOffset;
uniform vec2  uUvScale;
uniform float uMirror;
uniform float uHalation;
uniform float uFisheye;
uniform float uFlash;
in vec2 vUv;
in vec2 vVideoUv;
out vec4 outColor;

vec2 sampleUv(vec2 sUv) {
  if (uMirror > 0.5) sUv.x = 1.0 - sUv.x;
  return uUvOffset + sUv * uUvScale;
}

// 在指定 z 切片（整数 zi）上，按 (r, g) 体素坐标采一次。
// 切片纹理布局：行 y = g/(N-1)（y → 像素中心需 +0.5/N）；列 x = (zi*N + r 像素位置 + 0.5) / (N*N)
// xy 维度交给 GL 的 LINEAR 自动双线性。
vec3 sampleSlice(float zi, float r01, float g01, float invN, float invNN) {
  // 像素中心校正：r 在切片内对应 (r*(N-1) + 0.5) / N 列，转换成全图 u：
  //   u = (zi + (r*(N-1) + 0.5) / N) * invN  =  (zi*invN) + (r*(N-1) + 0.5) * invNN
  // 这里把 r*(N-1)+0.5 写成 r*N*invN*N... 用 (r * (N-1) + 0.5) / (N*N)
  float Nf = 1.0 / invN;
  float u = zi * invN + (r01 * (Nf - 1.0) + 0.5) * invNN;
  float v = (g01 * (Nf - 1.0) + 0.5) * invN;
  return texture(uLut3D, vec2(u, v)).rgb;
}

vec3 applyLut3D(vec3 src) {
  float Nf = uLutSize;
  float invN = 1.0 / Nf;
  float invNN = 1.0 / (Nf * Nf);
  // z = b 在 [0..N-1] 索引上的位置（不是像素位置；切片号是整数）
  float zf = clamp(src.b, 0.0, 1.0) * (Nf - 1.0);
  float z0 = floor(zf);
  float z1 = min(Nf - 1.0, z0 + 1.0);
  float fz = zf - z0;
  vec3 c0 = sampleSlice(z0, src.r, src.g, invN, invNN);
  vec3 c1 = sampleSlice(z1, src.r, src.g, invN, invNN);
  return mix(c0, c1, fz);
}

void main() {
  vec2 sUv = vUv;
  if (uFisheye > 0.001) {
    vec2 d = sUv - 0.5;
    float r2 = dot(d, d);
    sUv = sUv + d * r2 * uFisheye * 0.9;
  }
  vec2 vidUv = (uFisheye > 0.001) ? sampleUv(sUv) : vVideoUv;

  vec3 src = texture(uVideo, vidUv).rgb;
  vec3 c;
  if (uUse3DLut > 0.5) {
    c = applyLut3D(src);
  } else if (uMono > 0.5) {
    float y = dot(src, vec3(0.299, 0.587, 0.114));
    float v = texture(uLut, vec2(y, 0.5)).r;
    c = vec3(v);
  } else {
    c = vec3(
      texture(uLut, vec2(src.r, 0.5)).r,
      texture(uLut, vec2(src.g, 0.5)).g,
      texture(uLut, vec2(src.b, 0.5)).b
    );
  }

  vec2 vd = vUv - 0.5;
  float vr = length(vd) * 1.41421356;
  float vt = max(0.0, (vr - 0.55) / 0.45);
  c *= (1.0 - uVignette * vt * vt);

  if (uLeak > 0.5) {
    vec2 lc = vec2(1.05, -0.05);
    float ld = length(vUv - lc) / 0.85;
    float lt = max(0.0, 1.0 - ld);
    float lk = lt * lt * 0.55;
    c += vec3(60.0, 22.0, 28.0) * lk / 255.0;
  }

  if (uHalation > 0.001) {
    float h = 0.014;
    vec3 s1 = texture(uVideo, sampleUv(sUv + vec2( h, 0))).rgb;
    vec3 s2 = texture(uVideo, sampleUv(sUv + vec2(-h, 0))).rgb;
    vec3 s3 = texture(uVideo, sampleUv(sUv + vec2(0,  h))).rgb;
    vec3 s4 = texture(uVideo, sampleUv(sUv + vec2(0, -h))).rgb;
    vec3 avg = (s1 + s2 + s3 + s4) * 0.25;
    float lum = dot(avg, vec3(0.299, 0.587, 0.114));
    float bloom = smoothstep(0.65, 1.0, lum);
    c += vec3(0.85, 0.32, 0.10) * bloom * uHalation;
  }

  if (uFlash > 0.001) {
    vec2 fd = vUv - 0.5;
    float fr2 = dot(fd, fd);
    float fmask = exp(-fr2 * 4.5);
    c += vec3(0.95, 0.85, 0.7) * fmask * uFlash;
  }

  vec2 nuv = (vUv * uResolution / 256.0) + uNoiseShift;
  float n = texture(uNoise, nuv).r;
  c += (n - 0.5) * 2.0 * uGrainAmp / 255.0;

  c = mix(src, c, uStrength);
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;
