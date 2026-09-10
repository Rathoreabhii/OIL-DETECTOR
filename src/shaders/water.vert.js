import { MAX_GERSTNER } from '../ocean/Gerstner.js';

export const WATER_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uPatchSizes;
uniform vec3 uCascadeWeight;
uniform float uChoppiness;
uniform float uTime;
uniform vec2 uModelOffset;
uniform sampler2D uHf;
uniform vec2 uHfOrigin;
uniform float uHfDomain;
uniform float uHfScale;
uniform vec2 uGerstnerDir[${MAX_GERSTNER}];
uniform vec4 uGerstnerParams[${MAX_GERSTNER}];

varying vec3 vWorldPos;
varying vec2 vWorldXZ;
varying vec3 vGerstnerNormal;
varying float vFftHeight;
varying vec3 vCascadeW;

void main() {
  vec2 worldXZ = position.xz + uModelOffset;

  float dist = length(cameraPosition.xz - worldXZ);
  vec3 cw = uCascadeWeight;
  cw.y *= smoothstep(9000.0, 2200.0, dist);
  cw.z *= smoothstep(1800.0, 350.0, dist);
  vCascadeW = cw;

  vec3 disp = vec3(0.0);
  vec4 d0 = texture2D(uDisp0, worldXZ / uPatchSizes.x);
  vec4 d1 = texture2D(uDisp1, worldXZ / uPatchSizes.y);
  vec4 d2 = texture2D(uDisp2, worldXZ / uPatchSizes.z);
  disp.y += d0.r * cw.x + d1.r * cw.y + d2.r * cw.z;
  disp.x += (d0.g * cw.x + d1.g * cw.y + d2.g * cw.z) * uChoppiness;
  disp.z += (d0.b * cw.x + d1.b * cw.y + d2.b * cw.z) * uChoppiness;
  vFftHeight = disp.y;

  vec2 hfUv = (worldXZ - uHfOrigin) / uHfDomain + 0.5;
  float hf = 0.0;
  if (hfUv.x > 0.0 && hfUv.x < 1.0 && hfUv.y > 0.0 && hfUv.y < 1.0) {
    hf = texture2D(uHf, hfUv).r * uHfScale;
  }
  disp.y += hf;

  vec3 g = vec3(0.0);
  vec3 gN = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < ${MAX_GERSTNER}; i++) {
    vec4 P = uGerstnerParams[i];
    float k = P.x;
    if (k <= 0.0) continue;
    vec2 D = uGerstnerDir[i];
    float A = P.y;
    float Q = P.z;
    float w = P.w;
    float phase = k * dot(D, worldXZ) - w * uTime;
    float c = cos(phase);
    float s = sin(phase);
    g.x += Q * A * D.x * c;
    g.z += Q * A * D.y * c;
    g.y += A * s;
    float WA = k * A;
    gN.x -= D.x * WA * c;
    gN.z -= D.y * WA * c;
    gN.y -= Q * WA * s;
  }

  disp = clamp(disp, vec3(-12.0), vec3(12.0));
  g = clamp(g, vec3(-8.0), vec3(8.0));

  vec3 displaced = vec3(
    worldXZ.x + disp.x + g.x,
    disp.y + g.y,
    worldXZ.y + disp.z + g.z
  );

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vWorldPos = world.xyz;
  vWorldXZ = worldXZ;
  vGerstnerNormal = gN;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;
