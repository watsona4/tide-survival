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

function startGame() {
  state = 'playing';
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

window.addEventListener('keydown', () => {
  if (state === 'title') startGame();
});
canvas.addEventListener('click', (e) => {
  if (state === 'title') {
    startGame();
    return;
  }
  if (state === 'playing') handleBuildClick(e.offsetX, e.offsetY);
});
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (state === 'playing') handleMudBuildClick(e.offsetX, e.offsetY);
});
canvas.addEventListener('mousedown', (e) => {
  if (e.button === 1) {
    e.preventDefault();
    if (state === 'playing') handleRockBuildClick(e.offsetX, e.offsetY);
  }
});
canvas.addEventListener('auxclick', (e) => {
  if (e.button === 1) e.preventDefault();
});

const WAVE_INTERVAL = 1;
const KILLER_WAVE_CHANCE = 0.01;
const DANGER_WAVE_CHANCE = 0.2;
const WAVE_WARNING_TIME = 1.5;

let waveTimer = WAVE_INTERVAL;
let activeWave = null;
let wavesSurvived = 0;

let audioCtx = null;
function playAlarm(kind) {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const isKiller = kind === 'killer';
  const beepAt = (startTime) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = isKiller ? 'sawtooth' : 'square';
    osc.frequency.value = isKiller ? 220 : 880;
    gain.gain.setValueAtTime(isKiller ? 0.2 : 0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + 0.2);
  };

  const now = audioCtx.currentTime;
  const spacing = isKiller ? 0.15 : 0.25;
  const count = isKiller ? 6 : 3;
  for (let i = 0; i < count; i++) beepAt(now + i * spacing);
}

const SAND_MAX = 10;
const SAND_REGEN_RATE = 1 / 2; // sand per second
const TOWER_COST = 1;
const TOWER_MAX_HEIGHT = 15;
const TOWER_GROW_RADIUS = 30;

const MUD_MAX = 10;
const MUD_REGEN_RATE = 1 / 3; // mud per second, slower than sand
const WALL_COST = 1;
const WALL_MAX_HEIGHT = 15;
const WALL_GROW_RADIUS = 30;

let sand = SAND_MAX;
let towers = [];

let mud = MUD_MAX;
let mudWalls = [];

const ROCK_MAX = 10;
const ROCK_REGEN_RATE = 1 / 5; // rock per second, slowest of the three
const ROCK_COST = 1;
const ROCK_MAX_HEIGHT = 15;
const ROCK_GROW_RADIUS = 30;

let rock = ROCK_MAX;
let rockPiles = [];

function isInsideIsland(x, y) {
  const rx = canvas.width * 0.4;
  const ry = canvas.height * 0.4;
  const dx = (x - canvas.width / 2) / rx;
  const dy = (y - canvas.height / 2) / ry;
  return dx * dx + dy * dy <= 1;
}

function handleBuildClick(x, y) {
  if (!isInsideIsland(x, y)) return;
  if (sand < TOWER_COST) return;

  const existing = towers.find((t) => Math.hypot(t.x - x, t.y - y) < TOWER_GROW_RADIUS);
  if (existing) {
    if (existing.height >= TOWER_MAX_HEIGHT) return;
    existing.height += 1;
  } else {
    towers.push({ x, y, height: 1 });
  }
  sand -= TOWER_COST;
}

function handleMudBuildClick(x, y) {
  if (!isInsideIsland(x, y)) return;
  if (mud < WALL_COST) return;

  const existing = mudWalls.find((w) => Math.hypot(w.x - x, w.y - y) < WALL_GROW_RADIUS);
  if (existing) {
    if (existing.height >= WALL_MAX_HEIGHT) return;
    existing.height += 1;
  } else {
    mudWalls.push({ x, y, height: 1 });
  }
  mud -= WALL_COST;
}

function handleRockBuildClick(x, y) {
  if (!isInsideIsland(x, y)) return;
  if (rock < ROCK_COST) return;

  const existing = rockPiles.find((r) => Math.hypot(r.x - x, r.y - y) < ROCK_GROW_RADIUS);
  if (existing) {
    if (existing.height >= ROCK_MAX_HEIGHT) return;
    existing.height += 1;
  } else {
    rockPiles.push({ x, y, height: 1, wavesSurvived: 0 });
  }
  rock -= ROCK_COST;
}

function update(dt) {
  if (state !== 'playing') return;

  sand = Math.min(SAND_MAX, sand + SAND_REGEN_RATE * dt);
  mud = Math.min(MUD_MAX, mud + MUD_REGEN_RATE * dt);
  rock = Math.min(ROCK_MAX, rock + ROCK_REGEN_RATE * dt);

  if (!activeWave) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = WAVE_INTERVAL;
      const roll = Math.random();
      const kind = roll < KILLER_WAVE_CHANCE ? 'killer'
        : roll < KILLER_WAVE_CHANCE + DANGER_WAVE_CHANCE ? 'danger'
        : 'normal';
      activeWave = { kind, timeLeft: WAVE_WARNING_TIME };
      if (kind !== 'normal') playAlarm(kind);
    }
  } else {
    activeWave.timeLeft -= dt;
    if (activeWave.timeLeft <= 0) {
      if (activeWave.kind === 'danger') {
        damageTowers(5);
        damageMudWalls(5);
        ageRockPiles();
      } else if (activeWave.kind === 'killer') {
        damageTowers(Infinity);
        damageMudWalls(Infinity);
        ageRockPiles();
      }
      wavesSurvived += 1;
      activeWave = null;
    }
  }
}

function damageTowers(amount) {
  for (const t of towers) t.height -= amount;
  towers = towers.filter((t) => t.height > 0);
}

const MUD_DAMAGE_RESISTANCE = 0.5; // mud is 2x stronger: takes half damage

function damageMudWalls(amount) {
  for (const w of mudWalls) w.height -= amount * MUD_DAMAGE_RESISTANCE;
  mudWalls = mudWalls.filter((w) => w.height > 0);
}

const ROCK_WAVE_LIFESPAN = 3; // a rock pile falls after surviving this many waves

function ageRockPiles() {
  for (const r of rockPiles) r.wavesSurvived += 1;
  rockPiles = rockPiles.filter((r) => r.wavesSurvived < ROCK_WAVE_LIFESPAN);
}

function renderTitle() {
  ctx.fillStyle = '#0a1a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#e6f6ff';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Tide Survival', canvas.width / 2, canvas.height / 2 - 20);

  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 400);
  ctx.fillStyle = `rgba(230, 246, 255, ${0.4 + 0.6 * pulse})`;
  ctx.font = '24px sans-serif';
  ctx.fillText('Click or press any key to start', canvas.width / 2, canvas.height / 2 + 40);
}

function renderWaves(time) {
  const spacing = 40;
  ctx.strokeStyle = 'rgba(230, 246, 255, 0.25)';
  ctx.lineWidth = 2;

  for (let y = -spacing; y < canvas.height + spacing; y += spacing) {
    ctx.beginPath();
    for (let x = 0; x <= canvas.width; x += 10) {
      const offset = Math.sin(x * 0.02 + time / 600 + y * 0.05) * 8;
      const py = y + offset;
      if (x === 0) ctx.moveTo(x, py);
      else ctx.lineTo(x, py);
    }
    ctx.stroke();
  }
}

function renderWaveWarning() {
  if (!activeWave) return;

  const progress = 1 - activeWave.timeLeft / WAVE_WARNING_TIME;
  const flash = 0.5 + 0.5 * Math.sin(performance.now() / 100);

  if (activeWave.kind === 'killer') {
    ctx.fillStyle = `rgba(20, 0, 0, ${0.35 + 0.35 * flash})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = `rgba(255, 60, 60, ${0.7 + 0.3 * flash})`;
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('KILLER WAVE INCOMING', canvas.width / 2, 80);
  } else if (activeWave.kind === 'danger') {
    ctx.fillStyle = `rgba(220, 40, 40, ${0.15 + 0.15 * flash})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = `rgba(255, 200, 200, ${0.6 + 0.4 * flash})`;
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('DANGER WAVE INCOMING', canvas.width / 2, 80);
  } else {
    ctx.fillStyle = `rgba(120, 190, 230, ${0.08 * (1 - progress)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function renderTowers() {
  for (const t of towers) {
    for (let ring = t.height; ring >= 1; ring--) {
      const radius = 8 + ring * 6;
      const shade = 220 - ring * 15;
      ctx.fillStyle = `rgb(${shade}, ${shade - 30}, ${shade - 90})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function renderMudWalls() {
  for (const w of mudWalls) {
    for (let ring = w.height; ring >= 1; ring--) {
      const size = (8 + ring * 6) * 2;
      const shade = 110 - ring * 4;
      ctx.fillStyle = `rgb(${shade}, ${shade - 20}, ${shade - 35})`;
      ctx.fillRect(w.x - size / 2, w.y - size / 2, size, size);
    }
  }
}

function renderRockPiles() {
  for (const r of rockPiles) {
    for (let ring = r.height; ring >= 1; ring--) {
      const radius = 8 + ring * 6;
      const shade = 150 - ring * 5;
      ctx.fillStyle = `rgb(${shade}, ${shade}, ${shade + 5})`;
      ctx.beginPath();
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const px = r.x + Math.cos(angle) * radius;
        const py = r.y + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function renderMeter(label, value, max, x, y, color) {
  const barWidth = 200;
  const barHeight = 18;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  ctx.fillRect(x, y, barWidth, barHeight);

  ctx.fillStyle = color;
  ctx.fillRect(x, y, barWidth * (value / max), barHeight);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.strokeRect(x, y, barWidth, barHeight);

  ctx.fillStyle = '#e6f6ff';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x, y - 6);
}

function renderSandMeter() {
  renderMeter('Sand', sand, SAND_MAX, 20, canvas.height - 100, '#d9c088');
  renderMeter('Mud', mud, MUD_MAX, 20, canvas.height - 70, '#6b4a34');
  renderMeter('Rock', rock, ROCK_MAX, 20, canvas.height - 40, '#9a9a9a');
}

function renderWavesSurvived() {
  ctx.fillStyle = '#e6f6ff';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`Waves survived: ${wavesSurvived}`, canvas.width - 20, 34);
}

function renderGame(time) {
  ctx.fillStyle = '#0a1a24';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  renderWaves(time);

  ctx.fillStyle = '#d9c088';
  ctx.beginPath();
  ctx.ellipse(canvas.width / 2, canvas.height / 2, canvas.width * 0.4, canvas.height * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();

  renderTowers();
  renderMudWalls();
  renderRockPiles();
  renderWaveWarning();
  renderSandMeter();
  renderWavesSurvived();
}

function render(time) {
  if (state === 'title') renderTitle();
  else renderGame(time);
}

let lastTime = performance.now();
function loop(time) {
  const dt = (time - lastTime) / 1000;
  lastTime = time;
  update(dt);
  render(time);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
