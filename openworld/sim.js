// Ties world, people, time, stocks and the event log together. No DOM.
import { makeRng } from './rng.js';
import { World } from './world.js';
import { Person, JOBS, updatePerson } from './people.js';

export const DEFAULTS = {
  population: 44,
  startFood: 120,
  startWood: 30,
  stockCap: 400,
};

export class Simulation {
  constructor(seed = 1, options = {}) {
    this.seed = seed;
    this.opts = { ...DEFAULTS, ...options };
    this.rng = makeRng(seed * 7919 + 17);
    this.world = new World(seed);
    this.time = 7 * 60; // minutes since day 1 00:00; start at 07:00
    this.stockCap = this.opts.stockCap;
    this.food = this.opts.startFood;
    this.wood = this.opts.startWood;
    this.events = [];
    this.foodShortage = false;
    this.relationships = new Map();
    this.people = [];
    this.populate();
    this.log(`Day 1 begins in a village of ${this.people.length}.`, 'day');
    this.lastDay = 1;
  }

  hour() {
    return (this.time / 60) % 24;
  }

  day() {
    return Math.floor(this.time / 1440) + 1;
  }

  dayStart() {
    return Math.floor(this.time / 1440) * 1440;
  }

  clock() {
    const h = Math.floor(this.hour());
    const m = Math.floor(this.time % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  log(text, kind = 'info') {
    this.events.push({ day: this.day(), clock: this.clock(), text, kind });
    if (this.events.length > 200) this.events.shift();
  }

  populate() {
    const w = this.world;
    if (!w.houses.length) return;
    const rng = this.rng;
    const ages = () => {
      const r = rng();
      if (r < 0.18) return rng.int(13) + 1;
      if (r < 0.88) return 14 + rng.int(51);
      return 65 + rng.int(20);
    };
    for (let i = 0; i < this.opts.population; i++) {
      const home = w.houses[i % w.houses.length];
      this.people.push(new Person(i, rng, home, ages()));
    }
    // Assign jobs to working-age adults: fill the fixed posts, then farms,
    // and everyone left forages.
    const adults = rng.shuffle(this.people.filter((p) => p.job === null));
    const posts = [];
    if (w.market) posts.push(['merchant', w.market], ['merchant', w.market]);
    if (w.tavern) posts.push(['innkeeper', w.tavern], ['innkeeper', w.tavern]);
    if (w.lumber) posts.push(['woodcutter', w.lumber], ['woodcutter', w.lumber], ['woodcutter', w.lumber]);
    for (const f of w.farms) posts.push(['farmer', f], ['farmer', f], ['farmer', f]);
    for (const p of adults) {
      const post = posts.shift();
      if (post) {
        [p.job, p.workplace] = post;
      } else {
        p.job = 'forager';
        p.workplace = 'forest';
      }
    }
  }

  relKey(a, b) {
    return a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
  }

  relation(a, b) {
    return this.relationships.get(this.relKey(a, b)) ?? 0;
  }

  bump(a, b, amount) {
    const k = this.relKey(a, b);
    const before = this.relationships.get(k) ?? 0;
    const after = Math.min(100, before + amount);
    this.relationships.set(k, after);
    if (before < 30 && after >= 30) this.log(`${a.name} and ${b.name} have become friends.`, 'social');
    else if (before < 70 && after >= 70) this.log(`${a.name} and ${b.name} are now close friends.`, 'social');
  }

  friendsOf(p, limit = 4) {
    const out = [];
    for (const q of this.people) {
      if (q === p) continue;
      const v = this.relation(p, q);
      if (v > 0) out.push({ person: q, value: v });
    }
    out.sort((a, b) => b.value - a.value);
    return out.slice(0, limit);
  }

  alive() {
    return this.people.filter((p) => p.alive);
  }

  // Advance by dt simulated minutes.
  step(dt = 0.1) {
    this.time += dt;
    for (const p of this.people) updatePerson(p, this, dt);
    if (!this.foodShortage && this.food < 1) {
      this.foodShortage = true;
      this.log('The village has run out of food.', 'warn');
    } else if (this.foodShortage && this.food >= 20) {
      this.foodShortage = false;
      this.log('Food stores are recovering.', 'info');
    }
    const d = this.day();
    if (d !== this.lastDay) {
      this.lastDay = d;
      this.log(`Day ${d}. Population ${this.alive().length}, food ${Math.floor(this.food)}, wood ${Math.floor(this.wood)}.`, 'day');
    }
  }
}
