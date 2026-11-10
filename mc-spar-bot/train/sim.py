"""Vectorised 2-player Minecraft sword-duel simulator (NumPy, 20 tick/s).

Models the parts of 1.9+ melee that decide a spar: walk/sprint speed, 3-block
reach + hitbox aim, attack-cooldown damage scaling, 10-tick invulnerability,
knockback, sprint-reset, walls. Yaw convention == mineflayer / prismarine:
    forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)   in (x, z)
Not modelled (v1): jumping/crits, blocking, bows, pearls, terrain, armour tiers.
"""
import numpy as np

TPS = 20
WALK = 4.317 / TPS          # blocks / tick
SPRINT = 5.612 / TPS
ACCEL = 0.4                 # fraction of (target - vel) closed per tick
REACH = 3.0
HIT_W = 0.3                 # hitbox half-width
BODY = 0.6                  # collision diameter
MAX_HP = 20.0
SWORD_DMG = 7.0             # diamond sword
SWING_TICKS = 12.5          # 20 / attack_speed(1.6)
INVULN = 10
KB = 0.4
ARMOR_MUL = 0.5             # fights last ~6 hits instead of 3
MAX_T = 600                 # 30 s
TURN = np.radians([-45, -15, -4, 0, 4, 15, 45]).astype(np.float32)
HEADS = (3, 3, 2, 7, 2)     # fwd/back, strafe, sprint, turn, attack
OBS_DIM = 23
F32 = np.float32


def wrap(a):
    return (a + np.pi) % (2 * np.pi) - np.pi


def frames(yaw):
    s, c = np.sin(yaw), np.cos(yaw)
    return np.stack([-s, -c], -1), np.stack([c, -s], -1)


def strength_of(since):
    return np.clip((since + 0.5) / SWING_TICKS, 0.0, 1.0)


class DuelSim:
    def __init__(self, n, seed=0, obs_noise=0.0, lag_p=0.15, shape=0.0):
        self.n, self.obs_noise, self.lag_p, self.shape = n, obs_noise, lag_p, shape
        self.rng = np.random.default_rng(seed)
        z2 = lambda: np.zeros((n, 2, 2), F32)
        self.pos, self.vel = z2(), z2()
        self.yaw = np.zeros((n, 2), F32)
        self.hp = np.full((n, 2), MAX_HP, F32)
        self.since = np.zeros((n, 2), F32)
        self.hurt = np.zeros((n, 2), F32)
        self.sprint = np.zeros((n, 2), bool)
        self.lock = np.zeros((n, 2), bool)
        self.half = np.full(n, 12.0, F32)
        self.t = np.zeros(n, np.int32)
        self.prev = np.zeros((n, 2, 5), np.int64)
        self.reset(np.ones(n, bool))

    def reset(self, m):
        k = int(m.sum())
        if k == 0:
            return
        r = self.rng
        half = r.uniform(6, 14, k).astype(F32)
        ang = r.uniform(0, 2 * np.pi, k)
        sep = r.uniform(3, np.minimum(10, 1.6 * half))
        c = r.uniform(-0.3, 0.3, (k, 2)) * half[:, None]
        u = np.stack([np.cos(ang), np.sin(ang)], -1) * (sep / 2)[:, None]
        p = np.stack([c + u, c - u], 1)
        lim = (half - 0.5)[:, None, None]
        self.pos[m] = np.clip(p, -lim, lim)
        self.vel[m] = 0
        self.yaw[m] = r.uniform(-np.pi, np.pi, (k, 2))
        self.hp[m] = MAX_HP
        self.since[m] = r.uniform(0, 20, (k, 2))
        self.hurt[m] = 0
        self.sprint[m] = False
        self.lock[m] = False
        self.half[m] = half
        self.t[m] = 0
        self.prev[m] = 0

    # ------------------------------------------------------------------
    def _phi(self):
        """Potential: be close to and facing the opponent (potential-based => optimal policy unchanged)."""
        d = self.pos[:, ::-1] - self.pos
        dist = np.linalg.norm(d, axis=-1)
        err = wrap(np.arctan2(-d[..., 0], -d[..., 1]) - self.yaw)
        return -0.5 * np.minimum(dist, 10) / 10 + 0.3 * np.cos(err) * (dist < 10)

    def step(self, acts):
        n, rng = self.n, self.rng
        phi0 = self._phi() if self.shape else 0.0
        lag = rng.random((n, 2)) < self.lag_p
        a = np.where(lag[..., None], self.prev, acts)
        self.prev = a.copy()

        fwd = np.where(a[..., 0] == 1, 1.0, np.where(a[..., 0] == 2, -1.0, 0.0)).astype(F32)
        stf = np.where(a[..., 1] == 2, 1.0, np.where(a[..., 1] == 1, -1.0, 0.0)).astype(F32)
        want = a[..., 2] == 1
        self.yaw = wrap(self.yaw + TURN[a[..., 3]]).astype(F32)
        self.lock &= want
        spr = want & (fwd > 0) & ~self.lock

        f, r = frames(self.yaw)
        dv = fwd[..., None] * f + stf[..., None] * r
        dv /= np.maximum(np.linalg.norm(dv, axis=-1, keepdims=True), 1.0)
        target = dv * np.where(spr, SPRINT, WALK)[..., None]
        self.vel += (target - self.vel) * ACCEL
        self.pos += self.vel

        lim = (self.half - 0.3)[:, None, None]
        over = np.abs(self.pos) > lim
        self.pos = np.clip(self.pos, -lim, lim)
        self.vel[over] = 0

        d = self.pos[:, 1] - self.pos[:, 0]
        dist = np.linalg.norm(d, axis=-1)
        ov = np.maximum(BODY - dist, 0) / 2
        push = d / np.maximum(dist, 1e-6)[:, None] * ov[:, None]
        self.pos[:, 0] -= push
        self.pos[:, 1] += push

        # ---- combat
        self.hurt = np.maximum(self.hurt - 1, 0)
        d = self.pos[:, ::-1] - self.pos
        dist = np.linalg.norm(d, axis=-1)
        err = wrap(np.arctan2(-d[..., 0], -d[..., 1]) - self.yaw)
        aimed = np.abs(err) <= np.arctan2(HIT_W, np.maximum(dist, 0.3)) + 0.03
        swing = a[..., 4] == 1
        s = strength_of(self.since)
        land = swing & (dist <= REACH) & aimed & (self.hurt[:, ::-1] == 0)
        dmg = SWORD_DMG * (0.2 + 0.8 * s * s) * ARMOR_MUL * land
        taken = dmg[:, ::-1]
        self.hp = self.hp - taken
        self.hurt = np.where(land[:, ::-1], INVULN, self.hurt)
        strong = land & (s > 0.9) & spr
        mag = KB * (1 + strong)
        imp = d / np.maximum(dist, 1e-6)[..., None] * (mag * land)[..., None]
        self.vel += imp[:, ::-1]
        self.vel *= np.where(strong, 0.6, 1.0)[..., None]
        self.lock |= strong
        self.sprint = spr & ~strong
        self.since = np.where(swing, 0.0, np.minimum(self.since + 1, 100.0)).astype(F32)

        # ---- reward / termination
        rew = (dmg - taken) / MAX_HP - 0.0005
        dead = self.hp <= 0
        rew += np.where(dead[:, ::-1] & ~dead, 1.0, 0.0) - np.where(dead & ~dead[:, ::-1], 1.0, 0.0)
        self.t += 1
        done = dead.any(1) | (self.t >= MAX_T)
        if self.shape:
            rew += self.shape * np.where(done[:, None], 0.0, 0.99 * self._phi() - phi0)
        diff = self.hp - self.hp[:, ::-1]
        res = np.where(dead.any(1)[:, None], np.where(dead[:, ::-1] & ~dead, 1, np.where(dead & ~dead[:, ::-1], -1, 0)),
                       np.sign(diff).astype(int))
        info = dict(result=res, length=self.t.copy(), hits=land.copy())
        self.reset(done)
        return self.observe(), rew.astype(F32), done, info

    # ------------------------------------------------------------------
    def observe(self):
        return build_obs(self.pos, self.vel, self.yaw, self.hp, self.since, self.hurt,
                         self.sprint, self.half, self.rng, self.obs_noise)


def build_obs(pos, vel, yaw, hp, since, hurt, sprint, half, rng=None, noise=0.0):
    """All inputs shaped (n, 2, ...) with agent axis 1; returns (n, 2, OBS_DIM).
    pos is relative to the arena centre. MUST stay identical to bot/obs.js."""
    f, r = frames(yaw)
    o = lambda x: x[:, ::-1]
    d = o(pos) - pos
    dist = np.linalg.norm(d, axis=-1)
    err = wrap(np.arctan2(-d[..., 0], -d[..., 1]) - yaw)
    loc = lambda v: np.stack([(v * f).sum(-1), (v * r).sum(-1)], -1)
    eo = wrap(np.arctan2(d[..., 0], d[..., 1]) - o(yaw))
    s = strength_of(since)
    h = half[:, None, None]
    walls = []
    for u in (f, -f, r, -r):
        ux, uz = u[..., 0], u[..., 1]
        px, pz = pos[..., 0], pos[..., 1]
        with np.errstate(divide="ignore", invalid="ignore"):
            tx = np.where(ux > 1e-6, (h[..., 0] - px) / ux, np.where(ux < -1e-6, (-h[..., 0] - px) / ux, np.inf))
            tz = np.where(uz > 1e-6, (h[..., 0] - pz) / uz, np.where(uz < -1e-6, (-h[..., 0] - pz) / uz, np.inf))
        walls.append(np.clip(np.minimum(tx, tz), 0, 24) / 24)
    ob = np.concatenate([
        loc(d) / 10, (dist / 10)[..., None], np.sin(err)[..., None], np.cos(err)[..., None],
        loc(o(vel) - vel) / 0.3, loc(vel) / 0.3, np.sin(eo)[..., None], np.cos(eo)[..., None],
        (hp / MAX_HP)[..., None], (o(hp) / MAX_HP)[..., None],
        s[..., None], o(s)[..., None], (hurt / INVULN)[..., None], (o(hurt) / INVULN)[..., None],
        sprint[..., None].astype(F32), o(sprint)[..., None].astype(F32),
        np.stack(walls, -1)], -1).astype(F32)
    if noise > 0 and rng is not None:
        ob += rng.normal(0, noise, ob.shape).astype(F32)
    return ob


# ---------------------------------------------------------------------- scripted opponents
def scripted_actions(sim, kinds):
    """Agent-1 actions. kinds: 0 = chaser, 1 = circle-strafer (n,)."""
    d = sim.pos[:, 0] - sim.pos[:, 1]
    dist = np.linalg.norm(d, axis=-1)
    err = wrap(np.arctan2(-d[:, 0], -d[:, 1]) - sim.yaw[:, 1])
    turn = np.abs(TURN[None, :] - err[:, None]).argmin(1)
    fwd = np.where(dist > 2.2, 1, np.where(dist < 1.2, 2, 0))
    spr = (dist > 4).astype(int)
    atk = ((dist <= REACH) & (np.abs(err) < 0.12) & (sim.since[:, 1] >= 12)).astype(int)
    phase = ((sim.t // 15) % 2) + 1
    stf = np.where((kinds == 1) & (dist < 5), phase, 0)
    return np.stack([fwd, stf, spr, turn, atk], -1)
