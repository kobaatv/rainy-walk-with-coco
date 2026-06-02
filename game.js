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
let frameId;

// Umbrella (player)
const umbrella = {
  x: W / 2,
  y: H * 0.35,
  width: 180,   // bigger umbrella
  speed: 7,
  moving: 0,
};

// Coco (dog)
// poopState: 'wander' | 'pee' | 'squat'
// During 'pee', poop doesn't progress → breathing room to dry off
const coco = {
  x: W / 2,
  y: H * 0.62,
  vx: 0,
  poopState: 'wander',
  actionTimer: 0,
  wanderTarget: W / 2,
  wetShake: 0,
  particles: [],  // {emoji, x, y, vy, alpha, size}
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
  for (let i = 0; i < DROP_COUNT; i++) drops.push(newDrop(true));
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
  umbrella.x = W / 2;
  umbrella.moving = 0;
  coco.x = W / 2;
  coco.vx = 0;
  coco.poopState = 'wander';
  coco.actionTimer = 80;
  coco.wanderTarget = W / 2;
  coco.wetShake = 0;
  coco.particles = [];
  overlay.style.display = 'none';
  initRain();
  if (!frameId) loop();
}

function endGame(won) {
  state = 'result';
  overlay.style.display = 'flex';
  if (won) {
    overlayTitle.textContent = '🎉 ミッション完了！';
    overlayMsg.textContent = 'ちゃんとうんちできたね！\nよかったよかった 💩✨\n\nナイス傘さし！';
  } else {
    overlayTitle.textContent = '💧 ぬれちゃった！';
    overlayMsg.textContent = 'あ〜！ぬれすぎてうんちが止まっちゃった！\nおしっこ中に乾かして備えよう！';
  }
  startBtn.textContent = 'もう一回！';
}

// ── Update ───────────────────────────────────────────────────
function update() {
  if (state !== 'playing') return;

  // Umbrella input
  if (keys['ArrowLeft'])       umbrella.moving = -1;
  else if (keys['ArrowRight']) umbrella.moving = 1;
  else if (!touchStartX)       umbrella.moving = 0;

  umbrella.x += umbrella.moving * umbrella.speed;
  umbrella.x = clamp(umbrella.x, umbrella.width / 2, W - umbrella.width / 2);

  updateCoco();

  for (const d of drops) {
    d.y += d.speed;
    if (d.y > H) Object.assign(d, newDrop());
  }

  // Check coverage
  const umbrellaLeft  = umbrella.x - umbrella.width / 2 - 10;
  const umbrellaRight = umbrella.x + umbrella.width / 2 + 10;
  const covered = coco.x > umbrellaLeft && coco.x < umbrellaRight;

  if (covered) {
    wetLevel = Math.max(0, wetLevel - 0.005);  // dry faster under umbrella
  } else {
    wetLevel = Math.min(1, wetLevel + 0.010);
  }

  // Poop progress only during 'squat'
  if (coco.poopState === 'squat') {
    if (wetLevel < 0.6) {
      poopProgress = Math.min(1, poopProgress + 0.008);
    } else {
      // Too wet → abort squat
      coco.wetShake = 20;
      coco.poopState = 'wander';
      coco.actionTimer = 100;
      poopProgress = Math.max(0, poopProgress - 0.05);
    }
  }
  // During 'pee': nothing happens to poop — just dry time

  if (wetLevel >= 1) { endGame(false); return; }
  if (poopProgress >= 1) { endGame(true); return; }

  if (coco.wetShake > 0) coco.wetShake--;

  // Particles
  for (let i = coco.particles.length - 1; i >= 0; i--) {
    const p = coco.particles[i];
    p.y += p.vy;
    p.vy += 0.2;
    p.alpha -= 0.02;
    if (p.alpha <= 0) coco.particles.splice(i, 1);
  }

  poopBarEl.style.width = (poopProgress * 100) + '%';
  wetBarEl.style.width = (wetLevel * 100) + '%';
}

function updateCoco() {
  coco.actionTimer--;

  if (coco.actionTimer <= 0) {
    if (coco.poopState === 'wander') {
      // Decide next action: pee (40%), squat (30%), keep wandering (30%)
      const r = Math.random();
      if (r < 0.30) {
        coco.poopState = 'pee';
        coco.actionTimer = 100 + Math.random() * 80;
        coco.vx = 0;
      } else if (r < 0.75) {
        coco.poopState = 'squat';
        coco.actionTimer = 90 + Math.random() * 80;  // longer squat
        coco.vx = 0;
      } else {
        pickNewTarget();
      }
    } else {
      // After pee or squat → go back to wandering
      coco.poopState = 'wander';
      pickNewTarget();
    }
  }

  if (coco.poopState === 'wander') {
    const dx = coco.wanderTarget - coco.x;
    coco.vx = dx * 0.04;  // slower movement
    coco.x += coco.vx;
    if (Math.abs(dx) < 5 && coco.actionTimer > 20) pickNewTarget();
  } else {
    coco.vx *= 0.8;
    coco.x += coco.vx;
    // Emit particles
    if (coco.poopState === 'squat' && Math.random() < 0.06 && poopProgress < 1) {
      coco.particles.push({ emoji: '💩', x: coco.x, y: coco.y + 20, vy: -(1 + Math.random() * 1.5), alpha: 1, size: 12 + Math.random() * 8 });
    }
    if (coco.poopState === 'pee' && Math.random() < 0.08) {
      coco.particles.push({ emoji: '💦', x: coco.x + 20, y: coco.y + 16, vy: -(0.5 + Math.random()), alpha: 1, size: 10 + Math.random() * 6 });
    }
  }

  coco.x = clamp(coco.x, 40, W - 40);
}

function pickNewTarget() {
  coco.wanderTarget = 60 + Math.random() * (W - 120);
  coco.actionTimer = 80 + Math.random() * 80;
}

// ── Draw ─────────────────────────────────────────────────────
function draw() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#1c2a4a');
  sky.addColorStop(1, '#2a3a5a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#2d4a1e';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.fillStyle = '#3a6127';
  ctx.fillRect(0, H * 0.78, W, 6);

  drawPuddles();
  drawRain();

  for (const p of coco.particles) {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.font = `${p.size}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.emoji, p.x, p.y);
    ctx.restore();
  }

  drawCoco();
  drawUmbrella();

  if (wetLevel > 0.3) {
    ctx.fillStyle = `rgba(100,180,255,${(wetLevel - 0.3) * 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Status label above coco
  const label = coco.poopState === 'squat' ? `💩 ${Math.floor(poopProgress * 100)}%`
              : coco.poopState === 'pee'   ? '💦 おしっこ中...'
              : null;
  if (label) {
    ctx.save();
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = coco.poopState === 'pee' ? '#7ecfff' : '#DEB887';
    ctx.textAlign = 'center';
    ctx.fillText(label, coco.x, coco.y - 34);
    ctx.restore();
  }

  // "乾かして！" hint when pee and wet
  if (coco.poopState === 'pee' && wetLevel > 0.25) {
    ctx.save();
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = 'rgba(255,220,100,0.9)';
    ctx.textAlign = 'center';
    ctx.fillText('☀ 乾かすチャンス！', coco.x, coco.y - 50);
    ctx.restore();
  }
}

function drawRain() {
  const ux = umbrella.x;
  const uy = umbrella.y;
  const r = umbrella.width / 2;

  ctx.save();
  for (const d of drops) {
    // Skip drops that are inside the umbrella canopy (semicircle above uy)
    const dx = d.x - ux;
    const dy = d.y - uy;
    if (dy <= 0 && dx * dx + dy * dy < r * r) continue;
    // Also clip the line endpoint if it would enter the canopy
    let ex = d.x - 2;
    let ey = d.y + d.len;
    const edx = ex - ux;
    const edy = ey - uy;
    if (edy <= 0 && edx * edx + edy * edy < r * r) {
      // Shorten the line so it stops at the umbrella edge
      const t = Math.sqrt(r * r / (dx * dx + dy * dy || 1));
      ex = ux + dx * t - 2;
      ey = uy + dy * t;
    }
    ctx.strokeStyle = `rgba(174,214,241,${d.alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPuddles() {
  ctx.save();
  ctx.fillStyle = 'rgba(100,160,220,0.25)';
  for (const [px, py, pw, ph] of [[60,H*0.79,80,8],[220,H*0.81,55,6],[350,H*0.80,70,7]]) {
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

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(ux, H * 0.79, r * 0.8, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  // Handle
  ctx.strokeStyle = '#6d4c41';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ux, uy + 10);
  ctx.lineTo(ux, H * 0.79);
  ctx.stroke();

  // Canopy
  const gradient = ctx.createRadialGradient(ux, uy, 5, ux, uy, r);
  gradient.addColorStop(0, '#e53935');
  gradient.addColorStop(0.6, '#c62828');
  gradient.addColorStop(1, '#b71c1c');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ux, uy, r, Math.PI, 0);
  const segments = 10;
  const segW = (r * 2) / segments;
  for (let i = 0; i < segments; i++) {
    const sx = (ux - r) + i * segW;
    ctx.arc(sx + segW / 2, uy, segW / 2, 0, Math.PI);
  }
  ctx.closePath();
  ctx.fill();

  // Highlight
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
  const peeing    = coco.poopState === 'pee';
  const facing = coco.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(facing, 1);

  const bodyH = squatting ? 28 : 34;
  const bodyW = 54;
  const bodyY = squatting ? 6 : 0;

  // Body
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
    ctx.fillRect(-22, legY, 10, 14);
    ctx.fillRect(-5,  legY, 10, 14);
    ctx.fillRect(8,   legY, 10, 14);
    ctx.fillStyle = '#c8a46e';
    ctx.beginPath();
    ctx.ellipse(-26, legY + 5, 14, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (peeing) {
    // Leg lifted for pee
    ctx.fillRect(-22, legY, 10, 14);
    ctx.fillRect(-5,  legY, 10, 14);
    ctx.save();
    ctx.translate(24, legY + 7);
    ctx.rotate(-0.7);
    ctx.fillRect(-5, -5, 10, 14);
    ctx.restore();
  } else {
    const legSwing = Math.sin(Date.now() * 0.012) * 5;
    ctx.fillRect(-22, legY + legSwing, 10, 16);
    ctx.fillRect(-5,  legY - legSwing, 10, 16);
    ctx.fillRect(8,   legY + legSwing, 10, 16);
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
    ctx.font = '10px serif';
    ctx.textAlign = 'center';
    ctx.globalAlpha = wetLevel * 0.8;
    ctx.fillText('💧', -10, bodyY - 28);
    if (wetLevel > 0.5) ctx.fillText('💧', 10, bodyY - 32);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

// ── Loop ─────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  frameId = requestAnimationFrame(loop);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

initRain();
loop();
