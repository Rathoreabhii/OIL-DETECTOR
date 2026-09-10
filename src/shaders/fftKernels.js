const COMMON = /* glsl */ `
#define PI 3.141592653589793
const float G = 9.81;
vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}
vec2 packFG(vec2 F, vec2 G) {
  return vec2(F.x - G.y, F.y + G.x);
}
`;

export const SPECTRUM_UPDATE = /* glsl */ `
${COMMON}
varying vec2 vUv;

uniform sampler2D uH0;
uniform float uTime;
uniform float uN;
uniform float uL;
uniform float uWaveSpeed;
uniform vec2 uCurrent;
uniform int uTarget;

void main() {
  float N = uN;
  vec2 id = floor(vUv * N);
  vec2 m = id - N * 0.5;
  vec2 k = (2.0 * PI / uL) * m;
  float kLen = length(k);
  vec2 khat = kLen > 1e-6 ? k / kLen : vec2(0.0);

  vec4 h0data = texture(uH0, vUv);
  vec2 h0 = h0data.xy;
  vec2 h0mkConj = vec2(h0data.z, -h0data.w);

  // Intrinsic dispersion + Doppler from CURRENT (transport), not wind.
  float sigma = sqrt(G * max(kLen, 1e-8));
  float w = (sigma + dot(k, uCurrent)) * uWaveSpeed;

  float c = cos(w * uTime);
  float s = sin(w * uTime);
  vec2 h = cmul(h0, vec2(c, s)) + cmul(h0mkConj, vec2(c, -s));
  vec2 ih = vec2(-h.y, h.x);

  if (uTarget == 0) {
    vec2 Dy = h;
    vec2 Dx = -khat.x * ih;
    vec2 Dz = -khat.y * ih;
    vec2 dDydx = k.x * ih;
    gl_FragColor = vec4(packFG(Dy, Dx), packFG(Dz, dDydx));
  } else {
    vec2 dDydz = k.y * ih;
    vec2 dDxdx = (kLen > 1e-6 ? k.x * k.x / kLen : 0.0) * h;
    vec2 dDzdz = (kLen > 1e-6 ? k.y * k.y / kLen : 0.0) * h;
    vec2 dDxdz = (kLen > 1e-6 ? k.x * k.y / kLen : 0.0) * h;
    gl_FragColor = vec4(packFG(dDydz, dDxdx), packFG(dDzdz, dDxdz));
  }
}
`;

export const BUTTERFLY = /* glsl */ `
${COMMON}

uniform sampler2D uButterfly;
uniform sampler2D uSource;
uniform int uStage;
uniform int uDirection;

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  int axis = (uDirection == 0) ? coord.x : coord.y;
  vec4 bf = texelFetch(uButterfly, ivec2(uStage, axis), 0);
  vec2 w = bf.xy;
  int ia = int(bf.z);
  int ib = int(bf.w);

  ivec2 ca = (uDirection == 0) ? ivec2(ia, coord.y) : ivec2(coord.x, ia);
  ivec2 cb = (uDirection == 0) ? ivec2(ib, coord.y) : ivec2(coord.x, ib);

  vec4 p = texelFetch(uSource, ca, 0);
  vec4 q = texelFetch(uSource, cb, 0);
  gl_FragColor = vec4(p.rg + cmul(w, q.rg), p.ba + cmul(w, q.ba));
}
`;

export const PERMUTATION = /* glsl */ `
${COMMON}

uniform sampler2D uSource;
uniform float uN;

void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 data = texelFetch(uSource, c, 0);
  float sgn = ((c.x + c.y) & 1) == 0 ? 1.0 : -1.0;
  gl_FragColor = data * (sgn / (uN * uN));
}
`;
