// Headless simulation of the Tide Survival wave/structure mechanics.
//
// This module is deliberately independent of game.js: no DOM, no canvas,
// no audio, no Math.random. Everything that varies is either in `config`
// or driven by the seeded RNG, so a run is fully reproducible from
// (config, seed, strategy).
//
// The default config mirrors the constants in game.js as of the commit this
// was written against. They are copied, not imported, so that tuning
// experiments here never leak into the game and vice versa. If you change a
// constant in game.js, update DEFAULT_CONFIG too or the model drifts.

export const DEFAULT_CONFIG = {
  waveInterval: 1, // seconds between wave spawns
  waveWarningTime: 1.5, // seconds from spawn until the wave hits
  killerWaveChance: 0.01,
  dangerWaveChance: 0.2,
  dangerDamage: 5,

  sand: { max: 10, regenRate: 1 / 2, cost: 1, maxHeight: 15 },
  mud: { max: 10, regenRate: 1 / 3, cost: 1, maxHeight: 15, damageResistance: 0.5 },
  rock: { max: 10, regenRate: 1 / 5, cost: 1, maxHeight: 15, waveLifespan: 3 },
};

export const MATERIALS = ['sand', 'mud', 'rock'];

// mulberry32: small, fast, good enough for Monte Carlo on game balance.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mergeConfig(overrides) {
  const cfg = { ...DEFAULT_CONFIG, ...overrides };
  for (const m of MATERIALS) cfg[m] = { ...DEFAULT_CONFIG[m], ...(overrides?.[m] ?? {}) };
  return cfg;
}

export function createSimulation({ config = {}, seed = 1 } = {}) {
  const cfg = mergeConfig(config);
  const rng = makeRng(seed);

  const state = {
    time: 0,
    resources: { sand: cfg.sand.max, mud: cfg.mud.max, rock: cfg.rock.max },
    // Structures are abstract: the game keys them by position, the sim keys
    // them by an id. Position only matters for the grow-radius merge rule,
    // which a strategy expresses by choosing to grow an existing structure.
    structures: { sand: [], mud: [], rock: [] },
    waveTimer: cfg.waveInterval,
    activeWave: null,
    nextId: 1,
    stats: {
      wavesSpawned: { normal: 0, danger: 0, killer: 0 },
      wavesHit: { normal: 0, danger: 0, killer: 0 },
      built: { sand: 0, mud: 0, rock: 0 }, // resource units spent
      destroyed: { sand: 0, mud: 0, rock: 0 }, // structures lost
      wipes: 0, // hits that took the island from something standing to nothing
      timeWithStructures: 0,
    },
  };

  // Build one level of `material`. Pass an existing structure's id to grow
  // it (the game's "click within TOWER_GROW_RADIUS" path); omit to start a
  // new one. Returns true if a unit of material was spent.
  function build(material, id = null) {
    const mcfg = cfg[material];
    if (state.resources[material] < mcfg.cost) return false;
    const list = state.structures[material];
    if (id != null) {
      const s = list.find((x) => x.id === id);
      if (!s) return false;
      if (s.height >= mcfg.maxHeight) return false;
      s.height += 1;
    } else {
      list.push({ id: state.nextId++, height: 1, wavesSurvived: 0, bornAt: state.time });
    }
    state.resources[material] -= mcfg.cost;
    state.stats.built[material] += mcfg.cost;
    return true;
  }

  function rollWaveKind() {
    const r = rng();
    if (r < cfg.killerWaveChance) return 'killer';
    if (r < cfg.killerWaveChance + cfg.dangerWaveChance) return 'danger';
    return 'normal';
  }

  function applyWaveHit(kind) {
    state.stats.wavesHit[kind] += 1;
    if (kind === 'normal') return;
    const dmg = kind === 'killer' ? Infinity : cfg.dangerDamage;
    const standingBefore = totalStructures();

    damage('sand', dmg);
    damage('mud', dmg * cfg.mud.damageResistance);
    // Rock ignores height damage and instead ages out after N damaging
    // waves. Normal waves do not age rock (matches game.js).
    const rocks = state.structures.rock;
    for (const r of rocks) r.wavesSurvived += 1;
    const kept = rocks.filter((r) => r.wavesSurvived < cfg.rock.waveLifespan);
    state.stats.destroyed.rock += rocks.length - kept.length;
    state.structures.rock = kept;

    if (standingBefore > 0 && totalStructures() === 0) state.stats.wipes += 1;
  }

  function damage(material, amount) {
    const list = state.structures[material];
    for (const s of list) s.height -= amount;
    const kept = list.filter((s) => s.height > 0);
    state.stats.destroyed[material] += list.length - kept.length;
    state.structures[material] = kept;
  }

  function totalStructures() {
    return MATERIALS.reduce((n, m) => n + state.structures[m].length, 0);
  }

  function totalHeight() {
    return MATERIALS.reduce((n, m) => n + state.structures[m].reduce((h, s) => h + s.height, 0), 0);
  }

  // Advance by dt seconds. Mirrors game.js update(): regen, then the wave
  // state machine. Call `strategy` hooks from the driver, not from here, so
  // the core stays policy-free.
  function step(dt) {
    for (const m of MATERIALS) {
      state.resources[m] = Math.min(cfg[m].max, state.resources[m] + cfg[m].regenRate * dt);
    }

    if (!state.activeWave) {
      state.waveTimer -= dt;
      if (state.waveTimer <= 0) {
        state.waveTimer = cfg.waveInterval;
        const kind = rollWaveKind();
        state.stats.wavesSpawned[kind] += 1;
        state.activeWave = { kind, timeLeft: cfg.waveWarningTime };
      }
    } else {
      state.activeWave.timeLeft -= dt;
      if (state.activeWave.timeLeft <= 0) {
        applyWaveHit(state.activeWave.kind);
        state.activeWave = null;
      }
    }

    if (totalStructures() > 0) state.stats.timeWithStructures += dt;
    state.time += dt;
  }

  return {
    config: cfg,
    state,
    step,
    build,
    totalStructures,
    totalHeight,
    // Read-only view a strategy is allowed to see. Same object, by
    // convention strategies only call build().
    view: () => ({
      time: state.time,
      resources: { ...state.resources },
      structures: {
        sand: state.structures.sand.map((s) => ({ ...s })),
        mud: state.structures.mud.map((s) => ({ ...s })),
        rock: state.structures.rock.map((s) => ({ ...s })),
      },
      activeWave: state.activeWave ? { ...state.activeWave } : null,
    }),
  };
}

// Run one trial: a strategy is `(sim) => void`, called once per tick before
// the physics step. Returns the final stats plus a few derived numbers.
export function runTrial({ strategy, seconds = 300, dt = 1 / 60, seed = 1, config = {} }) {
  const sim = createSimulation({ config, seed });
  const ticks = Math.round(seconds / dt);
  let heightSum = 0;
  let maxHeight = 0;
  for (let i = 0; i < ticks; i++) {
    strategy(sim);
    sim.step(dt);
    const h = sim.totalHeight();
    heightSum += h;
    if (h > maxHeight) maxHeight = h;
  }
  const s = sim.state.stats;
  const spent = s.built.sand + s.built.mud + s.built.rock;
  return {
    seed,
    seconds,
    ...s,
    finalStructures: sim.totalStructures(),
    finalHeight: sim.totalHeight(),
    meanHeight: heightSum / ticks,
    maxHeight,
    uptime: s.timeWithStructures / sim.state.time,
    // "Height-seconds per resource unit": how much standing structure each
    // unit of material bought, integrated over the run.
    heightSecondsPerUnit: spent > 0 ? (heightSum * dt) / spent : 0,
  };
}

export function runMany({ trials = 100, seedBase = 1000, ...rest }) {
  const results = [];
  for (let i = 0; i < trials; i++) results.push(runTrial({ ...rest, seed: seedBase + i }));
  return results;
}

export function summarize(results) {
  const keys = [
    'finalStructures',
    'finalHeight',
    'meanHeight',
    'maxHeight',
    'uptime',
    'wipes',
    'heightSecondsPerUnit',
  ];
  const out = {};
  for (const k of keys) {
    const xs = results.map((r) => r[k]).sort((a, b) => a - b);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    out[k] = {
      mean,
      sd: Math.sqrt(variance),
      min: xs[0],
      p50: xs[Math.floor(xs.length / 2)],
      max: xs[xs.length - 1],
    };
  }
  const hits = results.reduce(
    (acc, r) => {
      acc.normal += r.wavesHit.normal;
      acc.danger += r.wavesHit.danger;
      acc.killer += r.wavesHit.killer;
      return acc;
    },
    { normal: 0, danger: 0, killer: 0 },
  );
  out.wavesHitTotal = hits;
  return out;
}
