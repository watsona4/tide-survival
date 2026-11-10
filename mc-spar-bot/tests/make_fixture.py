"""Dump raw sim states + expected obs/logits so the JS port can be verified numerically.
    python tests/make_fixture.py models/policy.json tests/fixture.json
"""
import sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "train"))
import numpy as np, sim, ppo

model, out = sys.argv[1], sys.argv[2]
p = ppo.load_json(model)
rng = np.random.default_rng(7)
s = sim.DuelSim(64, seed=11)
cases = []
for step in range(40):
    acts = np.stack([rng.integers(0, h, (64, 2)) for h in sim.HEADS], -1)
    s.step(acts)
    if step % 4:
        continue
    s.sprint = rng.random((64, 2)) < 0.4
    ob = s.observe()
    logits = ppo.forward(p, ob.reshape(-1, sim.OBS_DIM))[0].reshape(64, 2, -1)
    for e in range(0, 64, 4):
        for i in (0, 1):
            g = lambda a: [float(x) for x in a[e, i]]
            cases.append(dict(
                me=dict(x=float(s.pos[e, i, 0]), z=float(s.pos[e, i, 1]), vx=float(s.vel[e, i, 0]), vz=float(s.vel[e, i, 1]),
                        yaw=float(s.yaw[e, i]), hp=float(s.hp[e, i]), since=float(s.since[e, i]), hurt=float(s.hurt[e, i]), sprint=bool(s.sprint[e, i])),
                opp=dict(x=float(s.pos[e, 1 - i, 0]), z=float(s.pos[e, 1 - i, 1]), vx=float(s.vel[e, 1 - i, 0]), vz=float(s.vel[e, 1 - i, 1]),
                         yaw=float(s.yaw[e, 1 - i]), hp=float(s.hp[e, 1 - i]), since=float(s.since[e, 1 - i]), hurt=float(s.hurt[e, 1 - i]), sprint=bool(s.sprint[e, 1 - i])),
                half=float(s.half[e]), obs=[float(x) for x in ob[e, i]], logits=[float(x) for x in logits[e, i]]))
json.dump(cases, open(out, "w"))
print(len(cases), "cases ->", out)
