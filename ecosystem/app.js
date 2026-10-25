import { Ecosystem, DEFAULT_PARAMS } from './model.js';

const world = document.getElementById('world');
const chart = document.getElementById('chart');
const wctx = world.getContext('2d');
const cctx = chart.getContext('2d');

const $ = (id) => document.getElementById(id);
const sliders = ['grassRegrow', 'rabbitGain', 'rabbitBreed', 'foxGain', 'foxBreed'];

let eco;
let running = true;

function readParams() {
  const p = {};
  for (const k of sliders) p[k] = Number($(k).value);
  return p;
}

function syncOutputs() {
  for (const k of sliders) $(`${k}Out`).textContent = $(k).value;
  $('speedOut').textContent = $('speed').value;
}

function reset() {
  for (const k of sliders) $(k).value = DEFAULT_PARAMS[k];
  syncOutputs();
  eco = new Ecosystem(readParams(), Number($('seed').value) || 1);
}

for (const k of sliders) {
  $(k).addEventListener('input', () => {
    eco.params[k] = Number($(k).value);
    syncOutputs();
  });
}
$('speed').addEventListener('input', syncOutputs);
$('playPause').addEventListener('click', () => {
  running = !running;
  $('playPause').textContent = running ? 'Pause' : 'Play';
});
$('step').addEventListener('click', () => {
  eco.step();
  draw();
});
$('reset').addEventListener('click', () => {
  reset();
  draw();
});

const offscreen = document.createElement('canvas');
function drawWorld() {
  const { width, height } = eco;
  if (offscreen.width !== width || offscreen.height !== height) {
    offscreen.width = width;
    offscreen.height = height;
  }
  const octx = offscreen.getContext('2d');
  const img = octx.createImageData(width, height);
  const d = img.data;
  for (let i = 0; i < width * height; i++) {
    const g = eco.grass[i];
    d[i * 4] = g ? 0x3f : 0x2a;
    d[i * 4 + 1] = g ? 0x8f : 0x22;
    d[i * 4 + 2] = g ? 0x3f : 0x18;
    d[i * 4 + 3] = 255;
  }
  const put = (x, y, r, g, b) => {
    const i = (y * width + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  };
  for (const r of eco.rabbits) put(r.x, r.y, 0xe8, 0xe0, 0xc8);
  for (const f of eco.foxes) put(f.x, f.y, 0xe0, 0x74, 0x2c);
  octx.putImageData(img, 0, 0);

  const rect = world.getBoundingClientRect();
  if (world.width !== Math.floor(rect.width) || world.height !== Math.floor(rect.height)) {
    world.width = Math.floor(rect.width);
    world.height = Math.floor(rect.height);
  }
  const scale = Math.min(world.width / width, world.height / height);
  const dw = width * scale;
  const dh = height * scale;
  wctx.imageSmoothingEnabled = false;
  wctx.fillStyle = '#000';
  wctx.fillRect(0, 0, world.width, world.height);
  wctx.drawImage(offscreen, (world.width - dw) / 2, (world.height - dh) / 2, dw, dh);
}

function drawChart() {
  const rect = chart.getBoundingClientRect();
  chart.width = Math.floor(rect.width);
  chart.height = Math.floor(rect.height);
  const W = chart.width;
  const H = chart.height;
  const pad = 8;
  cctx.clearRect(0, 0, W, H);

  const h = eco.history;
  const n = h.grass.length;
  if (n < 2) return;
  const series = [
    [h.grass, '#3f8f3f'],
    [h.rabbits, '#e8e0c8'],
    [h.foxes, '#e0742c'],
  ];
  const max = Math.max(1, ...series.map(([s]) => Math.max(...s)));

  cctx.lineWidth = 1.5;
  for (const [s, color] of series) {
    cctx.strokeStyle = color;
    cctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = pad + ((W - 2 * pad) * i) / (n - 1);
      const y = H - pad - ((H - 2 * pad) * s[i]) / max;
      if (i === 0) cctx.moveTo(x, y);
      else cctx.lineTo(x, y);
    }
    cctx.stroke();
  }
  cctx.fillStyle = '#9fb09f';
  cctx.font = '11px system-ui, sans-serif';
  cctx.textAlign = 'left';
  cctx.fillText(`max ${max}`, pad, pad + 10);
  cctx.textAlign = 'right';
  cctx.fillText(`last ${n} ticks`, W - pad, pad + 10);
}

function drawStats() {
  $('tick').textContent = eco.tick;
  $('grassCount').textContent = eco.history.grass.at(-1);
  $('rabbitCount').textContent = eco.rabbits.length;
  $('foxCount').textContent = eco.foxes.length;
}

function draw() {
  drawWorld();
  drawChart();
  drawStats();
}

function frame() {
  if (running) {
    const n = Number($('speed').value);
    for (let i = 0; i < n; i++) eco.step();
  }
  draw();
  requestAnimationFrame(frame);
}

reset();
window.addEventListener('resize', draw);
requestAnimationFrame(frame);
