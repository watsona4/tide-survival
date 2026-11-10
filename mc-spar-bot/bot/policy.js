'use strict';
const fs = require('fs');

class Policy {
  constructor(path) {
    const d = JSON.parse(fs.readFileSync(path, 'utf8'));
    this.heads = d.heads; this.turn = d.turn; this.obsDim = d.obs_dim; this.meta = d.meta;
    this.L = d.layers; // W (in x out) row-major nested arrays
  }
  static dense(x, W, b, tanh) {
    const out = b.slice();
    for (let i = 0; i < x.length; i++) {
      const xi = x[i], row = W[i];
      for (let j = 0; j < out.length; j++) out[j] += xi * row[j];
    }
    return tanh ? out.map(Math.tanh) : out;
  }
  logits(obs) {
    const h1 = Policy.dense(obs, this.L.W1, this.L.b1, true);
    const h2 = Policy.dense(h1, this.L.W2, this.L.b2, true);
    return Policy.dense(h2, this.L.Wp, this.L.bp, false);
  }
  /** returns [fwd, strafe, sprint, turnBin, attack]; greedy=argmax, else sample. */
  act(obs, greedy = false, rnd = Math.random) {
    const z = this.logits(obs), out = [];
    let off = 0;
    for (const n of this.heads) {
      const s = z.slice(off, off + n); off += n;
      if (greedy) { out.push(s.indexOf(Math.max(...s))); continue; }
      const m = Math.max(...s), e = s.map((v) => Math.exp(v - m)), t = e.reduce((a, b) => a + b, 0);
      let u = rnd() * t, k = 0;
      while (k < n - 1 && (u -= e[k]) > 0) k++;
      out.push(k);
    }
    return out;
  }
}
module.exports = { Policy };
