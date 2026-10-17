/*
 * Tests for the F/k parameter-space map (fk-map.js). Node-only, no deps.
 * Run: node test-fk-map.js
 */
"use strict";
const { runTiny, classify, computeMap, toMapCoords, toParams, F_MIN, F_MAX, K_MIN, K_MAX } = require("./fk-map.js");
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("PASS " + name);
  else { failures++; console.error("FAIL " + name + (detail ? " — " + detail : "")); }
}

// deterministic rng
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1. runTiny returns finite values in [0,1] and stable at classic worm params
{
  const rng = mulberry32(42);
  const b = runTiny(0.078, 0.061, 24, 24, 200, rng); // "worms"
  let ok = true, alive = 0;
  for (const v of b) {
    if (!Number.isFinite(v) || v < 0 || v > 1) ok = false;
    if (v > 0.15) alive++;
  }
  check("runTiny finite & bounded", ok);
  check("worms params produce living pattern", alive > 24 * 24 * 0.05, "alive=" + alive);
}

// 2. dead regime: high f with high k kills everything
{
  const rng = mulberry32(7);
  const b = runTiny(0.11, 0.075, 16, 16, 250, rng);
  let alive = 0;
  for (const v of b) if (v > 0.15) alive++;
  check("dead corner classified as dead", classify(b, 16, 16) === 0, "alive=" + alive);
}

// 3. coordinate round-trip
{
  const p = toParams(toMapCoords(0.037, 0.060).x, toMapCoords(0.037, 0.060).y);
  check("toMapCoords/toParams round-trip", Math.abs(p.f - 0.037) < 1e-9 && Math.abs(p.k - 0.060) < 1e-9);
  check("map bounds", F_MIN < F_MAX && K_MIN < K_MAX);
}

// 4. full map computes and every cell gets a valid class
{
  const map = computeMap(10, 6, { cell: 10, iters: 120, rng: mulberry32(1) });
  let ok = true;
  for (const c of map.classes) if (c < 0 || c > 4) ok = false;
  check("computeMap classes valid", ok);
  check("computeMap colors sized", map.colors.length === 10 * 6 * 4);
}

process.exit(failures ? 1 : 0);
