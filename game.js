const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const poopBarEl  = document.getElementById('poop-bar');
const wetBarEl   = document.getElementById('wet-bar');
const overlay    = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayMsg   = document.getElementById('overlay-msg');
const startBtn     = document.getElementById('start-btn');

// ── Constants ────────────────────────────────────────────────
const POOPS_TO_WIN  = 4;     // うんち4回でクリア
const WET_RATE      = 0.018; // 傘なしで濡れる速さ（速め）
const DRY_RATE      = 0.005; // 傘あり通常の乾く速さ
const DRY_RATE_PEE  = 0.014; // おしっこ中・傘あり時の乾く速さ（速い）
const POOP_RATE     = 0.010; // うんちゲージ進行速度

// ── Game state ──────────────────────────────────────────────
let state = 'title';
let poopProgress = 0;  // 0→1 で1回のうんち完了
let poopsLeft    = POOPS_TO_WIN;
let wetLevel     = 0;  // 0→1
let frameId;

// Umbrella
const umbrella = {
  x: W / 2,
  y: H * 0.35,
  width: 180,
  speed: 7,
  moving: 0,
};

// Coco
// poopState: 'wander' | 'pee' | 'squat'
const coco = {
  x: W / 2,
  y: H * 0.62,
  vx: 0,
  poopState: 'wander',
  actionTimer: 80,
  wanderTarget: W / 2,
  wetShake: 0,
  particles: [],
};

const drops = [];
const DROP_COUNT = 180;

// ── Input ────────────────────────────────────────────────────
const keys = {};
document.addEventListener('keydown', e => {
  keys[e.key] = true;
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state === 'playing') e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// Touch: left half = move left, right half = move right
const touchControls = document.getElementById('touch-controls');
const btnLeft  = document.getElementById('btn-left');
const btnRight = document.getElementById('btn-right');

function setTouchActive(active) {
  touchControls.classList.toggle('active', active);
}

btnLeft.addEventListener('touchstart',  e => { umbrella.moving = -1; e.preventDefault(); }, { passive: false });
btnLeft.addEventListener('touchend',    e => { umbrella.moving = 0;  e.preventDefault(); }, { passive: false });
btnRight.addEventListener('touchstart', e => { umbrella.moving =  1; e.preventDefault(); }, { passive: false });
btnRight.addEventListener('touchend',   e => { umbrella.moving = 0;  e.preventDefault(); }, { passive: false });

// Fallback: also allow direct canvas swipe (keeps old behaviour as backup)
let touchStartX = null;
canvas.addEventListener('touchstart', e => {
  if (state !== 'playing') return;
  touchStartX = e.touches[0].clientX;
}, { passive: true });
canvas.addEventListener('touchend', () => { touchStartX = null; });

startBtn.addEventListener('click', startGame);

// ── Rain ─────────────────────────────────────────────────────
function initRain() {
  drops.length = 0;
  for (let i = 0; i < DROP_COUNT; i++) drops.push(newDrop(true));
}

function newDrop(randomY = false) {
  return {
    x: Math.random() * W,
    y: randomY ? Math.random() * H : -10,
    len: 8 + Math.random() * 14,
    speed: 8 + Math.random() * 6,
    alpha: 0.3 + Math.random() * 0.5,
  };
}

// ── Game lifecycle ───────────────────────────────────────────
function startGame() {
  state = 'playing';
  poopProgress = 0;
  poopsLeft    = POOPS_TO_WIN;
  wetLevel     = 0;
  umbrella.x   = W / 2;
  umbrella.moving = 0;
  coco.x = W / 2;
  coco.vx = 0;
  coco.poopState  = 'wander';
  coco.actionTimer = 80;
  coco.wanderTarget = W / 2;
  coco.wetShake   = 0;
  coco.particles  = [];
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
    overlayMsg.textContent = 'びしょ濡れでうんちどころじゃない！\nおしっこ中に乾かしておこう！';
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

  // Coverage check
  const covered = Math.abs(coco.x - umbrella.x) < umbrella.width / 2 + 10;

  // Wet / dry
  if (covered) {
    const dryRate = coco.poopState === 'pee' ? DRY_RATE_PEE : DRY_RATE;
    wetLevel = Math.max(0, wetLevel - dryRate);
  } else {
    wetLevel = Math.min(1, wetLevel + WET_RATE);
  }

  // Poop progress only during squat
  if (coco.poopState === 'squat') {
    if (wetLevel < 0.6) {
      poopProgress = Math.min(1, poopProgress + POOP_RATE);
      if (poopProgress >= 1) {
        // One poop done!
        poopProgress = 0;
        poopsLeft--;
        coco.poopState = 'wander';
        coco.actionTimer = 60;
        // Confetti burst
        for (let i = 0; i < 8; i++) {
          coco.particles.push({
            emoji: '💩', x: coco.x, y: coco.y + 10,
            vy: -(2 + Math.random() * 3),
            vx: (Math.random() - 0.5) * 4,
            alpha: 1, size: 16 + Math.random() * 10,
          });
        }
        if (poopsLeft <= 0) { endGame(true); return; }
      }
    } else {
      // Too wet → abort
      coco.wetShake = 20;
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
    p.y  += p.vy;
    p.x  += p.vx || 0;
    p.vy += 0.15;
    p.alpha -= 0.018;
    if (p.alpha <= 0) coco.particles.splice(i, 1);
  }

  // UI
  poopBarEl.style.width = (poopProgress * 100) + '%';
  wetBarEl.style.width  = (wetLevel * 100) + '%';
}

function updateCoco() {
  coco.actionTimer--;

  if (coco.actionTimer <= 0) {
    if (coco.poopState === 'wander') {
      const r = Math.random();
      if (r < 0.35) {
        // おしっこタイム（乾かすチャンス）
        coco.poopState  = 'pee';
        coco.actionTimer = 120 + Math.random() * 100;
        coco.vx = 0;
      } else if (r < 0.75) {
        // うんちタイム
        coco.poopState  = 'squat';
        coco.actionTimer = 100 + Math.random() * 80;
        coco.vx = 0;
      } else {
        pickNewTarget();
      }
    } else {
      coco.poopState  = 'wander';
      pickNewTarget();
    }
  }

  if (coco.poopState === 'wander') {
    const dx = coco.wanderTarget - coco.x;
    coco.vx  = dx * 0.04;
    coco.x  += coco.vx;
    if (Math.abs(dx) < 5 && coco.actionTimer > 20) pickNewTarget();
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
  // Sky
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

  drawPuddles();
  drawRain();

  // Particles
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

  // Wet tint
  if (wetLevel > 0.3) {
    ctx.fillStyle = `rgba(100,180,255,${(wetLevel - 0.3) * 0.15})`;
    ctx.fillRect(0, 0, W, H);
  }

  // Status label above coco
  if (coco.poopState === 'squat') {
    drawLabel(coco.x, coco.y - 36, `💩 ${Math.floor(poopProgress * 100)}%`, '#DEB887');
  } else if (coco.poopState === 'pee') {
    drawLabel(coco.x, coco.y - 36, '💦 おしっこ中...', '#7ecfff');
    // Dry hint when wet and covered
    const covered = Math.abs(coco.x - umbrella.x) < umbrella.width / 2 + 10;
    if (wetLevel > 0.2 && covered) {
      drawLabel(coco.x, coco.y - 54, '☀ 乾かし中！', 'rgba(255,220,80,0.95)');
    } else if (wetLevel > 0.2) {
      drawLabel(coco.x, coco.y - 54, '⚠ 傘を持ってきて！', 'rgba(255,100,80,0.95)');
    }
  }

  // Poop counter top-center
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
  const ux = umbrella.x;
  const uy = umbrella.y;
  const ur = umbrella.width / 2;

  ctx.save();
  ctx.strokeStyle = 'rgba(174,214,241,0.6)';
  for (const d of drops) {
    // Skip drops horizontally under the umbrella canopy
    if (d.x > ux - ur && d.x < ux + ur && d.y > uy) continue;

    const alpha = d.alpha;
    ctx.strokeStyle = `rgba(174,214,241,${alpha})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(d.x, d.y);
    // Clip line endpoint if it enters the dry zone
    let ex = d.x - 2, ey = d.y + d.len;
    if (ex > ux - ur && ex < ux + ur && ey > uy) ey = uy;
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
  const r  = umbrella.width / 2;

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
  const facing    = coco.vx >= 0 ? 1 : -1;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(facing, 1);

  const bodyH = squatting ? 28 : 34;
  const bodyW = 54;
  const bodyY = squatting ? 6 : 0;

  ctx.fillStyle = '#c8a46e';
  ctx.beginPath();
  ctx.ellipse(0, bodyY, bodyW / 2, bodyH / 2, squatting ? 0.2 : 0, 0, Math.PI * 2);
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
    ctx.fillRect(-5,  legY, 10, 14);
    ctx.fillRect(8,   legY, 10, 14);
    ctx.fillStyle = '#c8a46e';
    ctx.beginPath();
    ctx.ellipse(-26, legY + 5, 14, 10, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (peeing) {
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

  ctx.strokeStyle = '#c8a46e';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-bodyW / 2 + 4, bodyY);
  ctx.quadraticCurveTo(
    -bodyW / 2 - 14, bodyY - (squatting ? 8 : 18),
    -bodyW / 2 - 6,  bodyY - (squatting ? 20 : 32)
  );
  ctx.stroke();

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
