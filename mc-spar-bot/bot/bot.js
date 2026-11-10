'use strict';
/**
 * Mineflayer sparring bot driven by the PPO policy trained in ../train.
 *   node bot.js --host localhost --port 25565 --name SparBot [--target Steve] [--half 10] [--center x,z] [--greedy]
 * Gives the bot a sword (/give) yourself; it only fights, it does not equip or heal.
 */
const mineflayer = require('mineflayer');
const path = require('path');
const { Policy } = require('./policy');
const { buildObs, strength } = require('./obs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1]?.startsWith('--') || i + 1 >= process.argv.length ? true : process.argv[i + 1]); };
const opts = {
  host: arg('host', 'localhost'), port: +arg('port', 25565), username: arg('name', 'SparBot'),
  version: arg('version', undefined), model: arg('model', path.join(__dirname, '../models/policy.json')),
  target: arg('target', null), half: +arg('half', 14), greedy: arg('greedy', false) === true,
  center: arg('center', null), reach: 3.0,
};
const policy = new Policy(opts.model);
const bot = mineflayer.createBot({ host: opts.host, port: opts.port, username: opts.username, version: opts.version });

// ---- tracked state (ticks are physics ticks, 20 Hz)
let tick = 0, center = null, lock = false;
const me = { since: 100, hurt: 0, sprint: false };
const op = { since: 100, hurt: 0, hp: 20, vx: 0, vz: 0, lastPos: null, lastTick: 0 };
let lastAttackStrength = 1, lastAttackTick = -99, lastSprinting = false;

const targetEntity = () => opts.target
  ? bot.players[opts.target]?.entity
  : bot.nearestEntity((e) => e.type === 'player' && e.username !== bot.username);

bot.once('spawn', () => {
  const p = bot.entity.position;
  center = opts.center ? opts.center.split(',').map(Number) : [p.x, p.z];
  console.log(`spawned; arena centre ${center} half ${opts.half}; model steps ${policy.meta?.steps}`);
});
bot.on('entitySwingArm', (e) => { if (op.ent && e.id === op.ent.id) op.since = 0; });
bot.on('entityHurt', (e) => {
  if (e === bot.entity) me.hurt = 10;
  else if (op.ent && e.id === op.ent.id) {
    op.hurt = 10;
    if (tick - lastAttackTick <= 3) {                       // our hit landed
      op.hp = Math.max(0, op.hp - 7 * 0.5 * (0.2 + 0.8 * lastAttackStrength ** 2));
      if (lastAttackStrength > 0.9 && lastSprinting) lock = true;
    } else op.hp = Math.max(0, op.hp - 3.5);
  }
});
bot.on('death', () => { op.hp = 20; lock = false; });
bot.on('respawn', () => { op.hp = 20; lock = false; });
bot.on('kicked', console.log); bot.on('error', console.log);

bot.on('physicsTick', () => {
  if (!center || !bot.entity) return;
  tick++;
  const e = targetEntity();
  if (!e) { for (const k of ['forward', 'back', 'left', 'right', 'sprint']) bot.setControlState(k, false); return; }
  if (op.ent?.id !== e.id) { op.ent = e; op.hp = 20; op.lastPos = null; }
  me.since = Math.min(me.since + 1, 100); op.since = Math.min(op.since + 1, 100);
  me.hurt = Math.max(me.hurt - 1, 0); op.hurt = Math.max(op.hurt - 1, 0);

  // opponent velocity (blocks/tick) from position deltas; entity updates arrive every ~2 ticks
  const ep = e.position;
  if (op.lastPos && (ep.x !== op.lastPos.x || ep.z !== op.lastPos.z)) {
    const dt = Math.max(1, tick - op.lastTick);
    op.vx = 0.5 * op.vx + 0.5 * (ep.x - op.lastPos.x) / dt; op.vz = 0.5 * op.vz + 0.5 * (ep.z - op.lastPos.z) / dt;
    op.lastPos = { x: ep.x, z: ep.z }; op.lastTick = tick;
  } else if (!op.lastPos) { op.lastPos = { x: ep.x, z: ep.z }; op.lastTick = tick; }
  else if (tick - op.lastTick > 3) { op.vx *= 0.8; op.vz *= 0.8; }

  const bp = bot.entity.position, bv = bot.entity.velocity;
  const ctl = bot.controlState;
  const self = { x: bp.x - center[0], z: bp.z - center[1], vx: bv.x, vz: bv.z, yaw: bot.entity.yaw,
    hp: bot.health ?? 20, since: me.since, hurt: me.hurt, sprint: !!(ctl.sprint && ctl.forward && !lock) };
  const other = { x: ep.x - center[0], z: ep.z - center[1], vx: op.vx, vz: op.vz, yaw: e.yaw,
    hp: op.hp, since: op.since, hurt: op.hurt, sprint: Math.hypot(op.vx, op.vz) > 0.25 };

  const [f, s, sp, tn, at] = policy.act(buildObs(self, other, opts.half), opts.greedy);
  if (!sp) lock = false;
  bot.setControlState('forward', f === 1); bot.setControlState('back', f === 2);
  bot.setControlState('left', s === 1); bot.setControlState('right', s === 2);
  bot.setControlState('sprint', sp === 1);

  const yaw = bot.entity.yaw + policy.turn[tn];
  const dist = Math.hypot(ep.x - bp.x, ep.z - bp.z);
  bot.look(yaw, Math.atan2(ep.y - bp.y, Math.max(dist, 0.1)), true);
  if (at === 1) {
    lastAttackStrength = strength(me.since); lastAttackTick = tick; lastSprinting = self.sprint; me.since = 0;
    if (dist <= opts.reach) bot.attack(e); else bot.swingArm('right');
  }
});
