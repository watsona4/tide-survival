# mc-spar-bot — a Minecraft PvP sparring bot trained with reinforcement learning

A [mineflayer](https://github.com/PrismarineJS/mineflayer) bot whose fighting behaviour is a small neural network
(23 inputs → 128 → 128 → 5 action heads) trained with PPO via self-play. It moves, strafes, sprints, aims
and times its swings on its own — nothing is hand-scripted in the deployed bot.

## Why it trains in a simulator, not in Minecraft
A real server runs at a fixed 20 ticks/s, so the ~70M steps of experience used here would take ~40 days of
wall-clock. `train/sim.py` re-implements the rules that decide a duel and runs ~500k steps/s on CPU, so training
takes minutes. The network is then dropped into mineflayer unchanged.

**Modelled:** walk/sprint speed, 3-block reach with hitbox aim, 1.9+ attack-cooldown damage scaling, 10-tick
invulnerability, knockback (extra on sprint hits), sprint-reset after a hit, walls (arena 12–28 blocks wide),
action latency, observation noise.
**Not modelled (v1):** jumping/crits, blocking/shields, bows, pearls, potions, terrain, armour/enchant tiers.

## Use
```bash
# 1. play (needs a server, a sword in the bot's hand, and the bot + target in an arena)
cd bot && npm install
node bot.js --host localhost --port 25565 --name SparBot --target YourName --half 10
#   --center x,z   arena centre (default: bot's spawn)    --half N  arena half-size, 6..14 matches training
#   --greedy       argmax actions instead of sampling      --model path/to/policy.json

# 2. retrain (pure NumPy; no torch/GPU)
python3 train/train.py --minutes 20 --out models/policy.json     # --resume models/policy.json to continue
python3 train/evaluate.py models/policy.json

# 3. tests
python3 tests/test_grad.py                                        # PPO backprop vs finite differences
python3 tests/make_fixture.py models/policy.json tests/fixture.json && node tests/parity.test.js
```

## How training works
* Learner (agent 0) vs. a mix of: its own recent snapshots (self-play, 76%), a scripted chaser and a scripted
  circle-strafer (12% each) so it can't overfit to one style.
* Reward: damage dealt − damage taken, ±1 for win/loss, tiny time penalty, plus *potential-based* shaping
  (close distance, face the opponent). Without the shaping the bot learned to run away and never discovered
  attacking — the aim window is only ~6°. Potential-based shaping does not change the optimal policy.
* Factored discrete actions: forward/back, strafe, sprint, turn (7 bins, ±45°/tick), attack.

## Known limits / things to verify on a real server
* **Not yet run against a live server** (no Minecraft server was reachable from the build environment).
  Convention parity with mineflayer was checked against `prismarine-physics` source and the Python↔JS
  observation/network outputs match to ~1e-6 (`tests/parity.test.js`), but the first live fight is the real test.
* Opponent HP, swing and invulnerability timers are *estimated* from `entityHurt` / `entitySwingArm` events
  (mineflayer doesn't expose other players' cooldowns); if your server version exposes HP metadata, wiring it
  in `bot.js` will tighten this.
* The sim's gap to real physics (momentum, knockback distance, ping) is the main risk. If the bot behaves oddly,
  tune constants at the top of `train/sim.py` to match your server, then `--resume` training.
