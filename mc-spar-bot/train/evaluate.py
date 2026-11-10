"""Benchmark a policy: win/draw/loss vs scripted fighters and a random-action agent, no shaping/noise.
    python train/evaluate.py models/policy.json
"""
import sys
import numpy as np
import ppo, sim
from sim import DuelSim, scripted_actions

p = ppo.load_json(sys.argv[1] if len(sys.argv) > 1 else "models/policy.json")
EP = 3000
rng = np.random.default_rng(123)


def run(opp, greedy):
    env = DuelSim(1024, seed=5, lag_p=0.15)
    obs, res, lens = env.observe(), [], []
    while len(res) < EP:
        a0 = ppo.act(p, obs[:, 0], rng, greedy)[0]
        if opp == "chaser": a1 = scripted_actions(env, np.zeros(1024, int))
        elif opp == "strafer": a1 = scripted_actions(env, np.ones(1024, int))
        elif opp == "random": a1 = np.stack([rng.integers(0, h, 1024) for h in sim.HEADS], 1)
        else: a1 = ppo.act(p, obs[:, 1], rng, greedy)[0]                     # mirror match
        obs, _, d, info = env.step(np.stack([a0, a1], 1))
        res += list(info["result"][d, 0]); lens += list(info["length"][d])
    r = np.array(res[:EP])
    return (r == 1).mean(), (r == 0).mean(), (r == -1).mean(), np.mean(lens)


print(f"{'opponent':10s} {'mode':8s}   win   draw  loss  avg fight (s)")
for greedy in (False, True):
    for opp in ("chaser", "strafer", "random", "self"):
        w, d, l, n = run(opp, greedy)
        print(f"{opp:10s} {'greedy' if greedy else 'sample':8s}  {w:.3f} {d:.3f} {l:.3f}  {n/20:5.1f}")
