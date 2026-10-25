# Tide Survival simulation

A headless, deterministic model of the game's wave and building mechanics.
It shares no code with `game.js`: no DOM, canvas, audio or `Math.random`.
Use it to answer balance questions ("is rock worth its regen rate?",
"what happens at 40% danger waves?") without playing hundreds of rounds.

```
node sim/run.js                       # every strategy, 200 trials of 300 s
node sim/run.js --strategy mud-stack  # one strategy
node sim/run.js --trials 1000 --seconds 600 --seed 42
node sim/run.js --config '{"dangerWaveChance":0.4,"rock":{"waveLifespan":5}}'
node sim/run.js --json
```

No dependencies. Needs Node 18+ (ES modules).

## Files

- `simulation.js`: the model. `createSimulation({config, seed})` returns an
  object with `step(dt)` and `build(material, id?)`. `runTrial`, `runMany`
  and `summarize` wrap it for Monte Carlo runs.
- `strategies.js`: build policies, functions of the form `(sim) => void`
  called once per tick. Add your own and register it in `STRATEGIES`.
- `run.js`: the CLI.

## What is modelled

Exactly what `game.js` does today:

- A wave spawns every `waveInterval` seconds and hits `waveWarningTime`
  seconds later. Only one wave is pending at a time.
- Wave kind is rolled once per wave: killer, then danger, else normal.
- Danger waves take `dangerDamage` height from sand, half that from mud,
  and age every rock pile by one wave. Killer waves destroy sand and mud
  outright and age rock the same way. Normal waves do nothing.
- Rock falls after surviving `waveLifespan` damaging waves. Normal waves do
  not age rock; that matches the game, where `ageRockPiles()` is only called
  in the danger and killer branches.
- Each material regenerates linearly to its cap and costs one unit per
  height level, up to `maxHeight`.

Position is abstracted away. In the game a click near an existing structure
grows it instead of starting a new one. In the sim a strategy decides that
explicitly by passing a structure id to `build()`.

## What is not modelled

- The player. Strategies are crude policies, not a model of human reaction
  time. Treat results as "what the materials can do", not "what a player
  will do".
- Any win or lose condition. The game has none yet, so the sim reports
  standing height, uptime and resource efficiency instead of survival time.
  When the game gets a lose condition, add it to `applyWaveHit()` and
  `runTrial()` and report time-to-loss.

## Keeping it in sync

`DEFAULT_CONFIG` in `simulation.js` is a copy of the constants in `game.js`.
That is intentional so experiments here never leak into the game, but it
means a constant changed in one place must be changed in the other.
