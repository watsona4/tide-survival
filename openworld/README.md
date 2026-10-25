# Open World

A standalone 3D open-world simulation with people in it. A village sits in a
procedurally generated landscape of grassland, forest and lakes. A few dozen
named villagers live there with homes, jobs, needs and friendships, and you
can fly the camera around freely and watch them go about their days under a
sun that rises and sets with the clock.

Unrelated to anything else in this repository; shares no code with it.

## Running

Serve the folder over HTTP (ES modules do not load from `file://`):

```
cd openworld && python3 -m http.server 8000
# then open http://localhost:8000
```

No build step. Rendering uses Three.js, vendored under `vendor/` (MIT,
r170) so the page works offline. The simulation itself has no dependencies.

## Controls

- Left-drag orbits, right-drag pans, mouse wheel zooms. WASD pans.
- Click a person to inspect them: job, home, current activity, needs,
  closest friends. "Follow selected" keeps the camera on them. People inside
  a building are hidden unless selected, when they show as a ghost at the
  door.
- Space or the button pauses. The speed slider runs up to 20x.
- Seed plus Reset regenerates the world and population. The same seed
  always produces the same world and the same history.

## How the people work

Every person has four needs that drain over the day: hunger, energy, social
and fun. When an activity ends, or a need turns critical, they score their
options and pick the best:

- Sleep at home, strongly preferred at night.
- Eat at home or at the tavern, which consumes village food.
- Work from 08:00 to 17:00 if they have a job. Farmers and foragers produce
  food, woodcutters produce wood, merchants and innkeepers staff their
  buildings.
- Socialize at the well by day or the tavern in the evening.
- Relax at the tavern, or wander around the village.

People walk real paths (A* over the terrain, around lakes and buildings).
Time spent together in a building builds a relationship between each pair;
crossing 30 makes them friends, 70 close friends. If village food runs
out, hunger bottoms out, health drains and people die. The event log on
the right records days, friendships, shortages and deaths.

Children (under 14) and elders (65+) have no job and spend their days
socializing and wandering.

## Files

- `rng.js`: seeded RNG.
- `world.js`: terrain noise, village layout, reachability checks.
- `pathfinding.js`: A* on the tile grid.
- `people.js`: the person model, needs, decisions and movement.
- `sim.js`: clock, stocks, relationships, event log. Runs under Node for
  batch experiments without a browser.
- `app.js`: Three.js renderer: terrain mesh with per-tile colours and
  gentle relief, water plane, instanced trees, buildings with roofs,
  villagers, a sun and moon driven by the clock, labels, picking, camera.
- `index.html`: page, import map for the vendored Three.js, side panel.
- `vendor/`: Three.js module build and OrbitControls.

The simulation object is exposed as `window.sim` for poking at from the
browser console, e.g. `sim.time += 600` jumps ten hours ahead.
