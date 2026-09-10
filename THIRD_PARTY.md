# Third-party notices

This environment uses public oceanographic models and MIT-licensed technique references.

## Mathematics (public literature)

- Jerry Tessendorf, *Simulating Ocean Water* (SIGGRAPH course, 2001) — FFT displacement, choppiness, Jacobian foam.
- Hasselmann et al., JONSWAP spectrum (1973); Pierson–Moskowitz; Phillips spectrum.
- Preetham, Shirley & Smits, *A Practical Analytic Model for Daylight* (1999) — via Three.js `Sky`.
- Cook–Torrance / GGX microfacet BRDF (public).

## Implementation references (MIT)

FFT butterfly packing, cascade idea, and water PBR structure were studied from:

- [squall01337/abyssal-ocean](https://github.com/squall01337/abyssal-ocean) — MIT, Copyright (c) 2026 Sacha
- [achrefelouafi/OceanThreejs](https://github.com/achrefelouafi/OceanThreejs) — MIT, Copyright (c) 2026 mohamedachrefelouafi
- [jbouny/fft-ocean](https://github.com/jbouny/fft-ocean) — MIT

The shaders and modules in `src/` were written for this project (structured simulation API, Mumbai-like world, wind vs current split). They are not a copy of those repositories.

## Runtime

- [three.js](https://github.com/mrdoob/three.js) — MIT
- [lil-gui](https://github.com/georgealways/lil-gui) — MIT
