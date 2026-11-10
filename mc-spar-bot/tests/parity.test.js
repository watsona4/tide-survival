'use strict';
// Verifies bot/obs.js + bot/policy.js reproduce the Python sim's observations and network outputs.
const fs = require('fs'), path = require('path');
const { buildObs } = require('../bot/obs');
const { Policy } = require('../bot/policy');
const model = process.argv[2] || path.join(__dirname, '../models/policy.json');
const cases = JSON.parse(fs.readFileSync(process.argv[3] || path.join(__dirname, 'fixture.json'), 'utf8'));
const pol = new Policy(model);
let worstObs = 0, worstLogit = 0;
for (const c of cases) {
  const o = buildObs(c.me, c.opp, c.half);
  if (o.length !== c.obs.length) throw new Error(`obs length ${o.length} != ${c.obs.length}`);
  o.forEach((v, i) => { worstObs = Math.max(worstObs, Math.abs(v - c.obs[i])); });
  pol.logits(c.obs).forEach((v, i) => { worstLogit = Math.max(worstLogit, Math.abs(v - c.logits[i])); });
}
console.log(`${cases.length} cases  max|obs err|=${worstObs.toExponential(2)}  max|logit err|=${worstLogit.toExponential(2)}`);
if (worstObs > 1e-4 || worstLogit > 1e-3) { console.error('PARITY FAILED'); process.exit(1); }
console.log('PARITY OK');
