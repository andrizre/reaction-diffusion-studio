/*
 * Reaction-Diffusion Studio
 * Gray-Scott reaction-diffusion on WebGL ping-pong framebuffers.
 * Pure browser, no dependencies, no network.
 */
"use strict";

// ---------------------------------------------------------------- shaders

const VERT = `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// Gray-Scott step. Two RG channels: r = A (feed), g = B (kill/activator).
const STEP_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uState;
uniform vec2 uTexel;      // 1/sim size
uniform float uF, uK;
uniform float uDA, uDB;   // diffusion rates

void main() {
  vec2 c = texture2D(uState, vUV).rg;
  vec2 lap = -c;
  lap += texture2D(uState, vUV + vec2( uTexel.x, 0.0)).rg * 0.2;
  lap += texture2D(uState, vUV + vec2(-uTexel.x, 0.0)).rg * 0.2;
  lap += texture2D(uState, vUV + vec2(0.0,  uTexel.y)).rg * 0.2;
  lap += texture2D(uState, vUV + vec2(0.0, -uTexel.y)).rg * 0.2;
  lap += texture2D(uState, vUV + uTexel).rg * 0.05;
  lap += texture2D(uState, vUV - uTexel).rg * 0.05;
  lap += texture2D(uState, vUV + vec2( uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture2D(uState, vUV + vec2(-uTexel.x,  uTexel.y)).rg * 0.05;

  float a = c.r, b = c.g;
  float abb = a * b * b;
  vec2 next = vec2(
    a + (uDA * lap.r - abb + uF * (1.0 - a)),
    b + (uDB * lap.g + abb - (uF + uK) * b)
  );
  gl_FragColor = vec4(clamp(next, 0.0, 1.0), 0.0, 1.0);
}
`;

// Seed brush: splat B value into the state texture.
const SPLAT_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uState;
uniform vec2 uPoint;      // in UV
uniform float uRadius;    // in UV units
uniform float uValue;

void main() {
  vec2 c = texture2D(uState, vUV).rg;
  float d = distance(vUV, uPoint);
  float mask = 1.0 - smoothstep(uRadius * 0.6, uRadius, d);
  // soft noise inside the brush avoids perfectly circular artifacts
  float n = fract(sin(dot(vUV * 913.37, vec2(12.9898, 78.233))) * 43758.5453);
  c.g = mix(c.g, uValue, mask * (0.85 + 0.15 * n));
  gl_FragColor = vec4(c, 0.0, 1.0);
}
`;

// Display: map B concentration through a palette.
const DRAW_FRAG = `
precision highp float;
varying vec2 vUV;
uniform sampler2D uState;
uniform int uPalette;

vec3 pal0(float t) { // ember
  return vec3(smoothstep(0.1, 0.9, t), pow(t, 1.6) * 0.9, t * t * 0.8);
}
vec3 pal1(float t) { // ice
  return vec3(t * t, smoothstep(0.05, 0.8, t), 0.9 * smoothstep(0.0, 0.5, t) + 0.1);
}
vec3 pal2(float t) { // acid
  return vec3(t * 1.1, t * t, 1.0 - smoothstep(0.0, 0.4, t));
}
vec3 pal3(float t) { // mono
  return vec3(t);
}
vec3 pal4(float t) { // magma-ish
  return vec3(smoothstep(0.0, 0.7, t), 0.4 * t, t * 0.55 + 0.35 * (1.0 - t));
}
vec3 pal5(float t) { // neon grid feel
  return vec3(0.5 + 0.5 * sin(6.28 * (t + 0.0)),
              0.5 + 0.5 * sin(6.28 * (t + 0.33)),
              0.5 + 0.5 * sin(6.28 * (t + 0.67)));
}

void main() {
  float b = texture2D(uState, vUV).g;
  float t = clamp((b - 0.10) / 0.45, 0.0, 1.0);
  vec3 col;
  if (uPalette == 0) col = pal0(t);
  else if (uPalette == 1) col = pal1(t);
  else if (uPalette == 2) col = pal2(t);
  else if (uPalette == 3) col = pal3(t);
  else if (uPalette == 4) col = pal4(t);
  else col = pal5(t);
  // subtle vignette
  vec2 q = vUV - 0.5;
  col *= 1.0 - 0.35 * dot(q, q);
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ setup

const SIM_W = 512, SIM_H = 320;
const canvas = document.getElementById("view");
const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true });
if (!gl) {
  document.body.innerHTML = "<p style='padding:2em'>WebGL is not available in this browser.</p>";
  throw new Error("no webgl");
}

function compile(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const progStep = program(STEP_FRAG);
const progSplat = program(SPLAT_FRAG);
const progDraw = program(DRAW_FRAG);

const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
function bindQuad(prog) {
  const loc = gl.getAttribLocation(prog, "aPos");
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}

// ping-pong state textures (RGBA where r=A, g=B)
function makeState(fillB) {
  const data = new Float32Array(SIM_W * SIM_H * 4);
  // A=1 everywhere, B=0
  for (let i = 0; i < SIM_W * SIM_H; i++) {
    data[i * 4] = 1.0;
    data[i * 4 + 1] = 0.0;
    data[i * 4 + 2] = 0.0;
    data[i * 4 + 3] = 1.0;
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // need floating point textures for stability
  const ext = gl.getExtension("OES_texture_float");
  if (!ext) throw new Error("OES_texture_float unsupported");
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIM_W, SIM_H, 0, gl.RGBA, gl.FLOAT, data);
  return tex;
}

function makeFBO(tex) {
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error("incomplete FBO (float render targets unsupported)");
  return fbo;
}

let texA = makeState(0.0);
let texB = makeState(0.0);
let fboA = makeFBO(texA);
let fboB = makeFBO(texB);

// ------------------------------------------------------------------ state

const params = {
  f: 0.037, k: 0.060, iters: 12, palette: 0,
  paused: false, brushValue: 1.0, // 1 = seed B, 0 = erase
};

const PRESETS = [
  { name: "coral",     f: 0.037, k: 0.060 },
  { name: "mitosis",   f: 0.0367,k: 0.0649 },
  { name: "worms",     f: 0.078, k: 0.061 },
  { name: "holes",     f: 0.030, k: 0.062 },
  { name: "flicker",   f: 0.014, k: 0.054 },
  { name: "bubbles",   f: 0.098, k: 0.057 },
  { name: "maze",      f: 0.029, k: 0.057 },
  { name: "solvons",   f: 0.034, k: 0.0618 },
];

// ---------------------------------------------------------------- helpers

function stepOnce() {
  gl.useProgram(progStep);
  bindQuad(progStep);
  gl.viewport(0, 0, SIM_W, SIM_H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(gl.getUniformLocation(progStep, "uState"), 0);
  gl.uniform2f(gl.getUniformLocation(progStep, "uTexel"), 1 / SIM_W, 1 / SIM_H);
  gl.uniform1f(gl.getUniformLocation(progStep, "uF"), params.f);
  gl.uniform1f(gl.getUniformLocation(progStep, "uK"), params.k);
  gl.uniform1f(gl.getUniformLocation(progStep, "uDA"), 1.0);
  gl.uniform1f(gl.getUniformLocation(progStep, "uDB"), 0.5);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // swap
  const t = texA; texA = texB; texB = t;
  const f = fboA; fboA = fboB; fboB = f;
}

function splat(x, y, radius, value) {
  gl.useProgram(progSplat);
  bindQuad(progSplat);
  gl.viewport(0, 0, SIM_W, SIM_H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(gl.getUniformLocation(progSplat, "uState"), 0);
  gl.uniform2f(gl.getUniformLocation(progSplat, "uPoint"), x / SIM_W, 1 - y / SIM_H);
  gl.uniform1f(gl.getUniformLocation(progSplat, "uRadius"), radius / SIM_W);
  gl.uniform1f(gl.getUniformLocation(progSplat, "uValue"), value);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const t = texA; texA = texB; texB = t;
  const f = fboA; fboA = fboB; fboB = f;
}

function draw() {
  gl.useProgram(progDraw);
  bindQuad(progDraw);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texA);
  gl.uniform1i(gl.getUniformLocation(progDraw, "uState"), 0);
  gl.uniform1i(gl.getUniformLocation(progDraw, "uPalette"), params.palette);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function clearState() {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboA);
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboB);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

function scatter(n) {
  for (let i = 0; i < n; i++) {
    splat(Math.random() * SIM_W, Math.random() * SIM_H, 4 + Math.random() * 5, 1.0);
  }
}

// ------------------------------------------------------------------- UI

const $ = (id) => document.getElementById(id);
function bindSlider(id, outId, key, fmt, after) {
  const el = $(id), out = $(outId);
  el.value = params[key];
  out.textContent = fmt(params[key]);
  el.addEventListener("input", () => {
    params[key] = parseFloat(el.value);
    out.textContent = fmt(params[key]);
    if (after) after();
  });
  return el;
}
bindSlider("f", "fOut", "f", v => v.toFixed(3));
bindSlider("k", "kOut", "k", v => v.toFixed(4));
bindSlider("iters", "iterOut", "iters", v => String(v));
const palSlider = bindSlider("pal", "palOut", "palette",
  v => ["ember","ice","acid","mono","magma","neon"][v], null);

const presetBox = $("presets");
PRESETS.forEach(p => {
  const b = document.createElement("button");
  b.textContent = p.name;
  b.addEventListener("click", () => {
    params.f = p.f; params.k = p.k;
    $("f").value = p.f; $("k").value = p.k;
    $("fOut").textContent = p.f.toFixed(3);
    $("kOut").textContent = p.k.toFixed(4);
    clearState(); scatter(6);
  });
  presetBox.appendChild(b);
});

$("brush").addEventListener("click", () => {
  params.brushValue = params.brushValue === 1.0 ? 0.0 : 1.0;
  $("brush").textContent = params.brushValue === 1.0 ? "Brush: seed" : "Brush: erase";
});
$("clear").addEventListener("click", () => { clearState(); });
$("randomize").addEventListener("click", () => { scatter(8); });
$("pause").addEventListener("click", () => {
  params.paused = !params.paused;
  $("pause").textContent = params.paused ? "Resume" : "Pause";
});
$("save").addEventListener("click", () => {
  draw();
  canvas.toBlob(blob => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "reaction-diffusion.png";
    a.click();
    URL.revokeObjectURL(a.href);
  });
});

window.addEventListener("keydown", e => {
  if (e.code === "Space") { e.preventDefault(); $("pause").click(); }
  else if (e.key === "c") clearState();
  else if (e.key === "r") scatter(8);
  else if (e.key === "s") $("save").click();
});

// pointer painting
let painting = false;
function paintFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * SIM_W;
  const y = ((e.clientY - r.top) / r.height) * SIM_H;
  splat(x, y, 5, params.brushValue);
}
canvas.addEventListener("pointerdown", e => { painting = true; paintFromEvent(e); });
canvas.addEventListener("pointermove", e => { if (painting) paintFromEvent(e); });
window.addEventListener("pointerup", () => { painting = false; });

// ------------------------------------------------------- F/k regime map
// A computed Gray-Scott regime map (fk-map.js): each cell runs a tiny CPU sim
// with that cell's (F, k) and is classified by the surviving pattern.
const fkCanvas = $("fkmap");
const MAP_W = 55, MAP_H = 35;
let fkImageData = null;
if (window.FkMap) {
  const map = window.FkMap.computeMap(MAP_W, MAP_H, { cell: 14, iters: 300 });
  const off = document.createElement("canvas");
  off.width = MAP_W; off.height = MAP_H;
  off.getContext("2d").putImageData(new ImageData(map.colors, MAP_W, MAP_H), 0, 0);
  fkImageData = off;
}

function drawFkMarker() {
  if (!fkImageData || !window.FkMap) return;
  const ctx = fkCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(fkImageData, 0, 0, fkCanvas.width, fkCanvas.height);
  const p = window.FkMap.toMapCoords(params.f, params.k);
  const mx = p.x * fkCanvas.width, my = (1 - p.y) * fkCanvas.height;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx, my, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#000000";
  ctx.beginPath();
  ctx.arc(mx, my, 7, 0, Math.PI * 2);
  ctx.stroke();
}

if (fkCanvas && window.FkMap) {
  drawFkMarker();
  fkCanvas.addEventListener("click", e => {
    const r = fkCanvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    const p = window.FkMap.toParams(x, y);
    params.f = p.f; params.k = p.k;
    $("f").value = p.f; $("k").value = p.k;
    $("fOut").textContent = p.f.toFixed(3);
    $("kOut").textContent = p.k.toFixed(4);
    drawFkMarker();
  });
}

// ------------------------------------------------------------------ loop

function frame() {
  if (!params.paused) {
    for (let i = 0; i < params.iters; i++) stepOnce();
  }
  draw();
  requestAnimationFrame(frame);
}

// bootstrap
clearState();
scatter(6);
frame();
