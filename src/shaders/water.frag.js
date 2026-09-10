export const WATER_FRAG = /* glsl */ `
precision highp float;

#define PI 3.141592653589793

varying vec3 vWorldPos;
varying vec2 vWorldXZ;
varying vec3 vGerstnerNormal;
varying float vFftHeight;
varying vec3 vCascadeW;

uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform vec3 uPatchSizes;
uniform vec3 uCascadeWeight;
uniform float uChoppiness;
uniform float uTime;

uniform float uRoughness;
uniform float uSpecular;
uniform float uIor;
uniform float uReflectionIntensity;
uniform float uNormalScale;
uniform float uMicroDetail;

uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uScatterColor;
uniform float uAbsorption;
uniform float uScattering;

uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform vec3 uHorizonColor;
uniform vec3 uZenithColor;
uniform float uCloudiness;

uniform vec2 uCurrent; // water transport (m/s) in XZ — NOT wind
uniform float uCurrentInfluence;
uniform sampler2D uHf;
uniform vec2 uHfOrigin;
uniform float uHfDomain;
uniform float uHfScale;
uniform float uFoamAmount;

uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uExposure;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

vec3 sampleCascadeDeriv(sampler2D disp, sampler2D deriv, vec2 xz, float tile, float w, inout vec2 slope, inout float dDxdx, inout float dDzdz, inout float dDxdz) {
  vec2 uv = xz / tile;
  vec4 d0 = texture2D(disp, uv);
  vec4 d1 = texture2D(deriv, uv);
  slope += vec2(d0.a, d1.r) * w;
  float wc = w * uChoppiness;
  dDxdx += d1.g * wc;
  dDzdz += d1.b * wc;
  dDxdz += d1.a * wc;
  return d0.rgb;
}

float skyClouds(vec3 dir) {
  if (dir.y <= 0.02) return 0.0;
  vec2 uv = dir.xz / max(dir.y, 0.02);
  uv = uv * 0.42 + uTime * 0.004;
  float d = fbm(uv) * 0.72 + fbm(uv * 3.2 - uTime * 0.008) * 0.28;
  float cover = mix(0.58, 0.32, clamp(uCloudiness, 0.0, 1.0));
  float c = smoothstep(cover, cover + 0.24, d);
  return c * smoothstep(0.0, 0.28, dir.y);
}

vec3 proceduralSky(vec3 dir) {
  float up = clamp(dir.y, -1.0, 1.0);
  vec3 zenith = uZenithColor;
  vec3 horizon = uHorizonColor;
  vec3 ground = mix(horizon, uDeepColor, 0.7);
  vec3 col;
  if (up >= 0.0) col = mix(horizon, zenith, pow(up, 0.45));
  else col = mix(horizon, ground, clamp(-up * 3.2, 0.0, 1.0));

  float sd = max(dot(normalize(dir), uSunDirection), 0.0);
  float cl = skyClouds(dir);
  vec3 cloudLit = mix(vec3(0.70, 0.76, 0.86), vec3(1.08, 0.98, 0.88), 0.55 + 0.45 * sd);
  col = mix(col, cloudLit, cl * 0.88);

  float disk = smoothstep(0.9994, 0.99985, sd);
  float glow = pow(sd, 180.0) * 0.35 + pow(sd, 12.0) * 0.12;
  col += uSunColor * min(uSunIntensity, 2.5) * (disk * 2.2 + glow) * (1.0 - cl * 0.65);
  return col;
}

vec3 microNormal(vec2 p, float freq, vec2 flow, float t, float amp) {
  float e = 0.32 / freq;
  vec2 q = p * freq + flow * t;
  float h = fbm(q);
  float hx = fbm(q + vec2(e, 0.0));
  float hz = fbm(q + vec2(0.0, e));
  vec2 g = vec2(hx - h, hz - h) / e;
  return normalize(vec3(-g.x * amp, 1.0, -g.y * amp));
}

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = (NoH * NoH) * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float G_Smith(float NoV, float NoL, float a) {
  float k = a * a * 0.5;
  return (NoV / (NoV * (1.0 - k) + k)) * (NoL / (NoL * (1.0 - k) + k));
}
vec3 F_Schlick(float cosT, vec3 F0) {
  return F0 + (1.0 - F0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

void main() {
  vec2 slope = vec2(0.0);
  float dDxdx = 0.0;
  float dDzdz = 0.0;
  float dDxdz = 0.0;
  sampleCascadeDeriv(uDisp0, uDeriv0, vWorldXZ, uPatchSizes.x, vCascadeW.x, slope, dDxdx, dDzdz, dDxdz);
  sampleCascadeDeriv(uDisp1, uDeriv1, vWorldXZ, uPatchSizes.y, vCascadeW.y, slope, dDxdx, dDzdz, dDxdz);
  sampleCascadeDeriv(uDisp2, uDeriv2, vWorldXZ, uPatchSizes.z, vCascadeW.z, slope, dDxdx, dDzdz, dDxdz);

  vec3 nFft = normalize(vec3(-slope.x * uNormalScale, 1.0, -slope.y * uNormalScale));
  vec3 nG = normalize(vGerstnerNormal);
  vec3 N = normalize(vec3(
    nFft.x + nG.x / max(nG.y, 0.05),
    1.0,
    nFft.z + nG.z / max(nG.y, 0.05)
  ));

  vec2 hfUv = (vWorldXZ - uHfOrigin) / uHfDomain + 0.5;
  if (hfUv.x > 0.002 && hfUv.x < 0.998 && hfUv.y > 0.002 && hfUv.y < 0.998) {
    float e = 1.5 / uHfDomain;
    float hL = texture2D(uHf, hfUv - vec2(e, 0.0)).r;
    float hR = texture2D(uHf, hfUv + vec2(e, 0.0)).r;
    float hD = texture2D(uHf, hfUv - vec2(0.0, e)).r;
    float hU = texture2D(uHf, hfUv + vec2(0.0, e)).r;
    vec3 nHf = normalize(vec3(-(hR - hL) * uHfScale * 18.0, 1.0, -(hU - hD) * uHfScale * 18.0));
    N = normalize(vec3(N.x + nHf.x, 1.0, N.z + nHf.z));
  }

  // Current advects micro-chop and stretches ripples along transport.
  vec2 flow = uCurrent * (0.18 + 0.55 * uCurrentInfluence);
  vec3 dA = microNormal(vWorldXZ, 0.22, flow + vec2(0.55, -0.32), uTime, 1.0);
  vec3 dB = microNormal(vWorldXZ, 0.72, flow * 1.4 + vec2(-0.28, 0.62), uTime, 1.0);
  N = normalize(vec3(N.x + dA.x * uMicroDetail * 0.45, 1.0, N.z + dA.z * uMicroDetail * 0.45));
  N = normalize(vec3(N.x + dB.x * uMicroDetail * 0.28, 1.0, N.z + dB.z * uMicroDetail * 0.28));

  if (length(uCurrent) > 0.02 && uCurrentInfluence > 0.01) {
    vec2 cdir = normalize(uCurrent);
    vec2 perp = vec2(-cdir.y, cdir.x);
    float along = dot(vWorldXZ, cdir);
    float across = dot(vWorldXZ, perp);
    vec2 q = vec2(along * 0.07 - length(uCurrent) * uTime * 0.35, across * 0.32);
    float streak = fbm(q) - 0.5;
    N = normalize(vec3(N.x + perp.x * streak * uCurrentInfluence * 0.22, 1.0, N.z + perp.y * streak * uCurrentInfluence * 0.22));
  }

  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDirection);
  vec3 H = normalize(V + L);
  float NoV = max(dot(N, V), 1e-3);
  float NoL = max(dot(N, L), 0.0);
  float NoH = max(dot(N, H), 0.0);
  float VoH = max(dot(V, H), 0.0);

  float f0s = (1.0 - uIor) / (1.0 + uIor);
  vec3 F0 = vec3(f0s * f0s);
  float fresnel = clamp(0.02 + 0.98 * pow(1.0 - NoV, 5.0), 0.0, 1.0);
  fresnel = mix(fresnel, 1.0, 0.08);
  fresnel *= uReflectionIntensity;

  vec3 R = reflect(-V, N);
  vec3 reflection = proceduralSky(normalize(R));

  // Open-ocean colour: darker looking down, more scatter at grazing angles.
  float grazing = pow(1.0 - NoV, 1.6);
  float path = mix(70.0, 160.0, grazing);
  vec3 extinction = vec3(0.55, 0.14, 0.08) * uAbsorption;
  vec3 trans = exp(-extinction * path * 0.04);
  vec3 waterBody = mix(uDeepColor, uShallowColor, grazing * 0.22);
  vec3 inscatter = mix(uScatterColor, uDeepColor, clamp(path / 90.0, 0.0, 1.0));
  vec3 refraction = waterBody * trans + inscatter * (1.0 - trans) * uScattering;

  float crest = clamp(vFftHeight * 0.35 + 0.5, 0.0, 1.0);
  refraction += uScatterColor * pow(crest, 3.0) * (NoL * 0.5 + 0.5) * 0.1 * uScattering;

  float a = max(uRoughness * uRoughness, 1e-3);
  float D = D_GGX(NoH, a);
  float Gf = G_Smith(NoV, NoL, a);
  vec3 Fs = F_Schlick(VoH, F0);
  vec3 specular = (D * Gf * Fs) / max(4.0 * NoV * NoL, 1e-3) * NoL;
  specular *= uSunColor * uSunIntensity * uSpecular;

  vec3 color = mix(refraction, reflection, fresnel);
  color += specular;
  color += refraction * NoL * 0.04 * uSunColor;

  float glint = pow(max(dot(normalize(R), L), 0.0), 220.0);
  float sparkle = smoothstep(0.42, 0.9, fbm(vWorldXZ * 1.6 + uTime * 0.32 + flow * uTime));
  float sunPath = pow(max(dot(normalize(vec3(-V.x, 0.0, -V.z)), L), 0.0), 8.0);
  color += uSunColor * glint * sparkle * uSunIntensity * 2.8 * uSpecular;
  color += uSunColor * sunPath * (0.12 + 0.22 * sparkle) * uSunIntensity * 0.35;

  float jacobian = (1.0 + dDxdx) * (1.0 + dDzdz) - dDxdz * dDxdz;
  float fold = smoothstep(0.72, 0.28, jacobian);
  float foamNoise = fbm(vWorldXZ * 0.35 + uTime * 0.08 + flow * uTime * 0.5);
  float crestFoam = clamp(length(slope) * 0.45, 0.0, 1.0);
  float foam = clamp(fold * foamNoise * 0.85 + crestFoam * 0.25, 0.0, 1.0);
  foam *= uFoamAmount;
  vec3 foamCol = mix(vec3(0.88, 0.93, 0.98), uSunColor, 0.12);
  color = mix(color, foamCol, foam * 0.72);

  float dist = length(cameraPosition.xz - vWorldPos.xz);
  float haze = 1.0 - exp(-uFogDensity * dist);
  haze = clamp(haze * 0.35, 0.0, 0.45);
  color = mix(color, uFogColor, haze);

  float horizon = smoothstep(12000.0, 30000.0, dist);
  vec3 skyH = proceduralSky(normalize(vec3(-V.x, 0.08, -V.z)));
  color = mix(color, skyH, horizon * 0.85);

  color *= uExposure;
  gl_FragColor = vec4(clamp(color, 0.0, 6.0), 1.0);
}
`;
