# Ecosystem Simulation

A standalone predator-prey simulation: grass, rabbits and foxes on a wrapping
grid. Unrelated to anything else in this repository and shares no code with it.

Open `ecosystem/index.html` in a browser (serve the folder over HTTP, as ES
modules do not load from `file://` in most browsers):

```
cd ecosystem && python3 -m http.server 8000
# then visit http://localhost:8000
```

No dependencies, no build step.

## Rules

Each tick:

1. Bare cells regrow grass with probability *grass regrowth chance*.
2. Every rabbit moves to a random neighbouring cell and pays 1 energy. If the
   cell has grass it eats it and gains *rabbit energy from grass*. With enough
   energy it may reproduce, splitting its energy with the child. At zero
   energy it dies.
3. Every fox does the same, eating a rabbit on its cell instead of grass.

Animals act in a random order each tick. The RNG is seeded, so the same seed
and parameters replay identically. Sliders change parameters live; the seed
only applies on Reset.

## Files

- `model.js`: the model. No DOM. `new Ecosystem(params, seed)` then `step()`.
  Usable from Node for batch experiments.
- `app.js`: canvas renderer, population chart, controls.
- `index.html`: page and layout.

## Things to try

- Push fox reproduce chance up and watch foxes crash the rabbit population,
  then starve.
- Drop grass regrowth to zero: rabbits exhaust the grass and both populations
  collapse in order.
- Classic Lotka-Volterra oscillations appear at the defaults within a few
  hundred ticks.
