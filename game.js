const canvas = document.createElement('canvas');
canvas.width = 800;
canvas.height = 600;
document.getElementById('app').appendChild(canvas);
const ctx = canvas.getContext('2d');

function update(dt) {
  // game logic goes here
}

function render() {
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

let lastTime = performance.now();
function loop(time) {
  const dt = (time - lastTime) / 1000;
  lastTime = time;
  update(dt);
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
