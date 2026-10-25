// A* on the world grid, 8-directional without corner cutting.
// Returns an array of {x, y} tile coordinates excluding the start, or null.

class Heap {
  constructor() {
    this.a = [];
  }
  push(node, key) {
    const a = this.a;
    a.push({ node, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top.node;
  }
  get size() {
    return this.a.length;
  }
}

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

export function findPath(world, sx, sy, tx, ty, maxExpansions = 30000) {
  if (!world.isWalkable(tx, ty)) return null;
  if (sx === tx && sy === ty) return [];
  const W = world.width;
  const n = W * world.height;
  const g = new Float32Array(n).fill(Infinity);
  const from = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const h = (x, y) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  const start = sy * W + sx;
  const goal = ty * W + tx;
  g[start] = 0;
  const open = new Heap();
  open.push(start, h(sx, sy));
  let expansions = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goal) break;
    if (++expansions > maxExpansions) return null;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (const [dx, dy, cost] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!world.isWalkable(nx, ny)) continue;
      if (dx && dy && (!world.isWalkable(cx + dx, cy) || !world.isWalkable(cx, cy + dy))) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  if (from[goal] === -1) return null;
  const path = [];
  for (let i = goal; i !== start; i = from[i]) path.push({ x: i % W, y: Math.floor(i / W) });
  path.reverse();
  return path;
}
