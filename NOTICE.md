# Third-Party Code Notices

This project bundles code from the following upstream projects.

## cubejs (`vendor/cubejs-1.3.2.js`)

- Source: https://github.com/ldez/cubejs
- License: **MIT** (and dual GPLv3 for the original min2phase port)
- Purpose: 3×3 Kociemba two-phase solver, used as the 3×3 step both directly and inside the 4×4 reduction pipeline.

## csTimer 4×4 scrambler / solver (`vendor/cstimer-444.js`)

- Source: https://github.com/cs0x7f/cstimer (file `src/js/scramble/scramble_444.js` and required parts of `src/js/mathlib.js`)
- License: **GPL-3.0**
- Author: Shuang Chen (cs0x7f)
- Purpose: 4×4 reduction solver (three-phase reduction + 3×3 finish). This is the primary 4×4 solver used by this project.

Because csTimer is GPL-3.0 only, **this project as a whole is distributed under GPL-3.0** (see `LICENSE`).

## Three.js + OrbitControls

- Source: https://github.com/mrdoob/three.js (r128, inlined in cube*.html)
- License: **MIT**

---

If the GPL-3.0 obligation ever becomes inconvenient, the 4×4 solver can be re-vendored from cs0x7f's
[TPR-4x4x4-Solver](https://github.com/cs0x7f/TPR-4x4x4-Solver) (dual MIT/GPL) compiled fresh via GWT
or J2CL — see `CLAUDE.md` for the architectural note on swapping solver adapters.
