export const VS_SOURCE = `#version 300 es
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
  if (uMono > 0.5) {
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
