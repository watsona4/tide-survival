// Procedural world: terrain from value noise, then a village laid out around
// a central well. Pure data, no DOM.
import { makeRng } from './rng.js';

export const TILE = { WATER: 0, SAND: 1, GRASS: 2, FOREST: 3 };

export const BUILDING_SPECS = {
  well: { w: 1, h: 1, label: 'Well' },
  market: { w: 5, h: 3, label: 'Market' },
  tavern: { w: 5, h: 4, label: 'Tavern' },
  house: { w: 3, h: 3, label: 'House' },
  farm: { w: 6, h: 4, label: 'Farm' },
  lumber: { w: 4, h: 3, label: 'Lumber camp' },
};

function valueNoise(rng, width, height, cell) {
  const gw = Math.ceil(width / cell) + 2;
  const gh = Math.ceil(height / cell) + 2;
  const lattice = new Float32Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const v = (ix, iy) => lattice[iy * gw + ix];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * tx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

export class World {
  constructor(seed, width = 128, height = 96) {
    this.seed = seed;
    this.width = width;
    this.height = height;
    this.tiles = new Uint8Array(width * height);
    this.blocked = new Uint8Array(width * height); // water or building footprint
    this.buildings = [];
    this.center = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
    const rng = makeRng(seed);
    this.generateTerrain(rng);
    this.placeVillage(rng);
  }

  idx(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tile(x, y) {
    return this.tiles[this.idx(x, y)];
  }

  isWalkable(x, y) {
    return this.inBounds(x, y) && this.blocked[this.idx(x, y)] === 0;
  }

  generateTerrain(rng) {
    const n1 = valueNoise(rng, this.width, this.height, 20);
    const n2 = valueNoise(rng, this.width, this.height, 7);
    const f1 = valueNoise(rng, this.width, this.height, 11);
    const { x: cx, y: cy } = this.center;
    const half = Math.min(this.width, this.height) / 2;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const d = Math.hypot(x - cx, y - cy) / half;
        let e = 0.65 * n1(x, y) + 0.35 * n2(x, y);
        e += Math.max(0, 0.55 - d) * 0.7; // guarantee dry land for the village
        let t;
        if (e < 0.36) t = TILE.WATER;
        else if (e < 0.4) t = TILE.SAND;
        else if (f1(x, y) > 0.58 && d > 0.3) t = TILE.FOREST;
        else t = TILE.GRASS;
        const i = this.idx(x, y);
        this.tiles[i] = t;
        this.blocked[i] = t === TILE.WATER ? 1 : 0;
      }
    }
  }

  footprintOk(x, y, w, h) {
    // Footprint plus a one-tile margin must be dry, unblocked land. The door
    // tile sits in the margin below the footprint.
    for (let yy = y - 1; yy <= y + h; yy++) {
      for (let xx = x - 1; xx <= x + w; xx++) {
        if (!this.inBounds(xx, yy)) return false;
        const i = this.idx(xx, yy);
        if (this.tiles[i] === TILE.WATER || this.blocked[i]) return false;
      }
    }
    return true;
  }

  addBuilding(type, x, y, name) {
    const spec = BUILDING_SPECS[type];
    const b = {
      id: this.buildings.length,
      type,
      x,
      y,
      w: spec.w,
      h: spec.h,
      door: { x: x + Math.floor(spec.w / 2), y: y + spec.h },
      name: name ?? spec.label,
      occupants: new Set(),
    };
    for (let yy = y; yy < y + spec.h; yy++) {
      for (let xx = x; xx < x + spec.w; xx++) {
        const i = this.idx(xx, yy);
        this.blocked[i] = 1;
        if (this.tiles[i] === TILE.FOREST) this.tiles[i] = TILE.GRASS;
      }
    }
    const d = this.idx(b.door.x, b.door.y);
    if (this.tiles[d] === TILE.FOREST) this.tiles[d] = TILE.GRASS;
    this.buildings.push(b);
    return b;
  }

  // Try to place a building of `type` somewhere in the ring [rMin, rMax]
  // around the center, reachable on foot from the well. Returns null on
  // failure so the caller can continue without it.
  placeInRing(rng, type, rMin, rMax, name, tries = 300) {
    const spec = BUILDING_SPECS[type];
    for (let t = 0; t < tries; t++) {
      const r = rng.range(rMin, rMax);
      const a = rng() * Math.PI * 2;
      const x = Math.round(this.center.x + Math.cos(a) * r - spec.w / 2);
      const y = Math.round(this.center.y + Math.sin(a) * r - spec.h / 2);
      if (!this.footprintOk(x, y, spec.w, spec.h)) continue;
      const b = this.addBuilding(type, x, y, name);
      if (this.reachable(this.well.door, b.door)) return b;
      this.removeBuilding(b);
    }
    return null;
  }

  removeBuilding(b) {
    for (let yy = b.y; yy < b.y + b.h; yy++) {
      for (let xx = b.x; xx < b.x + b.w; xx++) this.blocked[this.idx(xx, yy)] = 0;
    }
    this.buildings = this.buildings.filter((o) => o !== b);
    this.buildings.forEach((o, i) => (o.id = i));
  }

  reachable(from, to) {
    const seen = new Uint8Array(this.width * this.height);
    const stack = [from.x, from.y];
    seen[this.idx(from.x, from.y)] = 1;
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      if (x === to.x && y === to.y) return true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!this.isWalkable(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (seen[i]) continue;
        seen[i] = 1;
        stack.push(nx, ny);
      }
    }
    return false;
  }

  placeVillage(rng) {
    const { x: cx, y: cy } = this.center;
    this.well = this.addBuilding('well', cx, cy - 1, 'Village well');
    this.market = this.placeInRing(rng, 'market', 5, 9, 'Market');
    this.tavern = this.placeInRing(rng, 'tavern', 5, 10, 'The Drowned Gull');
    this.houses = [];
    const houseNames = ['Ash', 'Birch', 'Cedar', 'Elm', 'Fir', 'Hazel', 'Ivy', 'Juniper', 'Linden', 'Maple', 'Oak', 'Pine', 'Rowan', 'Willow'];
    for (let i = 0; i < 14; i++) {
      const b = this.placeInRing(rng, 'house', 7, 22, `${houseNames[i]} cottage`);
      if (b) this.houses.push(b);
    }
    this.farms = [];
    for (let i = 0; i < 4; i++) {
      const b = this.placeInRing(rng, 'farm', 20, 32, `${['North', 'East', 'South', 'West'][i]} farm`);
      if (b) this.farms.push(b);
    }
    this.lumber = this.placeLumberCamp(rng);
  }

  placeLumberCamp(rng) {
    // Nearest forest tile to the village that is a bit outside it, then
    // try to put the camp beside it.
    let best = null;
    let bestD = Infinity;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.tiles[this.idx(x, y)] !== TILE.FOREST) continue;
        const d = Math.hypot(x - this.center.x, y - this.center.y);
        if (d > 22 && d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (!best) return this.placeInRing(rng, 'lumber', 24, 34, 'Lumber camp');
    const spec = BUILDING_SPECS.lumber;
    for (let r = 2; r < 12; r++) {
      for (let t = 0; t < 40; t++) {
        const a = rng() * Math.PI * 2;
        const x = Math.round(best.x + Math.cos(a) * r - spec.w / 2);
        const y = Math.round(best.y + Math.sin(a) * r - spec.h / 2);
        if (!this.footprintOk(x, y, spec.w, spec.h)) continue;
        const b = this.addBuilding('lumber', x, y, 'Lumber camp');
        if (this.reachable(this.well.door, b.door)) return b;
        this.removeBuilding(b);
      }
    }
    return this.placeInRing(rng, 'lumber', 24, 34, 'Lumber camp');
  }

  // A random walkable tile within `radius` of a point, or null.
  randomWalkableNear(rng, x, y, radius, tries = 30) {
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * radius;
      const tx = Math.round(x + Math.cos(a) * r);
      const ty = Math.round(y + Math.sin(a) * r);
      if (this.isWalkable(tx, ty)) return { x: tx, y: ty };
    }
    return null;
  }

  nearestForestTile(x, y) {
    let best = null;
    let bestD = Infinity;
    for (let ty = 0; ty < this.height; ty++) {
      for (let tx = 0; tx < this.width; tx++) {
        if (this.tiles[this.idx(tx, ty)] !== TILE.FOREST) continue;
        const d = (tx - x) ** 2 + (ty - y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = { x: tx, y: ty };
        }
      }
    }
    return best;
  }
}
