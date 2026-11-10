"""Numerical gradient check of the hand-written PPO backprop."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "train"))
import numpy as np, ppo
from sim import HEADS, OBS_DIM

rng = np.random.default_rng(0)
p = {k: v.astype(np.float64) for k, v in ppo.init_params(rng, 16).items()}
for k in ("Wp", "Wv"):
    p[k] = rng.normal(0, 0.3, p[k].shape)           # non-trivial heads
B = 32
obs = rng.normal(0, 1, (B, OBS_DIM))
acts = np.stack([rng.integers(0, h, B) for h in HEADS], 1)
_, lp0, _ = ppo.act(p, obs, rng)
old_lp = lp0 - rng.normal(0, 0.05, B)
adv, ret = rng.normal(0, 1, B), rng.normal(0, 1, B)
loss, g, _ = ppo.loss_grads(p, obs, acts, old_lp, adv, ret)
worst = 0
for k in p:
    idx = tuple(rng.integers(0, s) for s in p[k].shape)
    for _ in range(4):
        idx = tuple(rng.integers(0, s) for s in p[k].shape)
        e = 1e-6
        p[k][idx] += e; lp_, *_ = ppo.loss_grads(p, obs, acts, old_lp, adv, ret)
        p[k][idx] -= 2 * e; lm_, *_ = ppo.loss_grads(p, obs, acts, old_lp, adv, ret)
        p[k][idx] += e
        num = (lp_ - lm_) / (2 * e)
        rel = abs(num - g[k][idx]) / max(1e-8, abs(num) + abs(g[k][idx]))
        worst = max(worst, rel)
print("worst relative grad error:", worst)
assert worst < 1e-4, "gradient mismatch"
print("OK")
