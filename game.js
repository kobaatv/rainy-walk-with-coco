const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const poopBarEl    = document.getElementById('poop-bar');
const wetBarEl     = document.getElementById('wet-bar');
const overlay      = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg   = document.getElementById('overlay-msg');
const startBtn     = document.getElementById('start-btn');

// ── Constants ────────────────────────────────────────────────
const POOPS_TO_WIN = 4;
const WET_RATE     = 0.006;  // 傘なし：かなり速く濡れる
const DRY_RATE     = 0.0008;  // 通常乾燥
const DRY_RATE_PEE = 0.022;  // おしっこ中乾燥（速い）
const POOP_RATE    = 0.010;

// ── State ────────────────────────────────────────────────────
let state        = 'title';
let poopProgress = 0;
let poopsLeft    = POOPS_TO_WIN;
let wetLevel     = 0;
let frameId;
let splashes     = [];  // rain splash particles on ground

// ── Umbrella ─────────────────────────────────────────────────
const umbrella = {
  x: W / 2,
  y: H * 0.35,
  width: 155,   // 少し小さく
  speed: 7,
  moving: 0,
};

// ── Coco ─────────────────────────────────────────────────────
// poopState: 'wander' | 'pee' | 'squat' | 'walk-poop'
const coco = {
  x: W / 2,
  y: H * 0.62,
  vx: 0,
  poopState: 'wander',
  actionTimer: 80,
  wanderTarget: W / 2,
  wetShake: 0,
  particles: [],
  drips: [],   // persistent water drip positions on body
};

const drops = [];
const DROP_COUNT = 200;

// ── Input ────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state === 'playing') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// canvas直接タッチ: 左半分=左移動、右半分=右移動
function setTouchActive(_a) {}

let touchStartX = null;

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const tx = e.touches[0].clientX - rect.left;
  touchStartX = tx;
  umbrella.moving = tx < rect.width / 2 ? -1 : 1;
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (state !== 'playing') return;
  const rect = canvas.getBoundingClientRect();
  const tx = e.touches[0].clientX - rect.left;
  umbrella.moving = tx < rect.width / 2 ? -1 : 1;
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  umbrella.moving = 0;
  touchStartX = null;
}, { passive: false });

canvas.addEventListener('touchcancel', () => {
  umbrella.moving = 0;
  touchStartX = null;
});

startBtn.addEventListener('click', startGame);

// ── Rain ─────────────────────────────────────────────────────
function initRain() {
  drops.length = 0;
  splashes.length = 0;
  for (let i = 0; i < DROP_COUNT; i++) drops.push(newDrop(true));
}

function newDrop(randomY = false) {
  return {
    x: Math.random() * W,
    y: randomY ? Math.random() * H : -10,
    len: 10 + Math.random() * 14,
    speed: 9 + Math.random() * 7,
    alpha: 0.35 + Math.random() * 0.5,
    thickness: 0.8 + Math.random() * 1.2,
  };
}

// ── Lifecycle ─────────────────────────────────────────────────
function startGame() {
  state = 'playing';
  poopProgress = 0;
  poopsLeft    = POOPS_TO_WIN;
  wetLevel     = 0;
  umbrella.x   = W / 2;
  umbrella.moving = 0;
  coco.x = W / 2; coco.vx = 0;
  coco.poopState = 'wander';
  coco.actionTimer = 80;
  coco.wanderTarget = W / 2;
  coco.wetShake = 0;
  coco.particles = [];
  coco.drips = [];
  splashes = [];
  overlay.style.display = 'none';
  setTouchActive(true);
  initRain();
  if (!frameId) loop();
}

function endGame(won) {
  state = 'result';
  setTouchActive(false);
  overlay.style.display = 'flex';
  if (won) {
    overlayTitle.textContent = '🎉 ミッション完了！';
    overlayMsg.textContent = `${POOPS_TO_WIN}回全部うんちできたね！\n完璧な傘さしでした 💩✨`;
  } else {
    overlayTitle.textContent = '💧 ぬれすぎた！';
    overlayMsg.textContent = 'びしょ濡れでうんちどころじゃない！\nおしっこ中に傘の下で乾かしておこう！';
  }
  startBtn.textContent = 'もう一回！';
}

// ── Update ───────────────────────────────────────────────────
function update() {
  if (state !== 'playing') return;

  if (keys['ArrowLeft'])       umbrella.moving = -1;
  else if (keys['ArrowRight']) umbrella.moving =  1;
  else if (!keys['ArrowLeft'] && !keys['ArrowRight'] && touchStartX === null) umbrella.moving = 0;
  umbrella.x += umbrella.moving * umbrella.speed;
  umbrella.x = clamp(umbrella.x, umbrella.width / 2, W - umbrella.width / 2);

  updateCoco();

  // Rain movement + splash generation
  const ux = umbrella.x, uy = umbrella.y, ur = umbrella.width / 2;
  for (const d of drops) {
    d.y += d.speed;
    if (d.y > H) {
      Object.assign(d, newDrop());
    } else if (d.y > H * 0.78 && d.y < H * 0.78 + d.speed + 2) {
      // Hit ground → splash
      if (Math.random() < 0.3) {
        splashes.push({ x: d.x, y: H * 0.78, r: 0, alpha: 0.7 });
      }
    }
    // Hits umbrella top → splash on umbrella edge
    if (d.x > ux - ur && d.x < ux + ur && Math.abs(d.y - uy) < d.speed + 2) {
      if (Math.random() < 0.4) {
        splashes.push({ x: d.x, y: uy, r: 0, alpha: 0.5, umbrella: true });
      }
    }
  }

  // Update splashes
  for (let i = splashes.length - 1; i >= 0; i--) {
    const s = splashes[i];
    s.r     += 1.5;
    s.alpha -= 0.08;
    if (s.alpha <= 0) splashes.splice(i, 1);
  }

  // Coverage
  const covered = Math.abs(coco.x - umbrella.x) < umbrella.width / 2 + 8;

  if (covered) {
    const dryRate = coco.poopState === 'pee' ? DRY_RATE_PEE : DRY_RATE;
    wetLevel = Math.max(0, wetLevel - dryRate);
  } else {
    wetLevel = Math.min(1, wetLevel + WET_RATE);
  }

  // Update body drips based on wetLevel
  if (!covered && wetLevel > 0.3 && Math.random() < 0.08) {
    coco.drips.push({ ox: (Math.random() - 0.5) * 40, oy: -10, dy: 0, alpha: 0.9 });
  }
  for (let i = coco.drips.length - 1; i >= 0; i--) {
    const d = coco.drips[i];
    d.dy   += 0.3;
    d.oy   += d.dy;
    d.alpha -= 0.015;
    if (d.alpha <= 0 || d.oy > 30) coco.drips.splice(i, 1);
  }
  // Cap drips
  if (coco.drips.length > 12) coco.drips.splice(0, coco.drips.length - 12);

  // Poop progress during squat OR walk-poop
  const isPooping = coco.poopState === 'squat' || coco.poopState === 'walk-poop';
  if (isPooping) {
    if (wetLevel < 0.6) {
      poopProgress = Math.min(1, poopProgress + POOP_RATE);
      if (poopProgress >= 1) {
        poopProgress = 0;
        poopsLeft--;
        coco.poopState = 'wander';
        coco.actionTimer = 60;
        for (let i = 0; i < 8; i++) {
          coco.particles.push({
            emoji: '💩', x: coco.x, y: coco.y + 10,
            vy: -(2 + Math.random() * 3), vx: (Math.random() - 0.5) * 4,
            alpha: 1, size: 16 + Math.random() * 10,
          });
        }
        if (poopsLeft <= 0) { endGame(true); return; }
      }
    } else {
      coco.wetShake = 22;
      coco.poopState = 'wander';
      coco.actionTimer = 100;
      poopProgress = Math.max(0, poopProgress - 0.08);
    }
  }

  if (wetLevel >= 1) { endGame(false); return; }
  if (coco.wetShake > 0) coco.wetShake--;

  // Particles
  for (let i = coco.particles.length - 1; i >= 0; i--) {
    const p = coco.particles[i];
    p.y += p.vy; p.x += p.vx || 0; p.vy += 0.15; p.alpha -= 0.018;
    if (p.alpha <= 0) coco.particles.splice(i, 1);
  }

  poopBarEl.style.width = (poopProgress * 100) + '%';
  wetBarEl.style.width  = (wetLevel * 100) + '%';
  // Pulse wet bar red when danger
  wetBarEl.style.background = wetLevel > 0.7
    ? `linear-gradient(90deg, #e53935, #ff1744)`
    : `linear-gradient(90deg, #4fc3f7, #0288d1)`;
}

function updateCoco() {
  coco.actionTimer--;

  if (coco.actionTimer <= 0) {
    if (coco.poopState === 'wander') {
      const r = Math.random();
      if (r < 0.48) {
        coco.poopState   = 'pee';
        coco.actionTimer = 120 + Math.random() * 100;
        coco.vx = 0;
      } else if (r < 0.55) {
        // 止まってうんち
        coco.poopState   = 'squat';
        coco.actionTimer = 100 + Math.random() * 80;
        coco.vx = 0;
      } else if (r < 0.75) {
        // 歩きながらうんち
        coco.poopState   = 'walk-poop';
        coco.actionTimer = 90 + Math.random() * 70;
        pickNewTarget();
      } else {
        pickNewTarget();
      }
    } else {
      coco.poopState = 'wander';
      pickNewTarget();
    }
  }

  if (coco.poopState === 'wander') {
    const dx = coco.wanderTarget - coco.x;
    coco.vx  = dx * 0.04;
    coco.x  += coco.vx;
    if (Math.abs(dx) < 5 && coco.actionTimer > 20) pickNewTarget();
  } else if (coco.poopState === 'walk-poop') {
    // ゆっくり歩きながらうんち
    const dx = coco.wanderTarget - coco.x;
    coco.vx  = dx * 0.02;
    coco.x  += coco.vx;
    if (Math.abs(dx) < 8) pickNewTarget();
    if (Math.random() < 0.08) {
      coco.particles.push({ emoji: '💩', x: coco.x, y: coco.y + 22, vy: -(0.8 + Math.random()), vx: -coco.vx * 0.5, alpha: 1, size: 10 + Math.random() * 6 });
    }
  } else {
    coco.vx *= 0.8;
    coco.x  += coco.vx;
    if (coco.poopState === 'squat' && Math.random() < 0.07) {
      coco.particles.push({ emoji: '💩', x: coco.x, y: coco.y + 20, vy: -(1 + Math.random() * 1.5), vx: 0, alpha: 1, size: 12 + Math.random() * 8 });
    }
    if (coco.poopState === 'pee' && Math.random() < 0.10) {
      coco.particles.push({ emoji: '💦', x: coco.x + 22, y: coco.y + 18, vy: -(0.4 + Math.random() * 0.8), vx: (Math.random() - 0.3) * 2, alpha: 1, size: 10 + Math.random() * 6 });
    }
  }

  coco.x = clamp(coco.x, 40, W - 40);
}

function pickNewTarget() {
  coco.wanderTarget = 60 + Math.random() * (W - 120);
  coco.actionTimer  = 70 + Math.random() * 80;
}

// ── Draw ─────────────────────────────────────────────────────
function draw() {
  // Sky — gets darker/bluer when wet
  const wetTint = wetLevel * 0.3;
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, `rgb(${Math.round(28 - wetTint*10)},${Math.round(42 + wetTint*8)},${Math.round(74 + wetTint*20)})`);
  sky.addColorStop(1, '#2a3a5a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Ground — darker when wet
  ctx.fillStyle = wetLevel > 0.4 ? '#1e3312' : '#2d4a1e';
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.fillStyle = '#3a6127';
  ctx.fillRect(0, H * 0.78, W, 6);

  drawPuddles();
  drawSplashes();
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

  // Wet vignette — strong blue edge glow when soaked
  if (wetLevel > 0.25) {
    const vign = ctx.createRadialGradient(W/2, H/2, H*0.2, W/2, H/2, H*0.85);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, `rgba(30,100,220,${(wetLevel - 0.25) * 0.55})`);
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, W, H);
  }

  // Flashing danger overlay when nearly soaked
  if (wetLevel > 0.8 && Math.sin(Date.now() * 0.015) > 0.5) {
    ctx.fillStyle = `rgba(30,80,200,${(wetLevel - 0.8) * 0.18})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Labels
  const isPooping = coco.poopState === 'squat' || coco.poopState === 'walk-poop';
  if (isPooping) {
    const label = `💩 ${Math.floor(poopProgress*100)}%`;
    drawLabel(coco.x, coco.y - 38, label, '#DEB887');
  } else if (coco.poopState === 'pee') {
    drawLabel(coco.x, coco.y - 36, '💦 おしっこ中...', '#7ecfff');
    const covered = Math.abs(coco.x - umbrella.x) < umbrella.width / 2 + 8;
    if (wetLevel > 0.2 && covered) {
      drawLabel(coco.x, coco.y - 54, '☀ 乾かし中！', 'rgba(255,220,80,0.95)');
    } else if (wetLevel > 0.2) {
      drawLabel(coco.x, coco.y - 54, '⚠ 傘を持ってきて！', 'rgba(255,100,80,0.95)');
    }
  }

  drawPoopCounter();
}

function drawPoopCounter() {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`うんち残り: ${'💩'.repeat(poopsLeft)}`, W / 2, H - 14);
  ctx.restore();
}

function drawLabel(x, y, text, color) {
  ctx.save();
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawRain() {
  const ux = umbrella.x, uy = umbrella.y, ur = umbrella.width / 2;
  ctx.save();
  for (const d of drops) {
    // No rain under umbrella canopy
    if (d.x > ux - ur && d.x < ux + ur && d.y > uy) continue;
    ctx.strokeStyle = `rgba(174,214,241,${d.alpha})`;
    ctx.lineWidth = d.thickness;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    let ex = d.x - 2, ey = d.y + d.len;
    if (ex > ux - ur && ex < ux + ur && ey > uy) ey = uy;
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSplashes() {
  ctx.save();
  for (const s of splashes) {
    ctx.strokeStyle = `rgba(174,214,241,${s.alpha})`;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, s.r * 1.5, s.r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPuddles() {
  // Puddles grow with wetLevel
  const grow = 1 + wetLevel * 0.8;
  ctx.save();
  ctx.fillStyle = `rgba(100,160,220,${0.2 + wetLevel * 0.25})`;
  for (const [px, py, pw, ph] of [[60,H*0.79,80,8],[220,H*0.81,55,6],[350,H*0.80,70,7]]) {
    ctx.beginPath();
    ctx.ellipse(px, py, pw * grow, ph * grow, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawUmbrella() {
  const ux = umbrella.x, uy = umbrella.y, r = umbrella.width / 2;
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

  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(ux - r * 0.2, uy - r * 0.15, r * 0.45, Math.PI + 0.3, Math.PI * 2 - 0.3);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(ux, uy - r * 0.02, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCoco() {
  const cx = coco.x + (coco.wetShake > 0 ? (Math.random() - 0.5) * 6 : 0);
  const cy = coco.y;
  const squatting  = coco.poopState === 'squat';
  const walkPooping= coco.poopState === 'walk-poop';
  const peeing     = coco.poopState === 'pee';
  const facing     = coco.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(facing, 1);

  // Wet tint on coco
  if (wetLevel > 0.3) {
    ctx.filter = `hue-rotate(${wetLevel * 30}deg) saturate(${1 + wetLevel * 0.5})`;
  }

  const bodyH = (squatting || walkPooping) ? 28 : 34;
  const bodyW = 54;
  const bodyY = (squatting || walkPooping) ? 5 : 0;

  ctx.fillStyle = '#c8a46e';
  ctx.beginPath();
  ctx.ellipse(0, bodyY, bodyW / 2, bodyH / 2, (squatting || walkPooping) ? 0.15 : 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#c8a46e';
  ctx.beginPath();
  ctx.ellipse(22, bodyY - 14, 16, 14, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#a0784a';
  ctx.beginPath();
  ctx.ellipse(28, bodyY - 22, 7, 10, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2c1a00';
  ctx.beginPath();
  ctx.arc(26, bodyY - 16, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(27, bodyY - 17, 1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#2c1a00';
  ctx.beginPath();
  ctx.ellipse(33, bodyY - 13, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#b8945e';
  const legY = bodyY + bodyH / 2 - 4;
  if (squatting) {
    ctx.fillRect(-22, legY, 10, 14);
    ctx.fillRect(-5, legY, 10, 14);
    ctx.fillRect(8, legY, 10, 14);
    ctx.fillStyle = '#c8a46e';
    ctx.beginPath();
    ctx.ellipse(-26, legY + 5, 14, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (walkPooping) {
    // 歩きながら少しお尻を下げたポーズ
    const legSwing = Math.sin(Date.now() * 0.012) * 4;
    ctx.fillRect(-22, legY + legSwing + 3, 10, 14);
    ctx.fillRect(-5,  legY - legSwing + 3, 10, 14);
    ctx.fillRect(8,   legY + legSwing + 3, 10, 14);
    // お尻を少し落とす
    ctx.fillStyle = '#c8a46e';
    ctx.beginPath();
    ctx.ellipse(-24, legY + 8, 12, 8, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (peeing) {
    ctx.fillRect(-22, legY, 10, 14);
    ctx.fillRect(-5, legY, 10, 14);
    ctx.save();
    ctx.translate(24, legY + 7);
    ctx.rotate(-0.7);
    ctx.fillRect(-5, -5, 10, 14);
    ctx.restore();
  } else {
    const legSwing = Math.sin(Date.now() * 0.012) * 5;
    ctx.fillRect(-22, legY + legSwing, 10, 16);
    ctx.fillRect(-5, legY - legSwing, 10, 16);
    ctx.fillRect(8, legY + legSwing, 10, 16);
  }

  ctx.strokeStyle = '#c8a46e';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + 4, bodyY);
  ctx.quadraticCurveTo(
    -bodyW / 2 - 14, bodyY - ((squatting || walkPooping) ? 8 : 18),
    -bodyW / 2 - 6,  bodyY - ((squatting || walkPooping) ? 18 : 32)
  );
  ctx.stroke();

  ctx.filter = 'none';

  // Water drips running down body
  ctx.fillStyle = 'rgba(140,200,255,0.85)';
  for (const d of coco.drips) {
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.ellipse(d.ox, bodyY + d.oy, 2, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

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
