import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Simulation } from './sim.js';
import { TILE } from './world.js';
import { JOBS } from './people.js';

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const view = $('view');

// ----- three.js setup -----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 600);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.maxPolarAngle = Math.PI / 2 - 0.06;
controls.minDistance = 3;
controls.maxDistance = 180;
controls.screenSpacePanning = false;

const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a2a, 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);
const moon = new THREE.DirectionalLight(0x8090c0, 0.25);
scene.add(moon);
scene.add(moon.target);

function resize() {
  const w = view.clientWidth;
  const h = view.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

// ----- colors & materials -----
const TILE_COLORS = {
  [TILE.WATER]: new THREE.Color('#2a5a88'),
  [TILE.SAND]: new THREE.Color('#cdbb7e'),
  [TILE.GRASS]: new THREE.Color('#5c943c'),
  [TILE.FOREST]: new THREE.Color('#3b7032'),
};
const BASE_HEIGHT = { [TILE.WATER]: -0.8, [TILE.SAND]: -0.05, [TILE.GRASS]: 0.12, [TILE.FOREST]: 0.2 };
const WATER_LEVEL = -0.3;
const BUILDING_STYLE = {
  well: { wall: '#7c8a99', roof: '#5a4030', height: 0.5, roofH: 0.6 },
  market: { wall: '#c08a4a', roof: '#a83a30', height: 1.5, roofH: 1.0 },
  tavern: { wall: '#8a5844', roof: '#4a3028', height: 2.2, roofH: 1.4 },
  house: { wall: '#b08560', roof: '#6a4a3a', height: 1.5, roofH: 1.1 },
  farm: { wall: '#c8a048', roof: '#7a5a3a', height: 0.12, roofH: 0 },
  lumber: { wall: '#6e5537', roof: '#4b3a26', height: 1.3, roofH: 0.8 },
};

function hashNoise(seed) {
  return (i) => {
    let t = (i * 374761393 + seed * 668265263) >>> 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
}

// ----- world geometry -----
let sim;
let worldGroup = null;
let cornerHeights = null; // (w+1)*(h+1)
let people = []; // { person, group, body, head, ring }
let pickables = [];
let labels = [];
let selected = null;
let follow = false;
let running = true;
let tavernLight = null;

function cornerHeight(x, y) {
  return cornerHeights[y * (sim.world.width + 1) + x];
}

// Height of the ground at a continuous world position.
export function groundHeight(px, pz) {
  const w = sim.world;
  const x = Math.min(w.width - 1, Math.max(0, Math.floor(px)));
  const z = Math.min(w.height - 1, Math.max(0, Math.floor(pz)));
  const fx = Math.min(1, Math.max(0, px - x));
  const fz = Math.min(1, Math.max(0, pz - z));
  const h00 = cornerHeight(x, z);
  const h10 = cornerHeight(x + 1, z);
  const h01 = cornerHeight(x, z + 1);
  const h11 = cornerHeight(x + 1, z + 1);
  return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
}

function buildHeights() {
  const w = sim.world;
  const noise = hashNoise(sim.seed + 11);
  cornerHeights = new Float32Array((w.width + 1) * (w.height + 1));
  for (let y = 0; y <= w.height; y++) {
    for (let x = 0; x <= w.width; x++) {
      let sum = 0;
      let n = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const tx = x + dx;
        const ty = y + dy;
        if (!w.inBounds(tx, ty)) continue;
        sum += BASE_HEIGHT[w.tile(tx, ty)];
        n++;
      }
      let h = n ? sum / n : 0;
      h += (noise(y * (w.width + 1) + x) - 0.5) * 0.12;
      cornerHeights[y * (w.width + 1) + x] = h;
    }
  }
  // Flatten under buildings so walls sit level.
  for (const b of w.buildings) {
    let min = Infinity;
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) min = Math.min(min, cornerHeight(x, y));
    for (let y = b.y; y <= b.y + b.h; y++) for (let x = b.x; x <= b.x + b.w; x++) cornerHeights[y * (w.width + 1) + x] = min;
  }
}

function buildTerrain() {
  const w = sim.world;
  const noise = hashNoise(sim.seed + 5);
  const count = w.width * w.height * 6;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  let i = 0;
  const c = new THREE.Color();
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      const t = w.tile(x, y);
      c.copy(TILE_COLORS[t]);
      const jitter = (noise(y * w.width + x) - 0.5) * 0.08;
      c.offsetHSL(0, 0, jitter);
      const h00 = cornerHeight(x, y);
      const h10 = cornerHeight(x + 1, y);
      const h01 = cornerHeight(x, y + 1);
      const h11 = cornerHeight(x + 1, y + 1);
      const quad = [
        [x, h00, y], [x, h01, y + 1], [x + 1, h10, y],
        [x + 1, h10, y], [x, h01, y + 1], [x + 1, h11, y + 1],
      ];
      for (const [vx, vy, vz] of quad) {
        pos[i * 3] = vx;
        pos[i * 3 + 1] = vy;
        pos[i * 3 + 2] = vz;
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
        i++;
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  worldGroup.add(mesh);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w.width, w.height),
    new THREE.MeshPhongMaterial({ color: 0x2f6fa8, transparent: true, opacity: 0.82, shininess: 80, specular: 0x88aacc }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(w.width / 2, WATER_LEVEL, w.height / 2);
  worldGroup.add(water);
}

function buildTrees() {
  const w = sim.world;
  const noise = hashNoise(sim.seed + 23);
  const tiles = [];
  for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) if (w.tile(x, y) === TILE.FOREST) tiles.push([x, y]);
  if (!tiles.length) return;
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.13, 0.6, 6);
  const canopyGeo = new THREE.ConeGeometry(0.5, 1.3, 7);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: 0x5a3d26 }), tiles.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, new THREE.MeshLambertMaterial({ color: 0x2f6a2c }), tiles.length);
  trunks.castShadow = canopies.castShadow = true;
  canopies.receiveShadow = true;
  const m = new THREE.Matrix4();
  const color = new THREE.Color();
  tiles.forEach(([x, y], i) => {
    const px = x + 0.3 + noise(i * 3) * 0.4;
    const pz = y + 0.3 + noise(i * 3 + 1) * 0.4;
    const s = 0.75 + noise(i * 3 + 2) * 0.6;
    const g = groundHeight(px, pz);
    m.makeScale(s, s, s);
    m.setPosition(px, g + 0.3 * s, pz);
    trunks.setMatrixAt(i, m);
    m.makeScale(s, s, s);
    m.setPosition(px, g + (0.6 + 0.65) * s, pz);
    canopies.setMatrixAt(i, m);
    color.setHSL(0.3 + noise(i * 7) * 0.06, 0.45, 0.28 + noise(i * 7 + 1) * 0.1);
    canopies.setColorAt(i, color);
  });
  worldGroup.add(trunks, canopies);
}

function makeLabel(text, size = 1) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '40px system-ui, sans-serif';
  ctx.font = font;
  const tw = Math.ceil(ctx.measureText(text).width);
  c.width = tw + 24;
  c.height = 56;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 12);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.userData.aspect = c.width / 56;
  sprite.userData.size = size;
  sprite.renderOrder = 10;
  return sprite;
}

function buildBuildings() {
  const w = sim.world;
  for (const b of w.buildings) {
    const style = BUILDING_STYLE[b.type];
    const g = new THREE.Group();
    const base = cornerHeight(b.x, b.y);
    const cx = b.x + b.w / 2;
    const cz = b.y + b.h / 2;
    const wallMat = new THREE.MeshLambertMaterial({ color: style.wall });
    const roofMat = new THREE.MeshLambertMaterial({ color: style.roof });

    if (b.type === 'well') {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.5, 12), wallMat);
      ring.position.set(cx, base + 0.25, cz);
      g.add(ring);
      for (const sx of [-0.4, 0.4]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.08), roofMat);
        post.position.set(cx + sx, base + 0.6, cz);
        g.add(post);
      }
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.7, 0.4, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.set(cx, base + 1.35, cz);
      g.add(roof);
    } else if (b.type === 'farm') {
      const field = new THREE.Mesh(new THREE.BoxGeometry(b.w, style.height, b.h), wallMat);
      field.position.set(cx, base + style.height / 2, cz);
      g.add(field);
      const rowMat = new THREE.MeshLambertMaterial({ color: 0x8a6a2a });
      for (let r = 0; r < b.h; r++) {
        const row = new THREE.Mesh(new THREE.BoxGeometry(b.w - 0.3, 0.1, 0.25), rowMat);
        row.position.set(cx, base + style.height + 0.05, b.y + r + 0.5);
        g.add(row);
      }
      const shed = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 1), new THREE.MeshLambertMaterial({ color: 0x7a5a3a }));
      shed.position.set(b.x + 0.5, base + 0.45, b.y + 0.5);
      shed.castShadow = true;
      g.add(shed);
    } else {
      const walls = new THREE.Mesh(new THREE.BoxGeometry(b.w, style.height, b.h), wallMat);
      walls.position.set(cx, base + style.height / 2, cz);
      walls.castShadow = walls.receiveShadow = true;
      g.add(walls);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(1, style.roofH, 4), roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set((b.w / Math.SQRT2) * 1.08, 1, (b.h / Math.SQRT2) * 1.08);
      roof.position.set(cx, base + style.height + style.roofH / 2, cz);
      roof.castShadow = true;
      g.add(roof);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.08), new THREE.MeshLambertMaterial({ color: 0x3a2616 }));
      door.position.set(b.door.x + 0.5, base + 0.45, b.y + b.h + 0.02);
      g.add(door);
      if (b.type === 'lumber') {
        const logMat = new THREE.MeshLambertMaterial({ color: 0x8a6a48 });
        for (let i = 0; i < 3; i++) {
          const log = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 8), logMat);
          log.rotation.z = Math.PI / 2;
          log.position.set(b.x - 0.6, base + 0.15 + (i === 2 ? 0.28 : 0), b.y + 0.6 + (i % 2) * 0.32 + (i === 2 ? 0.16 : 0));
          g.add(log);
        }
      }
    }
    const label = makeLabel(b.name, 1.1);
    label.position.set(cx, base + style.height + style.roofH + 1.1, cz);
    label.userData.house = b.type === 'house';
    g.add(label);
    labels.push(label);
    worldGroup.add(g);
  }
  if (w.tavern) {
    tavernLight = new THREE.PointLight(0xffb060, 0, 14, 1.5);
    tavernLight.position.set(w.tavern.x + w.tavern.w / 2, cornerHeight(w.tavern.x, w.tavern.y) + 1.5, w.tavern.y + w.tavern.h + 1);
    worldGroup.add(tavernLight);
  }
}

function buildPeople() {
  const bodyGeo = new THREE.CylinderGeometry(0.17, 0.22, 0.62, 10);
  const headGeo = new THREE.SphereGeometry(0.17, 12, 10);
  const ringGeo = new THREE.RingGeometry(0.35, 0.45, 24);
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8c9a8 });
  for (const person of sim.people) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, new THREE.MeshLambertMaterial({ color: JOBS[person.job].color }));
    body.position.y = 0.31;
    body.castShadow = true;
    const head = new THREE.Mesh(headGeo, skin);
    head.position.y = 0.62 + 0.15;
    head.castShadow = true;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    ring.visible = false;
    group.add(body, head, ring);
    const s = person.job === 'child' ? 0.65 : person.job === 'elder' ? 0.92 : 1;
    group.scale.set(s, s, s);
    body.userData.person = person;
    head.userData.person = person;
    worldGroup.add(group);
    people.push({ person, group, body, head, ring });
    pickables.push(body, head);
  }
}

const pathLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }),
);
pathLine.renderOrder = 9;
pathLine.visible = false;
scene.add(pathLine);

function rebuildWorld() {
  if (worldGroup) {
    scene.remove(worldGroup);
    worldGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }
  worldGroup = new THREE.Group();
  people = [];
  pickables = [];
  labels = [];
  buildHeights();
  buildTerrain();
  buildTrees();
  buildBuildings();
  buildPeople();
  scene.add(worldGroup);
  const c = sim.world.center;
  sun.target.position.set(c.x, 0, c.y);
  moon.target.position.set(c.x, 0, c.y);
}

function reset() {
  sim = new Simulation(Number($('seed').value) || 1);
  window.sim = sim; // handy for poking at the world from the console
  selected = null;
  follow = false;
  $('follow').classList.remove('active');
  rebuildWorld();
  centerVillage();
  renderLegend();
  lastLogLen = -1;
}

function centerVillage() {
  const c = sim.world.center;
  const y = groundHeight(c.x, c.y);
  controls.target.set(c.x, y, c.y);
  camera.position.set(c.x + 2, y + 34, c.y + 42);
  controls.update();
}

function renderLegend() {
  $('legend').innerHTML = Object.entries(JOBS)
    .map(([k, v]) => `<span><i style="background:${v.color}"></i>${k}</span>`)
    .join('');
}

// ----- input -----
let press = null;
canvas.addEventListener('pointerdown', (e) => {
  press = { x: e.clientX, y: e.clientY, button: e.button };
});
canvas.addEventListener('pointerup', (e) => {
  if (!press || press.button !== 0) {
    press = null;
    return;
  }
  const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
  press = null;
  if (moved > 4) return;
  const rect = canvas.getBoundingClientRect();
  pick(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
const raycaster = new THREE.Raycaster();
function pick(nx, ny) {
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const hits = raycaster.intersectObjects(pickables, false);
  const hit = hits.find((h) => h.object.visible && h.object.userData.person && h.object.userData.person.alive);
  selected = hit ? hit.object.userData.person : null;
  if (!selected) {
    follow = false;
    $('follow').classList.remove('active');
  }
  renderPerson();
}

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

// ----- per-frame -----
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

function personWorldPos(p, out) {
  if (p.inside) {
    const b = p.inside;
    out.set(b.door.x + 0.5, groundHeight(b.door.x + 0.5, b.door.y + 0.5), b.door.y + 0.5);
  } else {
    out.set(p.x + 0.5, groundHeight(p.x + 0.5, p.y + 0.5), p.y + 0.5);
  }
  return out;
}

function updatePeople() {
  for (const e of people) {
    const p = e.person;
    if (!p.alive) {
      e.group.visible = false;
      continue;
    }
    const isSel = p === selected;
    e.group.visible = !p.inside || isSel;
    personWorldPos(p, tmpV);
    e.group.position.copy(tmpV);
    if (p.path && p.path.length) {
      const n = p.path[0];
      e.group.rotation.y = Math.atan2(n.x - p.x, n.y - p.y);
    }
    const ghost = p.inside && isSel;
    e.body.material.transparent = ghost;
    e.body.material.opacity = ghost ? 0.35 : 1;
    e.ring.visible = isSel;
  }
  if (selected && selected.alive && selected.path && selected.path.length) {
    const pts = [personWorldPos(selected, new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0))];
    for (const n of selected.path) pts.push(new THREE.Vector3(n.x + 0.5, groundHeight(n.x + 0.5, n.y + 0.5) + 0.1, n.y + 0.5));
    pathLine.geometry.dispose();
    pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    pathLine.visible = true;
  } else pathLine.visible = false;
}

const SKY_DAY = new THREE.Color('#8fc0ea');
const SKY_NIGHT = new THREE.Color('#0a1020');
const SKY_WARM = new THREE.Color('#e8a060');
const skyColor = new THREE.Color();

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function updateDaylight() {
  const hour = sim.hour();
  const t = ((hour - 6) / 12) * Math.PI; // 0 at 06:00, PI at 18:00
  const elevation = Math.sin(t);
  const day = smoothstep(-0.12, 0.25, elevation);
  const warm = Math.exp(-((elevation / 0.18) ** 2)) * 0.55;
  skyColor.copy(SKY_NIGHT).lerp(SKY_DAY, day).lerp(SKY_WARM, warm * day);
  scene.background = skyColor;
  if (!scene.fog) scene.fog = new THREE.Fog(skyColor.clone(), 70, 220);
  scene.fog.color.copy(skyColor);

  const c = sim.world.center;
  const az = Math.cos(t);
  sun.position.set(c.x + az * 140, Math.max(0.03, elevation) * 140 + 4, c.y + 50);
  sun.intensity = Math.max(0, elevation) * 1.7;
  sun.color.copy(new THREE.Color('#ffffff').lerp(SKY_WARM, warm));
  sun.visible = elevation > -0.05;
  moon.position.set(c.x - az * 100, Math.max(0.4, -elevation) * 100 + 10, c.y - 40);
  moon.intensity = (1 - day) * 0.22;
  hemi.intensity = 0.2 + day * 0.6;
  if (tavernLight) tavernLight.intensity = (1 - day) * 3;
}

function updateLabels() {
  // Labels keep a roughly constant on-screen size; cottage labels fade out
  // at a distance so the village does not turn into a wall of text.
  for (const l of labels) {
    l.getWorldPosition(tmpV);
    const d = camera.position.distanceTo(tmpV);
    const s = Math.min(1.6, Math.max(0.35, d * 0.022)) * l.userData.size;
    l.scale.set(l.userData.aspect * s, s, 1);
    if (l.userData.house) {
      l.visible = d < 48;
      l.material.opacity = Math.min(1, (48 - d) / 10);
    }
  }
}

function updateCamera() {
  const panSpeed = 0.012 * camera.position.distanceTo(controls.target) + 0.05;
  if (keys.size) {
    camera.getWorldDirection(tmpV);
    tmpV.y = 0;
    tmpV.normalize();
    tmpV2.set(-tmpV.z, 0, tmpV.x);
    const d = new THREE.Vector3();
    if (keys.has('w')) d.add(tmpV);
    if (keys.has('s')) d.sub(tmpV);
    if (keys.has('d')) d.add(tmpV2);
    if (keys.has('a')) d.sub(tmpV2);
    if (d.lengthSq()) {
      d.normalize().multiplyScalar(panSpeed);
      controls.target.add(d);
      camera.position.add(d);
      follow = false;
      $('follow').classList.remove('active');
    }
  }
  if (follow && selected && selected.alive) {
    personWorldPos(selected, tmpV);
    tmpV.y += 0.5;
    tmpV.sub(controls.target).multiplyScalar(0.12);
    controls.target.add(tmpV);
    camera.position.add(tmpV);
  }
  controls.update();
}

// ----- side panel (unchanged from the 2D version) -----
let lastLogLen = -1;
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
  if (sim.events.length !== lastLogLen) {
    lastLogLen = sim.events.length;
    $('log').innerHTML = sim.events
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
    <div class="sub">${p.describe()}</div>
    ${needRow('hunger', p.needs.hunger)}
    ${needRow('energy', p.needs.energy)}
    ${needRow('social', p.needs.social)}
    ${needRow('fun', p.needs.fun)}
    ${needRow('health', p.health)}
    <div class="friends">Friends: ${friends || 'none yet'}</div>`;
}

let panelTimer = 0;
function frame(now) {
  if (running) {
    const n = Number($('speed').value);
    for (let i = 0; i < n; i++) sim.step(0.1);
  }
  updateDaylight();
  updatePeople();
  updateLabels();
  updateCamera();
  renderer.render(scene, camera);
  if (now - panelTimer > 100) {
    panelTimer = now;
    renderPanel();
  }
  requestAnimationFrame(frame);
}

reset();
requestAnimationFrame(frame);
