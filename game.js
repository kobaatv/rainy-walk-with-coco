const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

// UI elements
const poopBarEl = document.getElementById('poop-bar');
const wetBarEl = document.getElementById('wet-bar');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg = document.getElementById('overlay-msg');
const startBtn = document.getElementById('start-btn');

// ── Game state ──────────────────────────────────────────────
let state = 'title'; // 'title' | 'playing' | 'result'
let poopProgress = 0;   // 0→1 fill up to win
let wetLevel = 0;       // 0→1 too wet = poop interrupted
let poopStopped = false;
let resultTimer = 0;
let frameId;

// Umbrella (player)
const umbrella = {
  x: W / 2,
  y: H * 0.35,
  width: 130,
  speed: 7,
  moving: 0,  // -1 left, 0 still, 1 right
};

// Coco (dog)
const coco = {
  x: W / 2,
  y: H * 0.62,
  vx: 0,
  width: 60,
  height: 44,
  poopState: 'wander', // 'wander' | 'squat' | 'done'
  squatTimer: 0,
  wanderTimer: 0,
  wanderTarget: W / 2,
  wetShake: 0,
  poopEmojis: [],
};

// Rain drops
const drops = [];
const DROP_COUNT = 160;

// ── Input ────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state === 'playing') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch
let touchStartX = null;
canvas.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (touchStartX === null || state !== 'playing') return;
  const dx = e.touches[0].clientX - touchStartX;
  umbrella.moving = dx < -5 ? -1 : dx > 5 ? 1 : 0;
  e.preventDefault();
}, { passive: false });
canvas.addEventListener('touchend', () => {
  umbrella.moving = 0;
  touchStartX = null;
});

startBtn.addEventListener('click', startGame);

// ── Init rain ────────────────────────────────────────────────
function initRain() {
  drops.length = 0;
  for (let i = 0; i < DROP_COUNT; i++) {
    drops.push(newDrop(true));
  }
}

function newDrop(randomY = false) {
  return {
    x: Math.random() * W,
    y: randomY ? Math.random() * H : -10,
    len: 8 + Math.random() * 12,
    speed: 7 + Math.random() * 6,
    alpha: 0.3 + Math.random() * 0.5,
  };
}

// ── Game lifecycle ───────────────────────────────────────────
function startGame() {
  state = 'playing';
  poopProgress = 0;
  wetLevel = 0;
  poopStopped = false;
  resultTimer = 0;
  umbrella.x = W / 2;
  umbrella.moving = 0;
  coco.x = W / 2;
  coco.vx = 0;
  coco.poopState = 'wander';
  coco.squatTimer = 0;
  coco.wanderTimer = 60;
  coco.wanderTarget = W / 2;
  coco.wetShake = 0;
  coco.poopEmojis = [];
  overlay.style.display = 'none';
  initRain();
  if (!frameId) loop();
}

function endGame(won) {
  state = 'result';
  resultTimer = 180;
  overlay.style.display = 'flex';
  if (won) {
    overlayTitle.textContent = '🎉 ミッション完了！';
    overlayMsg.textContent = 'ちゃんとうんちできたね！\nよかったよかった 💩✨\n\nナイス傘さし！';
    startBtn.textContent = 'もう一回！';
  } else {
    overlayTitle.textContent = '💧 ぬれちゃった！';
    overlayMsg.textContent = 'あ〜！ぬれてうんちが止まっちゃった！\nがんばれ、傘をもっと素早く！';
    startBtn.textContent = 'もう一回！';
  }
}

// ── Update ───────────────────────────────────────────────────
function update() {
  if (state !== 'playing') return;

  // Umbrella input
  if (keys['ArrowLeft'])  umbrella.moving = -1;
  else if (keys['ArrowRight']) umbrella.moving = 1;
  else if (!touchStartX) umbrella.moving = 0;

  umbrella.x += umbrella.moving * umbrella.speed;
  umbrella.x = clamp(umbrella.x, umbrella.width / 2, W - umbrella.width / 2);

  // Coco AI wander
  updateCoco();

  // Rain drops
  for (const d of drops) {
    d.y += d.speed;
    if (d.y > H) Object.assign(d, newDrop());
  }

  // Check if coco is under umbrella
  const umbrellaLeft  = umbrella.x - umbrella.width / 2 - 10;
  const umbrellaRight = umbrella.x + umbrella.width / 2 + 10;
  const cocoUnderUmbrella = coco.x > umbrellaLeft && coco.x < umbrellaRight;

  if (cocoUnderUmbrella) {
    // Dry out slowly
    wetLevel = Math.max(0, wetLevel - 0.004);
  } else {
    // Getting wet
    wetLevel = Math.min(1, wetLevel + 0.012);
  }

  // Poop progress
  if (coco.poopState === 'squat') {
    if (wetLevel < 0.6) {
      poopProgress = Math.min(1, poopProgress + 0.003);
    } else {
      // Too wet → poop stops
      coco.wetShake = 20;
      coco.poopState = 'wander';
      coco.wanderTimer = 90;
      poopStopped = true;
      // Push poop back slightly
      poopProgress = Math.max(0, poopProgress - 0.05);
    }
  }

  // Wet too much and no poop at all → fail
  if (wetLevel >= 1) {
    endGame(false);
    return;
  }

  // Win
  if (poopProgress >= 1) {
    endGame(true);
    return;
  }

  // Wet shake animation
  if (coco.wetShake > 0) coco.wetShake--;

  // Update poop emoji particles
  for (let i = coco.poopEmojis.length - 1; i >= 0; i--) {
    const p = coco.poopEmojis[i];
    p.y += p.vy;
    p.vy += 0.2;
    p.alpha -= 0.02;
    if (p.alpha <= 0) coco.poopEmojis.splice(i, 1);
  }

  // Update UI bars
  poopBarEl.style.width = (poopProgress * 100) + '%';
  wetBarEl.style.width = (wetLevel * 100) + '%';
}

function updateCoco() {
  coco.wanderTimer--;

  if (coco.wanderTimer <= 0) {
    if (coco.poopState === 'wander') {
      // Random: either keep wandering or try to squat
      if (Math.random() < 0.35) {
        coco.poopState = 'squat';
        coco.squatTimer = 40 + Math.random() * 60;
        coco.wanderTimer = coco.squatTimer;
        coco.vx = 0;
      } else {
        pickNewTarget();
      }
    } else if (coco.poopState === 'squat') {
      coco.poopState = 'wander';
      pickNewTarget();
    }
  }

  if (coco.poopState === 'wander') {
    const dx = coco.wanderTarget - coco.x;
    coco.vx = dx * 0.06;
    coco.x += coco.vx;
    if (Math.abs(dx) < 5 && coco.wanderTimer > 20) pickNewTarget();
  } else {
    coco.vx *= 0.8;
    coco.x += coco.vx;
    // Emit poop particle
    if (Math.random() < 0.06 && poopProgress < 1) {
      coco.poopEmojis.push({
        x: coco.x, y: coco.y + 20,
        vy: -(1 + Math.random() * 1.5),
        alpha: 1, size: 12 + Math.random() * 8,
      });
    }
  }

  coco.x = clamp(coco.x, 40, W - 40);
}

function pickNewTarget() {
  coco.wanderTarget = 60 + Math.random() * (W - 120);
  coco.wanderTimer = 60 + Math.random() * 80;
}

// ── Draw ─────────────────────────────────────────────────────
function draw() {
  // Sky gradient
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1c2a4a');
  sky.addColorStop(1, '#2a3a5a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Ground
  ctx.fillStyle = '#2d4a1e';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.fillStyle = '#3a6127';
  ctx.fillRect(0, H * 0.78, W, 6);

  // Puddles
  drawPuddles();

  // Rain
  drawRain();

  // Poop emojis (particles)
  for (const p of coco.poopEmojis) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.font = `${p.size}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText('💩', p.x, p.y);
    ctx.restore();
  }

  // Coco
  drawCoco();

  // Umbrella (drawn last = on top = POV)
  drawUmbrella();

  // Wet overlay
  if (wetLevel > 0.3) {
    ctx.fillStyle = `rgba(100,180,255,${(wetLevel - 0.3) * 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Poop progress text when squatting
  if (coco.poopState === 'squat' && poopProgress > 0) {
    ctx.save();
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#DEB887';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(poopProgress * 100)}%`, coco.x, coco.y - 30);
    ctx.restore();
  }
}

function drawRain() {
  ctx.save();
  for (const d of drops) {
    ctx.strokeStyle = `rgba(174,214,241,${d.alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(d.x - 2, d.y + d.len);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPuddles() {
  ctx.save();
  ctx.fillStyle = 'rgba(100,160,220,0.25)';
  for (const [px, py, pw, ph] of [[60, H*0.79, 80, 8],[220, H*0.81, 55, 6],[350, H*0.80, 70, 7]]) {
    ctx.beginPath();
    ctx.ellipse(px, py, pw, ph, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUmbrella() {
  const ux = umbrella.x;
  const uy = umbrella.y;
  const r = umbrella.width / 2;

  ctx.save();

  // Shadow on ground
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(ux, H * 0.79, r * 0.8, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Handle (pole)
  ctx.strokeStyle = '#6d4c41';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ux, uy + 10);
  ctx.lineTo(ux, H * 0.79);
  ctx.stroke();

  // Umbrella canopy
  const gradient = ctx.createRadialGradient(ux, uy, 5, ux, uy, r);
  gradient.addColorStop(0, '#e53935');
  gradient.addColorStop(0.6, '#c62828');
  gradient.addColorStop(1, '#b71c1c');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ux, uy, r, Math.PI, 0);
  // Scalloped bottom
  const segments = 8;
  const segW = (r * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const sx = (ux - r) + i * segW;
    ctx.arc(sx + segW / 2, uy, segW / 2, 0, Math.PI);
  }
  ctx.closePath();
  ctx.fill();

  // Canopy highlight
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(ux - r * 0.2, uy - r * 0.15, r * 0.45, Math.PI + 0.3, Math.PI * 2 - 0.3);
  ctx.closePath();
  ctx.fill();

  // Tip
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ux, uy - r * 0.02, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCoco() {
  const cx = coco.x + (coco.wetShake > 0 ? (Math.random() - 0.5) * 6 : 0);
  const cy = coco.y;
  const squatting = coco.poopState === 'squat';
  const facing = coco.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(facing, 1);

  // Body
  const bodyH = squatting ? 28 : 34;
  const bodyW = 54;
  const bodyY = squatting ? 6 : 0;

  ctx.fillStyle = '#c8a46e';
  ctx.beginPath();
  ctx.ellipse(0, bodyY, bodyW / 2, bodyH / 2, squatting ? 0.2 : 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = '#c8a46e';
  ctx.beginPath();
  ctx.ellipse(22, bodyY - 14, 16, 14, 0.1, 0, Math.PI * 2);
  ctx.fill();

  // Ear
  ctx.fillStyle = '#a0784a';
  ctx.beginPath();
  ctx.ellipse(28, bodyY - 22, 7, 10, 0.4, 0, Math.PI * 2);
  ctx.fill();

  // Eye
  ctx.fillStyle = '#2c1a00';
  ctx.beginPath();
  ctx.arc(26, bodyY - 16, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(27, bodyY - 17, 1, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#2c1a00';
  ctx.beginPath();
  ctx.ellipse(33, bodyY - 13, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  ctx.fillStyle = '#b8945e';
  const legY = bodyY + bodyH / 2 - 4;
  if (squatting) {
    // Squatting legs
    ctx.fillRect(-22, legY, 10, 14);
    ctx.fillRect(-5,  legY, 10, 14);
    ctx.fillRect(8,   legY, 10, 14);
    // Butt lowered
    ctx.fillStyle = '#c8a46e';
    ctx.beginPath();
    ctx.ellipse(-26, legY + 5, 14, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Walk animation
    const legSwing = Math.sin(Date.now() * 0.015) * 5;
    ctx.save();
    ctx.fillRect(-22, legY + legSwing, 10, 16);
    ctx.fillRect(-5,  legY - legSwing, 10, 16);
    ctx.fillRect(8,   legY + legSwing, 10, 16);
    ctx.restore();
  }

  // Tail
  ctx.strokeStyle = '#c8a46e';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + 4, bodyY);
  ctx.quadraticCurveTo(
    -bodyW / 2 - 14,
    bodyY - (squatting ? 8 : 18),
    -bodyW / 2 - 6,
    bodyY - (squatting ? 20 : 32)
  );
  ctx.stroke();

  // Wet drops
  if (wetLevel > 0.2) {
    ctx.fillStyle = `rgba(100,180,255,${wetLevel * 0.7})`;
    ctx.font = '10px serif';
    ctx.textAlign = 'center';
    ctx.fillText('💧', -10, bodyY - 28);
    if (wetLevel > 0.5) ctx.fillText('💧', 10, bodyY - 32);
  }

  ctx.restore();
}

// ── Loop ─────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  frameId = requestAnimationFrame(loop);
}

// ── Helpers ──────────────────────────────────────────────────
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ── Boot ─────────────────────────────────────────────────────
initRain();
// Draw static title screen
loop();
// Pause update logic until game starts (overlay handles it)
