"""Pure-NumPy PPO for a factored-discrete-action MLP policy (no torch needed)."""
import json
import numpy as np
from sim import HEADS, OBS_DIM, TURN

NA = sum(HEADS)
OFF = np.concatenate([[0], np.cumsum(HEADS)])


def init_params(rng, hidden=128, dtype=np.float32):
    def lin(i, o, scale):
        w = rng.normal(0, 1, (i, o))
        w *= scale / np.sqrt((w ** 2).sum(0, keepdims=True) / 1.0) * np.sqrt(1.0)
        return w.astype(dtype)
    return dict(W1=lin(OBS_DIM, hidden, np.sqrt(2)), b1=np.zeros(hidden, dtype),
                W2=lin(hidden, hidden, np.sqrt(2)), b2=np.zeros(hidden, dtype),
                Wp=lin(hidden, NA, 0.01), bp=np.zeros(NA, dtype),
                Wv=lin(hidden, 1, 1.0), bv=np.zeros(1, dtype))


def copy_params(p):
    return {k: v.copy() for k, v in p.items()}


def forward(p, x):
    h1 = np.tanh(x @ p["W1"] + p["b1"])
    h2 = np.tanh(h1 @ p["W2"] + p["b2"])
    return h2 @ p["Wp"] + p["bp"], (h2 @ p["Wv"] + p["bv"])[:, 0], (x, h1, h2)


def head_lp(logits):
    out = []
    for k in range(len(HEADS)):
        z = logits[:, OFF[k]:OFF[k + 1]]
        z = z - z.max(1, keepdims=True)
        out.append(z - np.log(np.exp(z).sum(1, keepdims=True)))
    return out


def act(p, x, rng, greedy=False):
    logits, v, _ = forward(p, x)
    acts = np.zeros((len(x), len(HEADS)), np.int64)
    lp_tot = np.zeros(len(x), x.dtype)
    for k, lp in enumerate(head_lp(logits)):
        if greedy:
            a = lp.argmax(1)
        else:
            g = -np.log(-np.log(rng.random(lp.shape) + 1e-12) + 1e-12)
            a = (lp + g).argmax(1)
        acts[:, k] = a
        lp_tot += lp[np.arange(len(x)), a]
    return acts, lp_tot, v


def loss_grads(p, obs, acts, old_lp, adv, ret, clip=0.2, vf=0.5, ent_c=0.01):
    B = len(obs)
    logits, v, (x, h1, h2) = forward(p, obs)
    lps = head_lp(logits)
    lp = sum(l[np.arange(B), acts[:, k]] for k, l in enumerate(lps))
    ratio = np.exp(lp - old_lp)
    surr = np.minimum(ratio * adv, np.clip(ratio, 1 - clip, 1 + clip) * adv)
    active = ((adv >= 0) & (ratio < 1 + clip)) | ((adv < 0) & (ratio > 1 - clip))
    g_lp = np.where(active, -adv * ratio, 0.0)           # dL/dlogp
    dz = np.zeros_like(logits)
    ent = 0.0
    for k, l in enumerate(lps):
        pk = np.exp(l)
        H = -(pk * l).sum(1, keepdims=True)
        ent += H.mean()
        onehot = np.zeros_like(pk)
        onehot[np.arange(B), acts[:, k]] = 1
        dz[:, OFF[k]:OFF[k + 1]] = g_lp[:, None] * (onehot - pk) + ent_c * pk * (l + H)
    dz /= B
    dv = (vf * (v - ret) / B)[:, None]
    loss = -surr.mean() + 0.5 * vf * ((v - ret) ** 2).mean() - ent_c * ent
    g = {}
    g["Wp"], g["bp"] = h2.T @ dz, dz.sum(0)
    g["Wv"], g["bv"] = h2.T @ dv, dv.sum(0)
    d2 = (dz @ p["Wp"].T + dv @ p["Wv"].T) * (1 - h2 ** 2)
    g["W2"], g["b2"] = h1.T @ d2, d2.sum(0)
    d1 = (d2 @ p["W2"].T) * (1 - h1 ** 2)
    g["W1"], g["b1"] = x.T @ d1, d1.sum(0)
    return loss, g, dict(ent=ent, kl=float((old_lp - lp).mean()), clipfrac=float((~active).mean()))


class Adam:
    def __init__(self, p, lr=3e-4):
        self.m = {k: np.zeros_like(v) for k, v in p.items()}
        self.v = {k: np.zeros_like(v) for k, v in p.items()}
        self.t, self.lr = 0, lr

    def step(self, p, g, max_norm=0.5):
        gn = np.sqrt(sum((x.astype(np.float64) ** 2).sum() for x in g.values()))
        sc = min(1.0, max_norm / (gn + 1e-8))
        self.t += 1
        for k in p:
            gk = g[k] * sc
            self.m[k] = 0.9 * self.m[k] + 0.1 * gk
            self.v[k] = 0.999 * self.v[k] + 0.001 * gk * gk
            mh = self.m[k] / (1 - 0.9 ** self.t)
            vh = self.v[k] / (1 - 0.999 ** self.t)
            p[k] -= (self.lr * mh / (np.sqrt(vh) + 1e-8)).astype(p[k].dtype)
        return gn


def gae(rew, val, done, last_v, gamma=0.99, lam=0.95):
    T = len(rew)
    adv = np.zeros_like(rew)
    last = 0.0
    for t in reversed(range(T)):
        nv = last_v if t == T - 1 else val[t + 1]
        nd = 1.0 - done[t]
        delta = rew[t] + gamma * nv * nd - val[t]
        last = delta + gamma * lam * nd * last
        adv[t] = last
    return adv, adv + val


def export_json(p, path, meta=None):
    d = dict(obs_dim=OBS_DIM, heads=list(HEADS), turn=[float(t) for t in TURN],
             layers={k: np.asarray(v, np.float64).round(6).tolist() for k, v in p.items() if k not in ("Wv", "bv")})
    d["meta"] = meta or {}
    with open(path, "w") as f:
        json.dump(d, f, separators=(",", ":"))


def load_json(path):
    d = json.load(open(path))
    return {k: np.array(v, np.float32) for k, v in d["layers"].items()} | {
        "Wv": np.zeros((len(d["layers"]["W2"][0]), 1), np.float32), "bv": np.zeros(1, np.float32)}
