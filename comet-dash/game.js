const canvas = document.createElement('canvas');
document.getElementById('app').appendChild(canvas);
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

let state = 'title';

const BEST_SCORE_KEY = 'cometDashBest';
let bestScore = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;

// --- audio ---------------------------------------------------------------

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playPickup() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12);
  gain.gain.setValueAtTime(0.18, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.16);
}

function playHit() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.33);
}

function playGameOver() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  [440, 349, 261, 196].forEach((freq, i) => {
    const start = now + i * 0.14;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.2, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.22);
  });
}

// --- input -----------------------------------------------------------------

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (state === 'title' || state === 'gameover') startGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener('click', () => {
  if (state === 'title' || state === 'gameover') startGame();
});

// --- constants ---------------------------------------------------------------

const PLAYER_RADIUS = 14;
const PLAYER_ACCEL = 1400;
const PLAYER_DRAG = 6;
const PLAYER_MAX_SPEED = 480;
const START_LIVES = 3;
const INVINCIBLE_TIME = 1.2;

const MIN_SPAWN_INTERVAL = 0.18;
const BASE_SPAWN_INTERVAL = 0.9;
const BASE_ASTEROID_SPEED = 140;
const MAX_ASTEROID_SPEED_BONUS = 260;

const ORB_SPAWN_INTERVAL = 2.4;
const ORB_SCORE = 25;
const SCORE_PER_SECOND = 10;

// --- state -----------------------------------------------------------------

let player, asteroids, orbs, particles, stars;
let lives, elapsed, score, invincibleTimer;
let asteroidSpawnTimer, orbSpawnTimer;

function resetGame() {
  player = { x: canvas.width / 2, y: canvas.height * 0.75, vx: 0, vy: 0 };
  asteroids = [];
  orbs = [];
  particles = [];
  lives = START_LIVES;
  elapsed = 0;
  score = 0;
  invincibleTimer = 0;
  asteroidSpawnTimer = BASE_SPAWN_INTERVAL;
  orbSpawnTimer = ORB_SPAWN_INTERVAL;
  if (!stars) initStars();
}

function initStars() {
  stars = [];
  const count = 140;
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      speed: 20 + Math.random() * 80,
      size: 1 + Math.random() * 2,
    });
  }
}

function startGame() {
  resetGame();
  state = 'playing';
  ensureAudio();
}

function endGame() {
  state = 'gameover';
  playGameOver();
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
  }
}

// --- update ------------------------------------------------------------------

function difficultyFraction() {
  return Math.min(1, elapsed / 60); // ramps up over the first minute
}

function currentSpawnInterval() {
  return BASE_SPAWN_INTERVAL - (BASE_SPAWN_INTERVAL - MIN_SPAWN_INTERVAL) * difficultyFraction();
}

function currentAsteroidSpeed() {
  return BASE_ASTEROID_SPEED + MAX_ASTEROID_SPEED_BONUS * difficultyFraction();
}

function spawnAsteroid() {
  const radius = 14 + Math.random() * 26;
  const x = radius + Math.random() * (canvas.width - radius * 2);
  const speed = currentAsteroidSpeed() * (0.7 + Math.random() * 0.6) * (1 - radius / 90);
  const sides = 6 + Math.floor(Math.random() * 4);
  const jitter = Array.from({ length: sides }, () => 0.75 + Math.random() * 0.5);
  asteroids.push({ x, y: -radius, radius, speed, sides, jitter, spin: (Math.random() - 0.5) * 2, angle: 0 });
}

function spawnOrb() {
  const radius = 10;
  const x = radius + Math.random() * (canvas.width - radius * 2);
  orbs.push({ x, y: -radius, radius, speed: 110 });
}

function spawnExplosion(x, y, color) {
  const count = 18;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
    const speed = 60 + Math.random() * 220;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5 + Math.random() * 0.4,
      maxLife: 0.9,
      color,
    });
  }
}

function updatePlayer(dt) {
  let ax = 0, ay = 0;
  if (keys.has('arrowleft') || keys.has('a')) ax -= 1;
  if (keys.has('arrowright') || keys.has('d')) ax += 1;
  if (keys.has('arrowup') || keys.has('w')) ay -= 1;
  if (keys.has('arrowdown') || keys.has('s')) ay += 1;

  const len = Math.hypot(ax, ay);
  if (len > 0) {
    player.vx += (ax / len) * PLAYER_ACCEL * dt;
    player.vy += (ay / len) * PLAYER_ACCEL * dt;
  }

  const dragFactor = Math.max(0, 1 - PLAYER_DRAG * dt);
  player.vx *= dragFactor;
  player.vy *= dragFactor;

  const speed = Math.hypot(player.vx, player.vy);
  if (speed > PLAYER_MAX_SPEED) {
    player.vx = (player.vx / speed) * PLAYER_MAX_SPEED;
    player.vy = (player.vy / speed) * PLAYER_MAX_SPEED;
  }

  player.x += player.vx * dt;
  player.y += player.vy * dt;
  player.x = Math.max(PLAYER_RADIUS, Math.min(canvas.width - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(canvas.height - PLAYER_RADIUS, player.y));
}

function update(dt) {
  for (const s of (stars || [])) {
    s.y += s.speed * dt * (state === 'playing' ? 1 : 0.3);
    if (s.y > canvas.height) {
      s.y = 0;
      s.x = Math.random() * canvas.width;
    }
  }

  if (state !== 'playing') return;

  elapsed += dt;
  score += SCORE_PER_SECOND * dt;
  if (invincibleTimer > 0) invincibleTimer -= dt;

  updatePlayer(dt);

  asteroidSpawnTimer -= dt;
  if (asteroidSpawnTimer <= 0) {
    asteroidSpawnTimer = currentSpawnInterval();
    spawnAsteroid();
  }

  orbSpawnTimer -= dt;
  if (orbSpawnTimer <= 0) {
    orbSpawnTimer = ORB_SPAWN_INTERVAL;
    spawnOrb();
  }

  for (const a of asteroids) {
    a.y += a.speed * dt;
    a.angle += a.spin * dt;
  }
  asteroids = asteroids.filter((a) => a.y - a.radius < canvas.height + 40);

  for (const o of orbs) o.y += o.speed * dt;
  orbs = orbs.filter((o) => o.y - o.radius < canvas.height + 40);

  for (const p of particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 1 - 2 * dt;
    p.vy *= 1 - 2 * dt;
    p.life -= dt;
  }
  particles = particles.filter((p) => p.life > 0);

  handleCollisions();
}

function handleCollisions() {
  if (invincibleTimer <= 0) {
    for (const a of asteroids) {
      const dist = Math.hypot(a.x - player.x, a.y - player.y);
      if (dist < a.radius + PLAYER_RADIUS * 0.7) {
        hitAsteroid(a);
        break;
      }
    }
  }

  orbs = orbs.filter((o) => {
    const dist = Math.hypot(o.x - player.x, o.y - player.y);
    if (dist < o.radius + PLAYER_RADIUS) {
      score += ORB_SCORE;
      spawnExplosion(o.x, o.y, '#7ef7d0');
      playPickup();
      return false;
    }
    return true;
  });
}

function hitAsteroid(asteroid) {
  asteroids = asteroids.filter((a) => a !== asteroid);
  spawnExplosion(player.x, player.y, '#ff8a5c');
  playHit();
  lives -= 1;
  invincibleTimer = INVINCIBLE_TIME;
  if (lives <= 0) endGame();
}

// --- render ------------------------------------------------------------------

function formatScore(n) {
  return Math.floor(n).toLocaleString();
}

function renderStars() {
  ctx.fillStyle = '#e6f6ff';
  for (const s of stars) {
    ctx.globalAlpha = 0.5 + 0.5 * (s.size / 3);
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
  ctx.globalAlpha = 1;
}

function renderBackground() {
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  renderStars();
}

function renderTitle() {
  renderBackground();

  ctx.fillStyle = '#e6f6ff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Comet Dash', canvas.width / 2, canvas.height / 2 - 100);

  ctx.font = '18px sans-serif';
  ctx.fillStyle = 'rgba(230, 246, 255, 0.85)';
  const lines = [
    'Comets fall from above. Dodge them and grab the cyan orbs for points.',
    'Move with arrow keys or WASD. You have three lives.',
  ];
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, canvas.height / 2 - 30 + i * 26));

  if (bestScore > 0) {
    ctx.fillStyle = '#ffd27a';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText(`Best score: ${formatScore(bestScore)}`, canvas.width / 2, canvas.height / 2 + 50);
  }

  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
  ctx.fillStyle = `rgba(230, 246, 255, ${0.4 + 0.6 * pulse})`;
  ctx.font = '24px sans-serif';
  ctx.fillText('Click or press any key to start', canvas.width / 2, canvas.height / 2 + 100);
}

function renderGameOver() {
  renderBackground();

  ctx.fillStyle = '#ff6b6b';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Ship Destroyed', canvas.width / 2, canvas.height / 2 - 60);

  ctx.fillStyle = '#e6f6ff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(`Score: ${formatScore(score)}`, canvas.width / 2, canvas.height / 2);

  ctx.fillStyle = '#ffd27a';
  ctx.font = '20px sans-serif';
  ctx.fillText(`Best: ${formatScore(bestScore)}`, canvas.width / 2, canvas.height / 2 + 36);

  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
  ctx.fillStyle = `rgba(230, 246, 255, ${0.4 + 0.6 * pulse})`;
  ctx.font = '20px sans-serif';
  ctx.fillText('Click or press any key to try again', canvas.width / 2, canvas.height / 2 + 90);
}

function renderPlayer() {
  const flashing = invincibleTimer > 0 && Math.floor(invincibleTimer * 12) % 2 === 0;
  if (flashing) return;

  const angle = Math.atan2(player.vy, player.vx) + Math.PI / 2;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(angle);
  ctx.fillStyle = '#7ef7d0';
  ctx.beginPath();
  ctx.moveTo(0, -PLAYER_RADIUS);
  ctx.lineTo(PLAYER_RADIUS * 0.8, PLAYER_RADIUS * 0.9);
  ctx.lineTo(0, PLAYER_RADIUS * 0.5);
  ctx.lineTo(-PLAYER_RADIUS * 0.8, PLAYER_RADIUS * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderAsteroids() {
  for (const a of asteroids) {
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(a.angle);
    const shade = 130 - Math.round(a.radius);
    ctx.fillStyle = `rgb(${shade + 40}, ${shade + 20}, ${shade + 15})`;
    ctx.beginPath();
    for (let i = 0; i < a.sides; i++) {
      const angle = (i / a.sides) * Math.PI * 2;
      const r = a.radius * a.jitter[i];
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function renderOrbs(time) {
  for (const o of orbs) {
    const pulse = 0.7 + 0.3 * Math.sin(time / 150 + o.x);
    ctx.fillStyle = `rgba(126, 247, 208, ${pulse})`;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function renderParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function renderHud() {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e6f6ff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('❤'.repeat(Math.max(0, lives)) || '—', 20, 36);

  ctx.textAlign = 'right';
  ctx.fillText(`Score ${formatScore(score)}`, canvas.width - 20, 36);
}

function renderGame(time) {
  renderBackground();
  renderAsteroids();
  renderOrbs(time);
  renderParticles();
  renderPlayer();
  renderHud();
}

function render(time) {
  if (state === 'title') {
    renderTitle();
  } else if (state === 'gameover') {
    renderGame(time);
    renderGameOver();
  } else {
    renderGame(time);
  }
}

let lastTime = performance.now();
function loop(time) {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  update(dt);
  render(time);
  requestAnimationFrame(loop);
}

initStars();
requestAnimationFrame(loop);
