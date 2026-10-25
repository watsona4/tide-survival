#!/usr/bin/env node
// CLI driver for the headless simulation.
//
//   node sim/run.js                      # all strategies, 200 trials x 300 s
//   node sim/run.js --strategy mud-stack # one strategy
//   node sim/run.js --trials 1000 --seconds 600 --seed 42
//   node sim/run.js --config '{"dangerWaveChance":0.4}'
//   node sim/run.js --json               # machine-readable output
//
// Exits non-zero on bad arguments; otherwise prints a table (or JSON).

import { runMany, summarize } from './simulation.js';
import { STRATEGIES } from './strategies.js';

function parseArgs(argv) {
  const args = { trials: 200, seconds: 300, dt: 1 / 60, seed: 1000, strategy: null, config: {}, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case '--trials': args.trials = Number(next()); break;
      case '--seconds': args.seconds = Number(next()); break;
      case '--dt': args.dt = Number(next()); break;
      case '--seed': args.seed = Number(next()); break;
      case '--strategy': args.strategy = next(); break;
      case '--config': args.config = JSON.parse(next()); break;
      case '--json': args.json = true; break;
      case '--help':
      case '-h':
        console.log(`usage: node sim/run.js [--strategy NAME] [--trials N] [--seconds S] [--dt D] [--seed N] [--config JSON] [--json]
strategies: ${Object.keys(STRATEGIES).join(', ')}`);
        process.exit(0);
      default:
        throw new Error(`unknown argument ${a}`);
    }
  }
  for (const k of ['trials', 'seconds', 'dt', 'seed']) {
    if (!Number.isFinite(args[k]) || args[k] <= 0) throw new Error(`--${k} must be a positive number`);
  }
  if (args.strategy && !STRATEGIES[args.strategy]) {
    throw new Error(`unknown strategy ${args.strategy}; have ${Object.keys(STRATEGIES).join(', ')}`);
  }
  return args;
}

function fmt(n, digits = 2) {
  return Number.isFinite(n) ? n.toFixed(digits) : String(n);
}

function pad(s, w, right = false) {
  s = String(s);
  return right ? s.padStart(w) : s.padEnd(w);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }

  const names = args.strategy ? [args.strategy] : Object.keys(STRATEGIES);
  const report = {};
  for (const name of names) {
    const results = runMany({
      strategy: STRATEGIES[name],
      trials: args.trials,
      seconds: args.seconds,
      dt: args.dt,
      seedBase: args.seed,
      config: args.config,
    });
    report[name] = summarize(results);
  }

  if (args.json) {
    console.log(JSON.stringify({ args, report }, null, 2));
    return;
  }

  const first = report[names[0]];
  const totalHits = first.wavesHitTotal.normal + first.wavesHitTotal.danger + first.wavesHitTotal.killer;
  console.log(
    `${args.trials} trials x ${args.seconds}s, dt=${fmt(args.dt, 4)}, seeds ${args.seed}..${args.seed + args.trials - 1}`,
  );
  console.log(
    `waves hit per trial: ${fmt(totalHits / args.trials, 1)} ` +
      `(danger ${fmt((100 * first.wavesHitTotal.danger) / totalHits, 1)}%, killer ${fmt((100 * first.wavesHitTotal.killer) / totalHits, 2)}%)`,
  );
  if (Object.keys(args.config).length) console.log(`config overrides: ${JSON.stringify(args.config)}`);
  console.log();

  const cols = [
    ['strategy', 15, false],
    ['meanH', 8, true],
    ['maxH', 8, true],
    ['finalH', 8, true],
    ['uptime', 8, true],
    ['wipes', 8, true],
    ['H*s/unit', 10, true],
  ];
  console.log(cols.map(([h, w, r]) => pad(h, w, r)).join(' '));
  console.log(cols.map(([, w]) => '-'.repeat(w)).join(' '));
  for (const name of names) {
    const r = report[name];
    const row = [
      pad(name, 15),
      pad(fmt(r.meanHeight.mean, 1), 8, true),
      pad(fmt(r.maxHeight.mean, 1), 8, true),
      pad(fmt(r.finalHeight.mean, 1), 8, true),
      pad(fmt(100 * r.uptime.mean, 1) + '%', 8, true),
      pad(fmt(r.wipes.mean, 1), 8, true),
      pad(fmt(r.heightSecondsPerUnit.mean, 2), 10, true),
    ];
    console.log(row.join(' '));
  }
  console.log();
  console.log('meanH/maxH/finalH: total structure height (all materials) averaged over trials.');
  console.log('uptime: fraction of run time with at least one structure standing.');
  console.log('wipes: damaging wave hits after which nothing was left standing.');
  console.log('H*s/unit: height-seconds of standing structure bought per resource unit spent.');
}

main();
