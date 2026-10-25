import { Simulation } from './sim.js';
import { TILE } from './world.js';
import { JOBS } from './people.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const ctx = canvas.getContext('2d');

const TILE_COLORS = {
  [TILE.WATER]: [43, 95, 143],
  [TILE.SAND]: [201, 183, 122],
  [TILE.GRASS]: [86, 140, 58],
  [TILE.FOREST]: [40, 96, 40],
};
const BUILDING_COLORS = {
  well: '#6c7f94',
  market: '#b07a3c',
  tavern: '#8c4a3c',
  house: '#a0714f',
  farm: '#c8a048',
  lumber: '#6e5537',
};

let sim;
let running = true;
let selected = null;
let follow = false;
const camera = { x: 0, y: 0, zoom: 8 };
const terrain = document.createElement('canvas');

function buildTerrain() {
  const w = sim.world;
  terrain.width = w.width;
  terrain.height = w.height;
  const tctx = terrain.getContext('2d');
  const img = tctx.createImageData(w.width, w.height);
  const rng = seededNoise(sim.seed);
  for (let i = 0; i < w.tiles.length; i++) {
    const [r, g, b] = TILE_COLORS[w.tiles[i]];
    const v = (rng(i) - 0.5) * 14;
    img.data[i * 4] = r + v;
    img.data[i * 4 + 1] = g + v;
    img.data[i * 4 + 2] = b + v;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
}

function seededNoise(seed) {
  return (i) => {
    let t = (i * 374761393 + seed * 668265263) >>> 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

function reset() {
  sim = new Simulation(Number($('seed').value) || 1);
  selected = null;
  follow = false;
  $('follow').classList.remove('active');
  buildTerrain();
  centerVillage();
  renderLegend();
}

function centerVillage() {
  camera.x = sim.world.center.x + 0.5;
  camera.y = sim.world.center.y + 0.5;
  camera.zoom = Math.max(6, Math.min(12, canvas.width / 70));
}

function renderLegend() {
  $('legend').innerHTML = Object.entries(JOBS)
    .map(([k, v]) => `<span><i style="background:${v.color}"></i>${k}</span>`)
    .join('');
}

// ----- camera helpers -----
function worldToScreen(x, y) {
  return [(x - camera.x) * camera.zoom + canvas.width / 2, (y - camera.y) * camera.zoom + canvas.height / 2];
}
function screenToWorld(sx, sy) {
  return [(sx - canvas.width / 2) / camera.zoom + camera.x, (sy - canvas.height / 2) / camera.zoom + camera.y];
}

// ----- input -----
let drag = null;
canvas.addEventListener('mousedown', (e) => {
  drag = { sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false };
  canvas.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (Math.hypot(dx, dy) > 3) drag.moved = true;
  if (drag.moved) {
    camera.x = drag.cx - dx / camera.zoom;
    camera.y = drag.cy - dy / camera.zoom;
    follow = false;
    $('follow').classList.remove('active');
  }
});
window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  canvas.classList.remove('dragging');
  if (!drag.moved) {
    const rect = canvas.getBoundingClientRect();
    pick(e.clientX - rect.left, e.clientY - rect.top);
  }
  drag = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const factor = Math.exp(-e.deltaY * 0.0015);
  camera.zoom = Math.max(2, Math.min(40, camera.zoom * factor));
  const [nx, ny] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  camera.x += wx - nx;
  camera.y += wy - ny;
}, { passive: false });
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys.add(e.key.toLowerCase());
  if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function pick(sx, sy) {
  const [wx, wy] = screenToWorld(sx, sy);
  let best = null;
  let bestD = 1.2;
  for (const p of sim.people) {
    if (!p.alive) continue;
    const [px, py] = personPosition(p);
    const d = Math.hypot(px - wx, py - wy);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  selected = best;
  if (!selected) {
    follow = false;
    $('follow').classList.remove('active');
  }
  renderPerson();
}

function togglePlay() {
  running = !running;
  $('playPause').textContent = running ? 'Pause' : 'Play';
}
$('playPause').addEventListener('click', togglePlay);
$('reset').addEventListener('click', reset);
$('speed').addEventListener('input', () => ($('speedOut').textContent = $('speed').value));
$('follow').addEventListener('click', () => {
  if (!selected) return;
  follow = !follow;
  $('follow').classList.toggle('active', follow);
});
$('center').addEventListener('click', () => {
  follow = false;
  $('follow').classList.remove('active');
  centerVillage();
});

// ----- rendering -----
function personPosition(p) {
  if (!p.inside) return [p.x + 0.5, p.y + 0.5];
  // Arrange occupants in a grid inside the building so they stay visible.
  const b = p.inside;
  const list = [...b.occupants];
  const i = list.indexOf(p);
  const cols = Math.max(1, b.w);
  const gx = i % cols;
  const gy = Math.floor(i / cols) % Math.max(1, b.h);
  return [b.x + gx + 0.5, b.y + gy + 0.5];
}

function nightAlpha(hour) {
  // 0 at midday, up to 0.6 at night, with dawn and dusk ramps.
  if (hour >= 7 && hour <= 18) return 0;
  if (hour > 18 && hour < 21) return ((hour - 18) / 3) * 0.6;
  if (hour >= 5 && hour < 7) return ((7 - hour) / 2) * 0.6;
  return 0.6;
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height)) {
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height);
  }
  if (follow && selected && selected.alive) {
    const [px, py] = personPosition(selected);
    camera.x += (px - camera.x) * 0.15;
    camera.y += (py - camera.y) * 0.15;
  }
  const z = camera.zoom;
  ctx.fillStyle = '#0a0d14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const [ox, oy] = worldToScreen(0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrain, ox, oy, terrain.width * z, terrain.height * z);

  for (const b of sim.world.buildings) {
    const [bx, by] = worldToScreen(b.x, b.y);
    ctx.fillStyle = BUILDING_COLORS[b.type];
    ctx.fillRect(bx, by, b.w * z, b.h * z);
    if (b.type === 'farm') {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      for (let r = 1; r < b.h; r++) {
        ctx.beginPath();
        ctx.moveTo(bx, by + r * z);
        ctx.lineTo(bx + b.w * z, by + r * z);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(bx, by, b.w * z, Math.max(1, z * 0.35));
    }
    const [dx, dy] = worldToScreen(b.door.x, b.door.y);
    ctx.fillStyle = 'rgba(60,40,20,0.8)';
    ctx.fillRect(dx + z * 0.3, dy - z * 0.15, z * 0.4, z * 0.3);
    // Houses are dense, so their labels wait for a closer zoom.
    if (z >= (b.type === 'house' ? 11 : 7)) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${Math.max(9, z * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(b.name, bx + (b.w * z) / 2, by - 3);
    }
  }

  if (selected && selected.alive && selected.path && selected.path.length) {
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const [sx, sy] = worldToScreen(selected.x + 0.5, selected.y + 0.5);
    ctx.moveTo(sx, sy);
    for (const n of selected.path) {
      const [nx, ny] = worldToScreen(n.x + 0.5, n.y + 0.5);
      ctx.lineTo(nx, ny);
    }
    ctx.stroke();
  }

  const r = Math.max(2, z * 0.35);
  for (const p of sim.people) {
    if (!p.alive) continue;
    const [px, py] = personPosition(p);
    const [sx, sy] = worldToScreen(px, py);
    if (sx < -10 || sy < -10 || sx > canvas.width + 10 || sy > canvas.height + 10) continue;
    ctx.globalAlpha = p.inside ? 0.6 : 1;
    ctx.fillStyle = JOBS[p.job].color;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (p === selected) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
      ctx.stroke();
      if (z >= 5) {
        const size = Math.max(10, z * 1.2);
        ctx.font = `${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(p.name).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(sx - tw / 2 - 4, sy - r - 8 - size, tw + 8, size + 4);
        ctx.fillStyle = '#fff';
        ctx.fillText(p.name, sx, sy - r - 8);
      }
    }
  }

  const na = nightAlpha(sim.hour());
  if (na > 0) {
    ctx.fillStyle = `rgba(10, 16, 40, ${na})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

let lastLogLen = -1;
let lastSimObj = null;
function renderPanel() {
  $('clock').textContent = `Day ${sim.day()} ${sim.clock()}`;
  const alive = sim.alive().length;
  $('hudStats').textContent = `${alive} people · food ${Math.floor(sim.food)} · wood ${Math.floor(sim.wood)}`;
  $('pop').textContent = `${alive} / ${sim.people.length}`;
  $('food').textContent = Math.floor(sim.food);
  $('wood').textContent = Math.floor(sim.wood);
  let friendships = 0;
  for (const v of sim.relationships.values()) if (v >= 30) friendships++;
  $('friendships').textContent = friendships;

  if (sim.events.length !== lastLogLen || sim !== lastSimObj) {
    lastLogLen = sim.events.length;
    lastSimObj = sim;
    const log = $('log');
    log.innerHTML = sim.events
      .slice(-60)
      .reverse()
      .map((e) => `<div class="${e.kind}"><span class="t">D${e.day} ${e.clock}</span>${e.text}</div>`)
      .join('');
  }
  renderPerson();
}

function renderPerson() {
  const el = $('person');
  if (!selected) {
    el.innerHTML = '<h2>Selected</h2><div class="sub">Click a person on the map.</div>';
    return;
  }
  const p = selected;
  const needRow = (label, v) =>
    `<div class="need"><span>${label}</span><span class="bar"><i class="${v < 20 ? 'low' : ''}" style="width:${v.toFixed(0)}%"></i></span><span>${v.toFixed(0)}</span></div>`;
  const friends = sim
    .friendsOf(p, 4)
    .map((f) => `<b>${f.person.name}</b> (${f.value.toFixed(0)})`)
    .join(', ');
  el.innerHTML = `
    <h2>Selected</h2>
    <div class="name" style="color:${JOBS[p.job].color}">${p.name}</div>
    <div class="sub">${p.job}, age ${p.age}, lives at ${p.home.name}${p.workplace && p.workplace !== 'forest' ? `, works at ${p.workplace.name}` : ''}</div>
    <div class="sub">${p.describe()}${p.alive ? '' : ''}</div>
    ${needRow('hunger', p.needs.hunger)}
    ${needRow('energy', p.needs.energy)}
    ${needRow('social', p.needs.social)}
    ${needRow('fun', p.needs.fun)}
    ${needRow('health', p.health)}
    <div class="friends">Friends: ${friends || 'none yet'}</div>`;
}

function frame() {
  const panSpeed = 25 / camera.zoom;
  if (keys.has('w')) camera.y -= panSpeed;
  if (keys.has('s')) camera.y += panSpeed;
  if (keys.has('a')) camera.x -= panSpeed;
  if (keys.has('d')) camera.x += panSpeed;
  if (running) {
    const n = Number($('speed').value);
    for (let i = 0; i < n; i++) sim.step(0.1);
  }
  draw();
  renderPanel();
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
