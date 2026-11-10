'use strict';
// Observation builder. MUST stay numerically identical to build_obs() in train/sim.py
// (tests/parity.test.js checks this against fixtures generated from Python).
const MAX_HP = 20, SWING_TICKS = 12.5, INVULN = 10;
const OBS_DIM = 23;

const wrap = (a) => { const t = 2 * Math.PI; return (((a + Math.PI) % t) + t) % t - Math.PI; };
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const strength = (since) => clamp((since + 0.5) / SWING_TICKS, 0, 1);

function wallDist(px, pz, ux, uz, half) {
  const tx = ux > 1e-6 ? (half - px) / ux : ux < -1e-6 ? (-half - px) / ux : Infinity;
  const tz = uz > 1e-6 ? (half - pz) / uz : uz < -1e-6 ? (-half - pz) / uz : Infinity;
  return clamp(Math.min(tx, tz), 0, 24) / 24;
}

/**
 * me / opp: { x, z, vx, vz, yaw, hp, since, hurt, sprint }
 *   x,z relative to arena centre (blocks); vx,vz blocks per TICK; yaw mineflayer radians;
 *   since = ticks since last swing; hurt = remaining invulnerability ticks (0..10).
 * half: arena half-size in blocks.
 */
function buildObs(me, opp, half) {
  const f = [-Math.sin(me.yaw), -Math.cos(me.yaw)];
  const r = [Math.cos(me.yaw), -Math.sin(me.yaw)];
  const loc = (x, z) => [x * f[0] + z * f[1], x * r[0] + z * r[1]];
  const dx = opp.x - me.x, dz = opp.z - me.z;
  const dist = Math.hypot(dx, dz);
  const err = wrap(Math.atan2(-dx, -dz) - me.yaw);
  const eo = wrap(Math.atan2(dx, dz) - opp.yaw);
  const dl = loc(dx, dz);
  const rv = loc(opp.vx - me.vx, opp.vz - me.vz);
  const vl = loc(me.vx, me.vz);
  const o = [
    dl[0] / 10, dl[1] / 10, dist / 10, Math.sin(err), Math.cos(err),
    rv[0] / 0.3, rv[1] / 0.3, vl[0] / 0.3, vl[1] / 0.3, Math.sin(eo), Math.cos(eo),
    me.hp / MAX_HP, opp.hp / MAX_HP, strength(me.since), strength(opp.since),
    me.hurt / INVULN, opp.hurt / INVULN, me.sprint ? 1 : 0, opp.sprint ? 1 : 0,
    wallDist(me.x, me.z, f[0], f[1], half), wallDist(me.x, me.z, -f[0], -f[1], half),
    wallDist(me.x, me.z, r[0], r[1], half), wallDist(me.x, me.z, -r[0], -r[1], half),
  ];
  return o;
}

module.exports = { buildObs, strength, wrap, OBS_DIM, MAX_HP, INVULN, SWING_TICKS };
