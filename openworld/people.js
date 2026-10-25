// People: needs, jobs, daily routine, decisions. No DOM.
import { findPath } from './pathfinding.js';

const FIRST = ['Al', 'Bel', 'Cor', 'Dav', 'Eli', 'Fen', 'Gar', 'Hal', 'Ida', 'Jor', 'Kel', 'Lin', 'Mar', 'Nel', 'Ori', 'Pip', 'Quin', 'Ros', 'Sam', 'Tam', 'Una', 'Vel', 'Wyn', 'Yas'];
const FIRST_END = ['a', 'an', 'en', 'ia', 'is', 'o', 'ric', 'ta', 'wen', 'ys', '', ''];
const LAST = ['Ashdown', 'Brook', 'Carver', 'Dunmore', 'Fairweather', 'Greaves', 'Holloway', 'Kettle', 'Marsh', 'Penrose', 'Quill', 'Rook', 'Stone', 'Thatcher', 'Underhill', 'Weaver'];

export function makeName(rng) {
  return `${rng.pick(FIRST)}${rng.pick(FIRST_END)} ${rng.pick(LAST)}`;
}

export const JOBS = {
  farmer: { color: '#d8b84a', workplace: 'farm', produces: 'food', rate: 0.022 },
  woodcutter: { color: '#b56a2e', workplace: 'lumber', produces: 'wood', rate: 0.03 },
  forager: { color: '#7fc96b', workplace: 'forest', produces: 'food', rate: 0.01 },
  merchant: { color: '#c05cd6', workplace: 'market', produces: null, rate: 0 },
  innkeeper: { color: '#e0742c', workplace: 'tavern', produces: null, rate: 0 },
  child: { color: '#8fd3ff', workplace: null, produces: null, rate: 0 },
  elder: { color: '#d0d0d0', workplace: null, produces: null, rate: 0 },
};

// Need decay per simulated minute. Full = 100.
const DECAY = { hunger: 100 / (16 * 60), energy: 100 / (20 * 60), social: 100 / (14 * 60), fun: 100 / (12 * 60) };
const WALK_SPEED = 8; // tiles per simulated minute
const CRITICAL = 12;

export class Person {
  constructor(id, rng, home, age) {
    this.id = id;
    this.name = makeName(rng);
    this.age = age;
    this.home = home;
    this.job = age < 14 ? 'child' : age >= 65 ? 'elder' : null;
    this.workplace = null;
    this.x = home.door.x;
    this.y = home.door.y;
    this.inside = null;
    this.path = null;
    this.activity = null;
    this.needs = {
      hunger: rng.range(50, 90),
      energy: rng.range(50, 90),
      social: rng.range(40, 90),
      fun: rng.range(40, 90),
    };
    this.health = 100;
    this.alive = true;
    this.nextDecision = 0;
    this.stuck = 0;
  }

  lowestNeed() {
    let k = 'hunger';
    for (const key in this.needs) if (this.needs[key] < this.needs[k]) k = key;
    return k;
  }

  describe() {
    if (!this.alive) return 'dead';
    const a = this.activity;
    if (!a) return 'thinking';
    const where = a.building ? ` at ${a.building.name}` : a.type === 'work' ? ' in the forest' : '';
    if (this.path && this.path.length) return `walking to ${a.building ? a.building.name : a.type === 'work' ? 'the forest' : 'nowhere in particular'}`;
    switch (a.type) {
      case 'sleep': return `sleeping${where}`;
      case 'eat': return `eating${where}`;
      case 'work': return `working${where}`;
      case 'socialize': return `chatting${where}`;
      case 'fun': return `relaxing${where}`;
      case 'wander': return 'out for a walk';
      default: return `idle${where}`;
    }
  }
}

// ----- decision making -----

function isNight(hour) {
  return hour >= 22 || hour < 6;
}

function workHours(hour) {
  return hour >= 8 && hour < 17;
}

function tavernOpen(hour) {
  return hour >= 16 && hour < 24;
}

export function decide(p, sim) {
  const hour = sim.hour();
  const n = p.needs;
  const world = sim.world;
  const options = [];

  // Sleep: at night anyone with room to rest wants to; by day only when
  // genuinely tired, so people without jobs do not nap the day away.
  let sleepScore = isNight(hour) ? (100 - n.energy) * 2.2 : Math.max(0, 20 - n.energy) * 5;
  if (n.energy < CRITICAL) sleepScore += 500;
  options.push({ type: 'sleep', score: sleepScore, building: p.home });

  // Eat: nobody eats above 60% full. Below that, appetite rises steeply
  // enough to beat work at around 30%.
  if (sim.food >= 1 && n.hunger < 60) {
    let eatScore = (60 - n.hunger) * 2.5;
    if (n.hunger < CRITICAL) eatScore += 500;
    const useTavern = world.tavern && tavernOpen(hour) && sim.rng() < 0.35;
    options.push({ type: 'eat', score: eatScore, building: useTavern ? world.tavern : p.home });
  }

  if (p.workplace !== null && workHours(hour)) {
    let w = 70;
    if (n.hunger < 30) w -= 30;
    if (n.energy < 30) w -= 30;
    const building = p.workplace === 'forest' ? null : p.workplace;
    options.push({ type: 'work', score: w, building, forest: p.workplace === 'forest' });
  }

  const socialPlace = world.tavern && tavernOpen(hour) ? world.tavern : world.well;
  options.push({ type: 'socialize', score: (100 - n.social) * 0.9 - (isNight(hour) ? 30 : 0), building: socialPlace });

  const funPlace = world.tavern && tavernOpen(hour) ? world.tavern : null;
  options.push({ type: funPlace ? 'fun' : 'wander', score: (100 - n.fun) * 0.7 - (isNight(hour) ? 30 : 0), building: funPlace });

  options.push({ type: 'wander', score: 8 + sim.rng() * 10, building: null });

  options.sort((a, b) => b.score - a.score);
  startActivity(p, sim, options[0]);
}

function startActivity(p, sim, opt) {
  const world = sim.world;
  const t = sim.time;
  const durations = { eat: 30, socialize: 90, fun: 75, wander: 25 };
  const act = { type: opt.type, building: opt.building ?? null, until: Infinity, started: t, forest: !!opt.forest };

  // Timed activities get their clock on arrival (see arrive); until then a
  // generous travel allowance stops a person walking forever.
  if (opt.type === 'sleep') act.until = Infinity; // ends when rested or morning
  else if (opt.type === 'work') act.until = sim.dayStart() + 17 * 60;
  else {
    act.duration = durations[opt.type];
    act.until = t + 60 + act.duration;
  }

  let target;
  if (act.building) target = act.building.door;
  else if (act.forest) {
    const f = world.nearestForestTile(p.x, p.y);
    target = f ? world.randomWalkableNear(sim.rng, f.x, f.y, 4) ?? f : null;
  } else target = world.randomWalkableNear(sim.rng, p.home.door.x, p.home.door.y, 14);

  if (!target) {
    act.type = 'idle';
    act.building = null;
    act.until = t + 15;
  }

  leaveBuilding(p);
  if (target) {
    const sx = Math.round(p.x);
    const sy = Math.round(p.y);
    const path = findPath(world, sx, sy, target.x, target.y);
    if (path === null) {
      act.type = 'idle';
      act.building = null;
      act.until = t + 15;
      p.path = null;
    } else {
      p.path = path;
    }
  } else p.path = null;
  p.activity = act;
  p.nextDecision = t + 5;
  if (p.path && p.path.length === 0) arrive(p, sim);
}

function leaveBuilding(p) {
  if (p.inside) {
    p.inside.occupants.delete(p);
    p.x = p.inside.door.x;
    p.y = p.inside.door.y;
    p.inside = null;
  }
}

function arrive(p, sim) {
  const a = p.activity;
  p.path = null;
  if (a.duration) a.until = sim.time + a.duration;
  if (a.building) {
    p.inside = a.building;
    a.building.occupants.add(p);
  }
  if (a.type === 'eat') {
    if (sim.food >= 1) {
      sim.food -= 1;
      a.ate = true;
    } else {
      a.type = 'idle';
      a.until = sim.time + 10;
    }
  }
}

// ----- per-step update -----

export function updatePerson(p, sim, dt) {
  if (!p.alive) return;
  const n = p.needs;
  for (const k in n) n[k] = Math.max(0, n[k] - DECAY[k] * dt);

  // Starvation and recovery.
  if (n.hunger <= 0) p.health -= 0.25 * dt;
  else if (n.hunger > 50 && p.health < 100) p.health = Math.min(100, p.health + 0.05 * dt);
  if (p.health <= 0) {
    p.alive = false;
    leaveBuilding(p);
    p.path = null;
    p.activity = null;
    sim.log(`${p.name} has died of hunger.`, 'death');
    return;
  }

  const a = p.activity;
  const hour = sim.hour();

  let needsDecision = !a || sim.time >= a.until;
  if (a && a.type === 'sleep' && !p.path) {
    // Sleep through the night; by day, get up once reasonably rested.
    const morning = hour >= 5.5 && hour < 22;
    if (morning && (n.energy >= 60 || n.energy >= 99)) needsDecision = true;
  }
  if (a && !needsDecision && sim.time >= p.nextDecision) {
    const low = p.lowestNeed();
    const addressing = { sleep: 'energy', eat: 'hunger', socialize: 'social', fun: 'fun' }[a.type];
    if (n[low] < CRITICAL && addressing !== low && !(a.type === 'work' && low === 'fun')) needsDecision = true;
  }
  if (needsDecision) {
    decide(p, sim);
    return;
  }

  if (p.path) {
    moveAlongPath(p, sim, dt);
    return;
  }

  // Performing the activity.
  switch (a.type) {
    case 'sleep':
      n.energy = Math.min(100, n.energy + (100 / (8 * 60)) * dt + DECAY.energy * dt);
      break;
    case 'eat':
      if (a.ate) n.hunger = Math.min(100, n.hunger + (65 / 30) * dt + DECAY.hunger * dt);
      if (a.building === sim.world.tavern) n.fun = Math.min(100, n.fun + (20 / 30) * dt);
      socialTick(p, sim, dt, 0.5);
      break;
    case 'work': {
      const job = JOBS[p.job];
      if (job.produces) sim[job.produces] = Math.min(sim.stockCap, sim[job.produces] + job.rate * dt);
      n.fun = Math.max(0, n.fun - DECAY.fun * 0.5 * dt);
      if (a.building) socialTick(p, sim, dt, 0.3);
      break;
    }
    case 'socialize':
      n.social = Math.min(100, n.social + (100 / 120) * dt + DECAY.social * dt);
      n.fun = Math.min(100, n.fun + (30 / 120) * dt);
      socialTick(p, sim, dt, 1);
      break;
    case 'fun':
      n.fun = Math.min(100, n.fun + (100 / 90) * dt + DECAY.fun * dt);
      n.social = Math.min(100, n.social + (30 / 90) * dt);
      socialTick(p, sim, dt, 0.7);
      break;
    case 'wander':
      n.fun = Math.min(100, n.fun + (15 / 25) * dt);
      break;
    default:
      break;
  }
}

function socialTick(p, sim, dt, weight) {
  const b = p.inside;
  if (!b) return;
  // In a crowd you talk to fewer people, so growth per pair falls with
  // occupancy. Only one side of each pair applies the bump.
  const crowd = 0.1 / Math.sqrt(Math.max(1, b.occupants.size - 1));
  for (const q of b.occupants) {
    if (q === p || !q.alive || q.id < p.id) continue;
    sim.bump(p, q, crowd * weight * dt);
  }
}

function moveAlongPath(p, sim, dt) {
  let budget = WALK_SPEED * dt;
  while (budget > 0 && p.path && p.path.length) {
    const next = p.path[0];
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      p.x = next.x;
      p.y = next.y;
      p.path.shift();
      budget -= dist;
    } else {
      p.x += (dx / dist) * budget;
      p.y += (dy / dist) * budget;
      budget = 0;
    }
  }
  if (p.path && p.path.length === 0) arrive(p, sim);
}
