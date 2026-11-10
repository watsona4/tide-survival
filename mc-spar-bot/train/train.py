"""Self-play PPO. Learner = agent 0; agent 1 is a pool snapshot or a scripted fighter.
    python train/train.py --minutes 15 --out models/policy.json
"""
import argparse, time, pathlib, collections
import numpy as np
import ppo, sim
from sim import DuelSim, scripted_actions

ap = argparse.ArgumentParser()
ap.add_argument("--minutes", type=float, default=15)
ap.add_argument("--envs", type=int, default=512)
ap.add_argument("--steps", type=int, default=128)
ap.add_argument("--hidden", type=int, default=128)
ap.add_argument("--seed", type=int, default=0)
ap.add_argument("--out", default="models/policy.json")
ap.add_argument("--resume", default=None)
a = ap.parse_args()

rng = np.random.default_rng(a.seed)
N, T = a.envs, a.steps
p = ppo.load_json(a.resume) if a.resume else ppo.init_params(rng, a.hidden)
if a.resume:
    p["Wv"] = ppo.init_params(rng, a.hidden)["Wv"]          # value head is not exported; relearn it
opt = ppo.Adam(p, 3e-4)
pool = [ppo.copy_params(p)]
env = DuelSim(N, seed=a.seed + 1, obs_noise=0.01, shape=1.0)
obs = env.observe()
CHASER, STRAFER = -1, -2
kind = np.zeros(N, int)


def sample_kind(k):
    u = rng.random(k)
    latest = len(pool) - 1
    snap = np.where(rng.random(k) < 0.5, latest, rng.integers(0, len(pool), k))
    return np.where(u < 0.12, CHASER, np.where(u < 0.24, STRAFER, snap))


kind[:] = sample_kind(N)
stats = {c: collections.deque(maxlen=3000) for c in ("chaser", "strafer", "pool")}
lens = collections.deque(maxlen=3000)
t0, steps, upd = time.time(), 0, 0
deadline = t0 + a.minutes * 60
pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)


def opp_actions():
    out = np.zeros((N, 5), np.int64)
    m = kind == CHASER
    if m.any(): out[m] = scripted_actions(env, np.zeros(N, int))[m]
    m = kind == STRAFER
    if m.any(): out[m] = scripted_actions(env, np.ones(N, int))[m]
    for k in np.unique(kind[kind >= 0]):
        m = kind == k
        out[m] = ppo.act(pool[k], obs[m, 1], rng)[0]
    return out


while time.time() < deadline:
    B = dict(o=[], a=[], lp=[], v=[], r=[], d=[])
    for _ in range(T):
        a0, lp, v = ppo.act(p, obs[:, 0], rng)
        acts = np.stack([a0, opp_actions()], 1)
        o2, r, d, info = env.step(acts)
        for k, x in zip(("o", "a", "lp", "v", "r", "d"), (obs[:, 0], a0, lp, v, r[:, 0], d.astype(np.float32))):
            B[k].append(x)
        if d.any():
            for i in np.nonzero(d)[0]:
                c = "chaser" if kind[i] == CHASER else "strafer" if kind[i] == STRAFER else "pool"
                stats[c].append(info["result"][i, 0]); lens.append(info["length"][i])
            kind[d] = sample_kind(int(d.sum()))
        obs = o2
    steps += N * T
    B = {k: np.array(x) for k, x in B.items()}
    last_v = ppo.forward(p, obs[:, 0])[1]
    adv, ret = ppo.gae(B["r"], B["v"], B["d"], last_v)
    flat = lambda x: x.reshape(N * T, *x.shape[2:])
    O, A, LP, ADV, RET = map(flat, (B["o"], B["a"], B["lp"], adv, ret))
    ADV = (ADV - ADV.mean()) / (ADV.std() + 1e-8)
    frac = max(0.0, 1 - (time.time() - t0) / (a.minutes * 60))
    ent_c = 0.002 + 0.008 * frac
    for _ in range(4):
        perm = rng.permutation(N * T)
        for s in range(0, N * T, 8192):
            ix = perm[s:s + 8192]
            _, g, st = ppo.loss_grads(p, O[ix], A[ix], LP[ix], ADV[ix], RET[ix], ent_c=ent_c)
            opt.step(p, g)
    upd += 1
    if upd % 8 == 0:
        pool.append(ppo.copy_params(p))
        if len(pool) > 10: pool.pop(rng.integers(0, len(pool) - 1))
    if upd % 5 == 0:
        wr = lambda c: f"{np.mean(np.array(stats[c]) == 1):.2f}/{np.mean(np.array(stats[c]) == -1):.2f}" if stats[c] else "-"
        print(f"upd {upd:4d} steps {steps/1e6:6.1f}M  {steps/(time.time()-t0)/1e3:5.0f}k/s  "
              f"win/loss vs chaser {wr('chaser')} strafer {wr('strafer')} pool {wr('pool')}  "
              f"eplen {np.mean(lens) if lens else 0:5.0f} ent {st['ent']:.2f} kl {st['kl']:.4f}", flush=True)
    if upd % 20 == 0:
        ppo.export_json(p, a.out, dict(steps=steps, updates=upd))
ppo.export_json(p, a.out, dict(steps=steps, updates=upd))
print("done:", steps, "steps ->", a.out)
