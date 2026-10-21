# Reaction-Diffusion Studio

An interactive Gray-Scott reaction–diffusion simulator that runs entirely on the GPU (WebGL), no dependencies, no build step, no backend.

## Concept

Two virtual chemicals — a feed **A** and an activator **B** — diffuse across a 512×320 grid while reacting (`A + 2B → 3B`, `B → inert`). Tiny differences in the **feed (F)** and **kill (k)** rates produce radically different emergent textures: coral, worms, mazes, mitosis-like dividing spots. This studio lets you:

- **Paint** chemical seeds on the canvas with the mouse (seed or erase brush)
- **Tune F and k live** with sliders, or jump between 8 curated presets (coral, mitosis, worms, holes, flicker, bubbles, maze, solvons)
- Control simulation speed (iterations per frame) and switch between 6 color palettes
- **Save PNG** snapshots of the current pattern
- **Copy link** to share the exact configuration (F, k, iterations, palette) via URL hash — opening a shared link restores it automatically
- Keyboard: `Space` pause · `C` clear · `R` scatter seeds · `S` save

The simulation uses ping-pong floating-point framebuffers, a 9-point Laplacian, and runs entirely in fragment shaders — steady 60 fps even at 60 iterations per frame.

## How to run

Any static file server works:

```sh
cd reaction-diffusion-studio
python3 -m http.server 8000
# open http://localhost:8000
```

(Opening `index.html` directly via `file://` also works in most browsers; a local server is recommended.)

## Files

- `index.html` — page structure and controls
- `style.css` — dark studio styling
- `main.js` — WebGL setup, GLSL shaders (step / splat / draw), UI wiring, animation loop
- `fk-map.js` — computed Gray-Scott F/k regime map (pure JS, also runs in Node)
- `test-fk-map.js` — tests for the regime map (`node test-fk-map.js`)

## Tech

Plain JavaScript + WebGL 1.0 (`OES_texture_float`). No libraries, no network calls.
