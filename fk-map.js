/*
 * F/k parameter-space map for the Gray-Scott reaction-diffusion sim.
 * Pure JS, no DOM/WebGL — computed on a tiny CPU grid so it also runs in Node for tests.
 *
 * Each cell of the map runs a miniature Gray-Scott sim with that cell's (f, k)
 * and is classified by what survives: dead, uniform, holes/packed, worms, or
 * solitons/mitosis. The result is a real computed regime map, not a drawing.
 */
"use strict";

(function (root) {
  const F_MIN = 0.005, F_MAX = 0.110;
  const K_MIN = 0.030, K_MAX = 0.075;

  // Run a tiny Gray-Scott sim (lattice, seeds, iterations) with the given f/k.
  // Returns the final B-field as a Float32Array of size w*h.
  function runTiny(f, k, w, h, iters, rng) {
    rng = rng || Math.random;
    const DA = 1.0, DB = 0.5;
    let a = new Float32Array(w * h).fill(1.0);
    let b = new Float32Array(w * h);
    let a2 = new Float32Array(w * h);
    let b2 = new Float32Array(w * h);
    // a few random seeds of B
    for (let s = 0; s < 4; s++) {
      const cx = Math.floor(rng() * w), cy = Math.floor(rng() * h);
      for (let y = cy - 2; y <= cy + 2; y++)
        for (let x = cx - 2; x <= cx + 2; x++) {
          const i = ((y + h) % h) * w + ((x + w) % w);
          b[i] = 1.0;
        }
    }
    for (let t = 0; t < iters; t++) {
      for (let y = 0; y < h; y++) {
        const ym = ((y - 1 + h) % h) * w, yp = ((y + 1) % h) * w, y0 = y * w;
        for (let x = 0; x < w; x++) {
          const xm = (x - 1 + w) % w, xp = (x + 1) % w;
          const i = y0 + x;
          const la = -a[i]
            + 0.2 * (a[y0 + xm] + a[y0 + xp] + a[ym + x] + a[yp + x])
            + 0.05 * (a[ym + xm] + a[ym + xp] + a[yp + xm] + a[yp + xp]);
          const lb = -b[i]
            + 0.2 * (b[y0 + xm] + b[y0 + xp] + b[ym + x] + b[yp + x])
            + 0.05 * (b[ym + xm] + b[ym + xp] + b[yp + xm] + b[yp + xp]);
          const bb = a[i] * b[i] * b[i];
          a2[i] = a[i] + (DA * la - bb + f * (1 - a[i]));
          b2[i] = b[i] + (DB * lb + bb - (f + k) * b[i]);
        }
      }
      const ta = a; a = a2; a2 = ta;
      const tb = b; b = b2; b2 = tb;
    }
    return b;
  }

  // Classify a final B-field into a regime class:
  // 0 dead, 1 uniform, 2 packed/holes, 3 worms/stripes, 4 spots/solitons
  function classify(b, w, h) {
    let alive = 0, sum = 0, sumSq = 0, edge = 0;
    const n = w * h;
    for (let i = 0; i < n; i++) {
      const v = b[i];
      if (v > 0.15) alive++;
      sum += v; sumSq += v * v;
    }
    const mean = sum / n;
    if (alive / n < 0.01) return 0;                    // dead
    const variance = sumSq / n - mean * mean;
    // edge density: mean |gradient| as a rough texture measure
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        edge += Math.abs(b[i + 1] - b[i - 1]) + Math.abs(b[i + w] - b[i - w]);
      }
    edge /= (w - 2) * (h - 2);
    if (variance < 0.005) return 1;                    // uniform fill
    if (edge > 0.10) return 3;                         // worms / stripes
    if (alive / n > 0.35) return 2;                    // packed spots / holes
    return 4;                                          // sparse solitons
  }

  // Colors per class (RGB 0-255): dark, gray, blue, ember-orange, yellow
  const CLASS_COLORS = [
    [16, 14, 20],
    [90, 86, 100],
    [46, 96, 200],
    [235, 120, 40],
    [245, 200, 60],
  ];

  // Compute the full map. Returns { width, height, classes: Uint8Array, colors: Uint8ClampedArray }
  function computeMap(width, height, opts) {
    opts = opts || {};
    const cellW = opts.cell || 14, cellH = opts.cell || 14;
    const iters = opts.iters || 300;
    const rng = opts.rng || Math.random;
    const classes = new Uint8Array(width * height);
    const colors = new Uint8ClampedArray(width * height * 4);
    for (let j = 0; j < height; j++) {
      const k = K_MIN + (1 - j / (height - 1)) * (K_MAX - K_MIN);
      for (let i = 0; i < width; i++) {
        const f = F_MIN + (i / (width - 1)) * (F_MAX - F_MIN);
        const cls = classify(runTiny(f, k, cellW, cellH, iters, rng), cellW, cellH);
        classes[j * width + i] = cls;
        const c = CLASS_COLORS[cls];
        const o = (j * width + i) * 4;
        colors[o] = c[0]; colors[o + 1] = c[1]; colors[o + 2] = c[2]; colors[o + 3] = 255;
      }
    }
    return { width, height, classes, colors };
  }

  const api = {
    F_MIN, F_MAX, K_MIN, K_MAX,
    runTiny, classify, computeMap,
    CLASS_COLORS,
    // Map a data-space (f, k) to normalized [0,1] map coords (y up).
    toMapCoords: (f, k) => ({
      x: (f - F_MIN) / (F_MAX - F_MIN),
      y: (k - K_MIN) / (K_MAX - K_MIN),
    }),
    // Map normalized map coords back to data-space (f, k).
    toParams: (x, y) => ({
      f: F_MIN + x * (F_MAX - F_MIN),
      k: K_MIN + y * (K_MAX - K_MIN),
    }),
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FkMap = api;
})(typeof self !== "undefined" ? self : this);
