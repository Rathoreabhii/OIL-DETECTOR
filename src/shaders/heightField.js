export const HF_UPDATE = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 uCurrent;
uniform float uDt;
uniform float uDomain;
uniform float uSpeed;
uniform float uDamping;
uniform float uTime;
uniform float uForce;
uniform float uN;

void main() {
  vec2 texel = vec2(1.0 / uN);
  vec2 flow = uCurrent / max(uDomain, 1.0) * uDt;
  vec2 uv = vUv - flow;

  float h = texture(uState, uv).r;
  float vel = texture(uState, uv).g;
  float n = texture(uState, uv + vec2(0.0, texel.y)).r;
  float s = texture(uState, uv - vec2(0.0, texel.y)).r;
  float e = texture(uState, uv + vec2(texel.x, 0.0)).r;
  float w = texture(uState, uv - vec2(texel.x, 0.0)).r;
  float lap = n + s + e + w - 4.0 * h;

  vel += lap * uSpeed;
  vel *= uDamping;
  h += vel;

  vec2 wpos = (vUv - 0.5) * uDomain;
  vec2 cdir = length(uCurrent) > 1e-4 ? normalize(uCurrent) : vec2(1.0, 0.0);
  float travel = sin(dot(wpos, cdir) * 0.085 - uTime * 1.15);
  h += travel * uForce * uDt;

  gl_FragColor = vec4(h, vel, 0.0, 1.0);
}
`;

export const HF_DROP = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uState;
uniform vec2 uCenter;
uniform float uRadius;
uniform float uStrength;

void main() {
  vec4 c = texture(uState, vUv);
  float d = length(vUv - uCenter);
  float drop = max(0.0, 1.0 - d / max(uRadius, 1e-4));
  drop = drop * drop * (3.0 - 2.0 * drop);
  c.r += drop * uStrength;
  gl_FragColor = c;
}
`;
