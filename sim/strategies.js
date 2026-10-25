// Build policies for the simulation. Each is `(sim) => void` and is called
// every tick; it should spend resources through sim.build() and nothing else.
//
// These are deliberately simple. The point of the sim is to compare how the
// three materials behave under the wave schedule, not to find an optimal
// player.

import { MATERIALS } from './simulation.js';

function lowest(list) {
  return list.reduce((best, s) => (best == null || s.height < best.height ? s : best), null);
}

function growable(sim, material) {
  const max = sim.config[material].maxHeight;
  return sim.state.structures[material].filter((s) => s.height < max);
}

// Spend every unit of `material` the moment it is available, always growing
// the shortest existing structure before starting a new one. Caps the number
// of distinct structures so height, not count, is what the material buys.
export function stacker(material, { maxStructures = 3 } = {}) {
  return (sim) => {
    while (sim.state.resources[material] >= sim.config[material].cost) {
      const list = sim.state.structures[material];
      const g = growable(sim, material);
      if (list.length < maxStructures) {
        if (!sim.build(material)) break;
      } else if (g.length > 0) {
        if (!sim.build(material, lowest(g).id)) break;
      } else {
        break;
      }
    }
  };
}

// Spread out: every unit starts a new structure. Height is always 1, so a
// danger wave wipes sand and mud outright; rock survives by lifespan.
export function sprawler(material) {
  return (sim) => {
    while (sim.build(material)) {
      /* keep building */
    }
  };
}

// Hoard until a danger or killer warning is active, then dump everything into
// the tallest existing structure (or start one). Mirrors a player who only
// builds when the alarm sounds. Note the warning is 1.5 s and waves spawn
// every 1 s, so a wave is almost always "incoming".
export function reactive(material) {
  return (sim) => {
    const w = sim.state.activeWave;
    if (!w || w.kind === 'normal') return;
    const g = growable(sim, material);
    const tallest = g.reduce((b, s) => (b == null || s.height > b.height ? s : b), null);
    while (sim.state.resources[material] >= sim.config[material].cost) {
      if (!sim.build(material, tallest ? tallest.id : null)) break;
    }
  };
}

// Use all three materials with the stacker policy at once. This is the
// "play normally" baseline.
export function allStackers(opts) {
  const fns = MATERIALS.map((m) => stacker(m, opts));
  return (sim) => fns.forEach((f) => f(sim));
}

// Do nothing. Confirms the sim produces zero height with zero input.
export function idle() {
  return () => {};
}

export const STRATEGIES = {
  idle: idle(),
  'sand-stack': stacker('sand'),
  'mud-stack': stacker('mud'),
  'rock-stack': stacker('rock'),
  'sand-sprawl': sprawler('sand'),
  'mud-sprawl': sprawler('mud'),
  'rock-sprawl': sprawler('rock'),
  'sand-reactive': reactive('sand'),
  'mud-reactive': reactive('mud'),
  'rock-reactive': reactive('rock'),
  all: allStackers(),
};
