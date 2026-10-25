// Predator-prey ecosystem on a toroidal grid. Pure model: no DOM, seeded RNG.
//
// Rules per tick:
//  - Bare cells regrow grass with probability grassRegrow.
//  - Each rabbit moves to a random neighbouring cell, pays 1 energy, eats
//    grass if present (gaining rabbitGain), breeds with probability
//    rabbitBreed if it has enough energy (splitting energy with the child),
//    and dies at energy <= 0.
//  - Each fox does the same but eats a rabbit on its cell (gaining foxGain).
// Animals act in a shuffled order each tick so no one has a permanent edge.

export const DEFAULT_PARAMS = {
  width: 120,
  height: 80,
  grassRegrow: 0.03,
  initialGrass: 0.5,
  initialRabbits: 400,
  initialFoxes: 40,
  rabbitGain: 6,
  rabbitBreed: 0.08,
  rabbitBreedMinEnergy: 8,
  rabbitStartEnergy: 10,
  foxGain: 25,
  foxBreed: 0.04,
  foxBreedMinEnergy: 30,
  foxStartEnergy: 30,
};

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class Ecosystem {
  constructor(params = {}, seed = 1) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.rng = makeRng(seed);
    const { width, height } = this.params;
    this.width = width;
    this.height = height;
    this.grass = new Uint8Array(width * height);
    this.rabbitAt = new Int32Array(width * height).fill(-1); // index into rabbits, or -1
    this.rabbits = [];
    this.foxes = [];
    this.tick = 0;
    this.history = { grass: [], rabbits: [], foxes: [] };
    this.seedWorld();
  }

  idx(x, y) {
    return y * this.width + x;
  }

  wrap(x, y) {
    return [(x + this.width) % this.width, (y + this.height) % this.height];
  }

  seedWorld() {
    const p = this.params;
    for (let i = 0; i < this.grass.length; i++) this.grass[i] = this.rng() < p.initialGrass ? 1 : 0;
    for (let i = 0; i < p.initialRabbits; i++) this.spawnRabbit(this.randX(), this.randY(), p.rabbitStartEnergy);
    for (let i = 0; i < p.initialFoxes; i++) {
      this.foxes.push({ x: this.randX(), y: this.randY(), energy: p.foxStartEnergy, alive: true });
    }
    this.record();
  }

  randX() { return Math.floor(this.rng() * this.width); }
  randY() { return Math.floor(this.rng() * this.height); }

  spawnRabbit(x, y, energy) {
    const r = { x, y, energy, alive: true };
    this.rabbits.push(r);
    // Several rabbits may share a cell; the index tracks one of them, which
    // is all a fox needs. Others become findable again when it moves or dies.
    this.rabbitAt[this.idx(x, y)] = this.rabbits.length - 1;
    return r;
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  step() {
    const p = this.params;

    for (let i = 0; i < this.grass.length; i++) {
      if (this.grass[i] === 0 && this.rng() < p.grassRegrow) this.grass[i] = 1;
    }

    this.shuffle(this.rabbits);
    this.rebuildRabbitIndex();
    const births = [];
    for (const r of this.rabbits) {
      const [dx, dy] = DIRS[Math.floor(this.rng() * DIRS.length)];
      [r.x, r.y] = this.wrap(r.x + dx, r.y + dy);
      r.energy -= 1;
      const i = this.idx(r.x, r.y);
      if (this.grass[i]) {
        this.grass[i] = 0;
        r.energy += p.rabbitGain;
      }
      if (r.energy >= p.rabbitBreedMinEnergy && this.rng() < p.rabbitBreed) {
        const half = Math.floor(r.energy / 2);
        r.energy -= half;
        births.push({ x: r.x, y: r.y, energy: half, alive: true });
      }
      if (r.energy <= 0) r.alive = false;
    }
    this.rabbits = this.rabbits.filter((r) => r.alive).concat(births);
    this.rebuildRabbitIndex();

    this.shuffle(this.foxes);
    const foxBirths = [];
    for (const f of this.foxes) {
      const [dx, dy] = DIRS[Math.floor(this.rng() * DIRS.length)];
      [f.x, f.y] = this.wrap(f.x + dx, f.y + dy);
      f.energy -= 1;
      const i = this.idx(f.x, f.y);
      const ri = this.rabbitAt[i];
      if (ri >= 0 && this.rabbits[ri].alive) {
        this.rabbits[ri].alive = false;
        this.rabbitAt[i] = -1;
        f.energy += p.foxGain;
      }
      if (f.energy >= p.foxBreedMinEnergy && this.rng() < p.foxBreed) {
        const half = Math.floor(f.energy / 2);
        f.energy -= half;
        foxBirths.push({ x: f.x, y: f.y, energy: half, alive: true });
      }
      if (f.energy <= 0) f.alive = false;
    }
    this.foxes = this.foxes.filter((f) => f.alive).concat(foxBirths);
    this.rabbits = this.rabbits.filter((r) => r.alive);
    this.rebuildRabbitIndex();

    this.tick += 1;
    this.record();
  }

  rebuildRabbitIndex() {
    this.rabbitAt.fill(-1);
    for (let i = 0; i < this.rabbits.length; i++) {
      const r = this.rabbits[i];
      this.rabbitAt[this.idx(r.x, r.y)] = i;
    }
  }

  grassCount() {
    let n = 0;
    for (let i = 0; i < this.grass.length; i++) n += this.grass[i];
    return n;
  }

  record() {
    const h = this.history;
    h.grass.push(this.grassCount());
    h.rabbits.push(this.rabbits.length);
    h.foxes.push(this.foxes.length);
    const MAX = 2000;
    if (h.grass.length > MAX) {
      h.grass.shift();
      h.rabbits.shift();
      h.foxes.shift();
    }
  }
}
