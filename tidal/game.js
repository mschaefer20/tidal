/* Tidal — a one-button gravity game.
   Tap / Space flips which planet pulls the orb. Swing through the gaps,
   grab bonus orbs, don't hit a wall or a barrier.

   Core sim (update) is kept separate from rendering (draw) so the game
   logic can be reused inside a native shell (Capacitor / Tauri) later. */

(() => {
  "use strict";

  // Logical play-field size (drawing coordinates). CSS scales it to fit.
  const W = 420;
  const H = 640;

  // ---- Tunables ------------------------------------------------------------
  const ORB_R = 13;
  const WALL = ORB_R + 8;            // x-distance from edge = planet surface
  const GRAVITY = 1800;              // px/s^2 horizontal pull (higher = snappier flips)
  const MAX_VX = 560;                // clamp horizontal speed
  const ORB_Y = H * 0.70;            // orb stays at a fixed height

  const SCROLL_START = 150;          // px/s
  const SCROLL_MAX = 360;
  const SCROLL_ACCEL = 6;            // px/s added per second survived

  const BAR_TH = 18;                 // barrier thickness
  const GAP_START = 150;             // gap width at start
  const GAP_MIN = 96;
  const BAR_SPACING = 230;           // vertical distance between barriers

  // Score at which the world transforms into the 3D mode.
  // ⚠️ TEMP: lowered to 5 for testing — SET BACK TO 100 BEFORE PUBLIC RELEASE.
  const SHIFT_SCORE = 5;

  // Global pace. NORMAL is the shipped play speed (75% of the old baseline).
  // DEV_SLOW is a toggleable slow-motion for development/testing.
  const SPEED_NORMAL = 0.75;
  const SPEED_DEV = 0.20;

  // ---- 3D mode tunables ----------------------------------------------------
  const VP = { x: W / 2, y: ORB_Y - 30 };  // vanishing point of the tunnel
  const DSCALE = 0.62;               // depth -> perspective falloff
  const D_SPAWN = 13;                // depth a barrier appears at
  const DEPTH_SPACING = 4.2;         // depth gap between barriers
  const DEPTH_SPEED_START = 3.22;    // depth units/s toward camera (30% slower)
  const DEPTH_SPEED_MAX = 6.3;
  const DEPTH_ACCEL = 0.112;

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const canvas3d = document.getElementById("board3d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");
  const menuBtn = document.getElementById("menu-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const screens = {
    title: document.getElementById("screen-title"),
    howto: document.getElementById("screen-howto"),
    settings: document.getElementById("screen-settings"),
  };

  // ---- Settings (persisted) ------------------------------------------------
  const SETTINGS_KEY = "tidal-settings";
  const settings = Object.assign(
    { sound: true, music: true, haptics: true, reduceMotion: false },
    JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")
  );
  function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  function applySettings() {
    if (window.TidalFX) {
      TidalFX.setSound(settings.sound);
      TidalFX.setMusic(settings.music);
      TidalFX.setHaptics(settings.haptics);
    }
  }
  // tiny sound/haptic helpers that respect availability
  function sfx(name) { if (window.TidalFX) TidalFX.play(name); }
  function buzz(kind) { if (window.TidalFX) TidalFX.haptic(kind); }

  // Crisp rendering on high-DPI screens.
  function setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  setupHiDPI();
  window.addEventListener("resize", () => {
    setupHiDPI();
    if (use3DEngine && window.Tidal3D) {
      const r = canvas.getBoundingClientRect();
      window.Tidal3D.resize(Math.round(r.width) || W, Math.round(r.height) || H);
    }
    draw();
  });

  // ---- State ---------------------------------------------------------------
  let orb, gravSide, bars, bonuses, scroll, score, running, lastT, rafId, shake, paused;
  let mode, depthSpeed, flash, intro, travel;
  let use3DEngine = false;   // becomes true once the WebGL engine inits OK

  const BEST_KEY = "tidal-best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  // Dev: open with ?3d (or ?mode=3d) to start straight in the 3D mode,
  // and ?slow to boot in dev slow-motion.
  const params = new URLSearchParams(location.search);
  const DEV_START_3D = params.has("3d") || params.get("mode") === "3d";

  // Persists across runs (it's a setting, not part of a game).
  let timeScale = params.has("slow") ? SPEED_DEV : SPEED_NORMAL;

  function reset(startMode) {
    orb = { x: W / 2, vx: 0, trail: [] };
    gravSide = 1;            // +1 pulls right, -1 pulls left
    bars = [];
    bonuses = [];
    scroll = SCROLL_START;
    score = 0;
    shake = 0;
    flash = 0;
    travel = 0;
    paused = false;
    mode = startMode || (DEV_START_3D ? "3d" : "2d");
    intro = mode === "3d" ? 0 : 1;
    depthSpeed = DEPTH_SPEED_START;
    if (mode === "3d") { build3DField(); }
    else { hide3D(); for (let y = -40; y > -BAR_SPACING * 3; y -= BAR_SPACING) spawnBar(y); }
    scoreEl.textContent = score;
  }

  // Build a fresh set of barriers receding into the distance (3D mode).
  function build3DField() {
    bars = [];
    bonuses = [];
    for (let d = 5; d <= D_SPAWN; d += DEPTH_SPACING) spawnBar3D(d);
  }

  // Switch an in-progress 2D run into the 3D world.
  function enter3D() {
    mode = "3d";
    depthSpeed = DEPTH_SPEED_START;
    flash = settings.reduceMotion ? 0.25 : 1;
    intro = 0;
    travel = 0;
    build3DField();
    show3D();
    playShiftBanner();
    sfx("shift");
    buzz("medium");
  }

  function playShiftBanner() {
    const el = document.getElementById("shift-banner");
    if (!el) return;
    el.classList.remove("run");
    void el.offsetWidth;        // restart the CSS animation
    el.classList.add("run");
  }

  // ---- WebGL engine lifecycle (falls back to canvas if unavailable) -------
  function board3dSize() {
    const r = canvas.getBoundingClientRect();
    return { w: Math.round(r.width) || W, h: Math.round(r.height) || H };
  }

  function ensure3DEngine() {
    if (use3DEngine) return true;
    if (!window.Tidal3D) return false;
    try {
      canvas3d.style.display = "block";       // must be laid out before sizing
      const { w, h } = board3dSize();
      window.Tidal3D.init(canvas3d, w, h);
      use3DEngine = !!window.Tidal3D.ready;
    } catch (err) {
      console.warn("Tidal 3D engine failed — using canvas fallback.", err);
      use3DEngine = false;
    }
    return use3DEngine;
  }

  function show3D() {
    if (ensure3DEngine()) {
      canvas3d.style.display = "block";
      requestAnimationFrame(() => { canvas3d.style.opacity = "1"; });
    }
  }

  function hide3D() {
    canvas3d.style.opacity = "0";
    canvas3d.style.display = "none";
    if (use3DEngine && window.Tidal3D.reset) window.Tidal3D.reset();
  }

  // State snapshot handed to the WebGL renderer each frame.
  function build3DState() {
    const halfPlay = (W - 2 * WALL) / 2;
    const nx = (x) => (x - W / 2) / halfPlay;
    return {
      orbNX: Math.max(-1.2, Math.min(1.2, nx(orb.x))),
      gravSide,
      intro,
      travel,
      reduceMotion: settings.reduceMotion,
      bars: bars.filter((b) => b.d > -1.2).map((b) => ({
        d: b.d,
        cx: nx(b.gapX + b.gapW / 2),
        half: (b.gapW / 2) / halfPlay,
      })),
      bonuses: bonuses.filter((o) => !o.taken && o.d > -1).map((o) => ({ nx: nx(o.x), d: o.d })),
    };
  }

  function gapWidth() {
    const t = Math.min(1, score / 40);
    return GAP_START - (GAP_START - GAP_MIN) * t;
  }

  function randomGapX(gap) {
    return WALL + 10 + Math.random() * (W - 2 * WALL - 20 - gap);
  }

  function spawnBar(y) {
    const gap = gapWidth();
    const gapX = randomGapX(gap);
    bars.push({ y, gapX, gapW: gap, passed: false });
    // occasionally drop a bonus orb inside or near the gap
    if (Math.random() < 0.6) {
      const bx = gapX + Math.random() * gap;
      bonuses.push({ x: bx, y: y - BAR_SPACING / 2, taken: false });
    }
  }

  // Same barrier, positioned by depth instead of y (3D mode).
  function spawnBar3D(d) {
    const gap = gapWidth();
    const gapX = randomGapX(gap);
    bars.push({ d, gapX, gapW: gap, passed: false });
    if (Math.random() < 0.6) {
      const bx = gapX + Math.random() * gap;
      bonuses.push({ x: bx, d: d - DEPTH_SPACING / 2, taken: false });
    }
  }

  // ---- Simulation ----------------------------------------------------------
  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (mode === "3d") return update3D(dt);
    return update2D(dt);
  }

  // Shared horizontal pendulum physics. Returns false if the orb crashed
  // into a planet surface (so the caller can stop).
  function stepOrb(dt) {
    orb.vx += gravSide * GRAVITY * dt;
    orb.vx = Math.max(-MAX_VX, Math.min(MAX_VX, orb.vx));
    orb.x += orb.vx * dt;
    orb.trail.push(orb.x);
    if (orb.trail.length > 14) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    return !(orb.x <= WALL || orb.x >= W - WALL);
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = score;
    if (mode === "2d" && score >= SHIFT_SCORE) enter3D();
  }

  function inGap(b) {
    return orb.x > b.gapX + ORB_R * 0.5 && orb.x < b.gapX + b.gapW - ORB_R * 0.5;
  }

  function update2D(dt) {
    // ramp difficulty
    scroll = Math.min(SCROLL_MAX, scroll + SCROLL_ACCEL * dt);

    if (!stepOrb(dt)) return die();

    // scroll world
    const dy = scroll * dt;
    for (const b of bars) b.y += dy;
    for (const o of bonuses) o.y += dy;

    // recycle barriers + spawn new ones to keep the field full
    bars = bars.filter((b) => b.y < H + 40);
    bonuses = bonuses.filter((o) => o.y < H + 40 && !o.taken);
    while (bars.length === 0 || bars[bars.length - 1].y > -BAR_SPACING) {
      const topY = bars.length ? bars[bars.length - 1].y : -40;
      spawnBar(topY - BAR_SPACING);
    }

    // scoring + collisions vs barriers
    for (const b of bars) {
      if (!b.passed && b.y > ORB_Y) {
        b.passed = true;
        addScore(1);
        if (mode === "3d") return;   // mode changed mid-loop; bail
      }
      // collision band
      if (b.y + BAR_TH >= ORB_Y - ORB_R && b.y <= ORB_Y + ORB_R) {
        if (!inGap(b)) return die();
      }
    }

    // bonus pickups
    for (const o of bonuses) {
      if (o.taken) continue;
      const dx = o.x - orb.x, dyo = o.y - ORB_Y;
      if (dx * dx + dyo * dyo < (ORB_R + 9) * (ORB_R + 9)) {
        o.taken = true;
        addScore(5);
        sfx("coin"); buzz("light");
      }
    }
  }

  // ---- 3D simulation -------------------------------------------------------
  function update3D(dt) {
    depthSpeed = Math.min(DEPTH_SPEED_MAX, depthSpeed + DEPTH_ACCEL * dt);

    // Hold the orb dead-center for the first ~1s of the 3D intro, then release
    // it to gravity — a beat to orient before it starts drifting.
    if (intro < 0.25) {
      orb.x = W / 2;
      orb.vx = 0;
      orb.trail.push(orb.x);
      if (orb.trail.length > 14) orb.trail.shift();
    } else if (!stepOrb(dt)) {
      return die();
    }

    // Ease the tunnel into motion during the lead-in: nearly still at first,
    // ramping to full speed as the camera settles (intro 0→1).
    const ease = Math.min(1, intro);
    const dd = depthSpeed * dt * ease;
    travel += dd;                 // drives the tunnel scroll in the WebGL view
    for (const b of bars) b.d -= dd;
    for (const o of bonuses) o.d -= dd;

    // collisions / scoring as barriers reach the camera plane (d crossing 0)
    for (const b of bars) {
      if (!b.passed && b.d <= 0) {
        b.passed = true;
        if (!inGap(b)) return die();
        addScore(1);
      }
    }

    // bonus pickups near the camera plane
    for (const o of bonuses) {
      if (o.taken) continue;
      if (o.d <= 0.5 && o.d > -0.5 && Math.abs(o.x - orb.x) < ORB_R + 12) {
        o.taken = true;
        addScore(5);
        sfx("coin"); buzz("light");
      }
    }

    // recycle + keep the tunnel populated
    bars = bars.filter((b) => b.d > -1);
    bonuses = bonuses.filter((o) => o.d > -1 && !o.taken);
    let maxD = bars.length ? Math.max(...bars.map((b) => b.d)) : 0;
    while (maxD < D_SPAWN) {
      maxD += DEPTH_SPACING;
      spawnBar3D(maxD);
    }
  }

  // ---- Rendering -----------------------------------------------------------
  function draw() {
    const engine3D = mode === "3d" && use3DEngine;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    if (mode === "3d") {
      if (engine3D) drawWarpUnderlay();   // speed-lines behind the fading WebGL layer
      else draw3D();                       // canvas fallback
    } else {
      draw2D();
    }
    ctx.restore();

    // Render the real 3D frame (on the overlay canvas).
    if (engine3D && window.Tidal3D) window.Tidal3D.render(build3DState());

    // transition / pickup flash
    if (flash > 0) {
      ctx.globalAlpha = flash * 0.6;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // dev slow-motion indicator
    if (timeScale === SPEED_DEV) {
      ctx.fillStyle = "#ffd84d";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("DEV · 20% speed", 12, 22);
    }
  }

  function draw2D() {
    drawPlanets();

    // barriers
    for (const b of bars) {
      drawBar(b);
    }

    // bonus orbs
    for (const o of bonuses) {
      if (o.taken) continue;
      glowCircle(o.x, o.y, 7, "#ffd84d");
    }

    // orb trail
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.4;
      glowCircle(orb.trail[i], ORB_Y, ORB_R * (0.4 + a * 0.5), gravSide > 0 ? "#4dd2ff" : "#ff5e7e");
    }
    ctx.globalAlpha = 1;

    // orb (color shows which way it's being pulled)
    glowCircle(orb.x, ORB_Y, ORB_R, gravSide > 0 ? "#4dd2ff" : "#ff5e7e", true);
  }

  // Radial speed-lines drawn on the 2D canvas during the 2D→3D fade, so the
  // moment the WebGL layer crossfades in it reads as a warp jump.
  function drawWarpUnderlay() {
    if (settings.reduceMotion) return;
    const a = 1 - intro;                 // strongest at the start of the shift
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "#bcd2ff";
    ctx.lineWidth = 2;
    const cx = W / 2, cy = ORB_Y;
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      const r0 = 30 + (1 - a) * 200;
      const r1 = r0 + 120 * a + 40;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- 3D rendering: a tunnel rushing toward the camera --------------------
  function proj(x, y, d) {
    const s = 1 / (1 + Math.max(0, d) * DSCALE);
    return { x: VP.x + (x - VP.x) * s, y: VP.y + (y - VP.y) * s, s };
  }

  function draw3D() {
    // tunnel side walls converging to the vanishing point (gravity planets)
    tunnelWall(0, "#ff5e7e", gravSide < 0);          // left = pink
    tunnelWall(W, "#4dd2ff", gravSide > 0);          // right = cyan

    // depth grid lines for a sense of speed
    ctx.strokeStyle = "rgba(120,130,210,0.12)";
    ctx.lineWidth = 1;
    for (let d = 0; d <= D_SPAWN; d += 1) {
      const a = proj(0, 0, d), b = proj(W, H, d);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }

    // barriers: far first so nearer ones overlap
    const ordered = bars.slice().sort((p, q) => q.d - p.d);
    for (const b of ordered) drawBar3D(b);

    // bonus orbs
    for (const o of bonuses) {
      if (o.taken || o.d < -0.5) continue;
      const p = proj(o.x, ORB_Y, o.d);
      glowCircle(p.x, p.y, Math.max(2, 9 * p.s), "#ffd84d");
    }

    // orb (always at the camera plane)
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.35;
      glowCircle(orb.trail[i], ORB_Y, ORB_R * (0.4 + a * 0.5), gravSide > 0 ? "#4dd2ff" : "#ff5e7e");
    }
    ctx.globalAlpha = 1;
    glowCircle(orb.x, ORB_Y, ORB_R, gravSide > 0 ? "#4dd2ff" : "#ff5e7e", true);
  }

  function tunnelWall(edgeX, color, active) {
    const g = ctx.createLinearGradient(edgeX, 0, VP.x, VP.y);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(5,6,15,0)");
    ctx.globalAlpha = active ? 0.5 : 0.18;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(edgeX, 0);
    ctx.lineTo(edgeX, H);
    ctx.lineTo(VP.x, VP.y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawBar3D(b) {
    if (b.d < -0.5) return;
    const s = 1 / (1 + Math.max(0, b.d) * DSCALE);
    const X = (wx) => VP.x + (wx - VP.x) * s;
    const Y = (wy) => VP.y + (wy - VP.y) * s;
    const top = Y(0), bot = Y(H), h = bot - top;
    // closer barriers are brighter
    const lum = Math.round(58 + 120 * s);
    ctx.fillStyle = `rgb(${lum},${lum + 6},${Math.min(255, lum + 70)})`;
    ctx.shadowBlur = 10 * s;
    ctx.shadowColor = "#5a63c0";
    const lx = X(WALL), gl = X(b.gapX), gr = X(b.gapX + b.gapW), rx = X(W - WALL);
    if (gl - lx > 0.5) { rr(lx, top, gl - lx, h, 5 * s); ctx.fill(); }
    if (rx - gr > 0.5) { rr(gr, top, rx - gr, h, 5 * s); ctx.fill(); }
    ctx.shadowBlur = 0;
  }

  function drawPlanets() {
    // Left planet (pink) and right planet (cyan) anchored off the edges.
    const pr = 150;
    planet(-pr + WALL - 2, H / 2, pr, "#ff5e7e", gravSide < 0);
    planet(W + pr - WALL + 2, H / 2, pr, "#4dd2ff", gravSide > 0);
  }

  function planet(cx, cy, r, color, active) {
    const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(5,6,15,0.1)");
    ctx.globalAlpha = active ? 0.95 : 0.4;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawBar(b) {
    ctx.fillStyle = "#3a4080";
    ctx.shadowBlur = 8;
    ctx.shadowColor = "#5a63c0";
    // left segment
    rr(WALL, b.y, b.gapX - WALL, BAR_TH, 6); ctx.fill();
    // right segment
    rr(b.gapX + b.gapW, b.y, W - WALL - (b.gapX + b.gapW), BAR_TH, 6); ctx.fill();
    ctx.shadowBlur = 0;
  }

  function glowCircle(x, y, r, color, strong) {
    ctx.fillStyle = color;
    ctx.shadowBlur = strong ? 22 : 12;
    ctx.shadowColor = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function rr(x, y, w, h, r) {
    if (w <= 0) { ctx.beginPath(); return; }
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---- Loop ----------------------------------------------------------------
  function loop(now) {
    if (!running) return;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.05) dt = 0.05;     // clamp after tab-switch / hitch
    // transition fly-in runs on real time (independent of slow-mo)
    if (mode === "3d" && intro < 1) intro = Math.min(1, intro + dt / 4.0);
    update(dt * timeScale);       // global pace multiplier
    if (running) draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    reset();
    resume();
    sfx("start");
  }

  function resume() {
    running = true;
    paused = false;
    lastT = performance.now();
    hideScreens();
    overlay.classList.add("hidden");
    pauseBtn.classList.add("show");
    if (mode === "3d") show3D(); else hide3D();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  // Either resume a paused game or start a fresh one.
  function primaryAction() {
    if (paused) resume(); else start();
  }

  function pauseGame() {
    if (!running) return;
    running = false;
    paused = true;
    cancelAnimationFrame(rafId);
    pauseBtn.classList.remove("show");
    overlayTitle.textContent = "Paused";
    overlayText.textContent = "";
    startBtn.textContent = "Resume";
    overlay.classList.remove("hidden");
  }

  function die() {
    running = false;
    shake = settings.reduceMotion ? 4 : 10;
    draw();
    cancelAnimationFrame(rafId);
    pauseBtn.classList.remove("show");
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = best;
    }
    if (window.TidalGC) TidalGC.submit(score);   // post to Game Center leaderboard
    overlayTitle.textContent = "Game Over";
    overlayText.textContent = `Score ${score}${score >= best && score > 0 ? " — new best!" : ""}`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("hidden");
    sfx("crash");
    buzz("heavy");
  }

  // ---- Menu / screen management -------------------------------------------
  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle("hidden", k !== name);
  }
  function hideScreens() { for (const k in screens) screens[k].classList.add("hidden"); }

  function goMenu() {
    running = false;
    paused = false;
    cancelAnimationFrame(rafId);
    pauseBtn.classList.remove("show");
    overlay.classList.add("hidden");
    hide3D();
    reset();
    draw();
    showScreen("title");
  }

  function refreshToggles() {
    document.querySelectorAll(".toggle").forEach((t) => {
      t.classList.toggle("on", !!settings[t.dataset.setting]);
    });
  }

  // ---- Input ---------------------------------------------------------------
  function flip() {
    if (!running) return;
    gravSide *= -1;
    // Shed some momentum on flip so the reversal registers immediately,
    // making the back-and-forth feel reactive rather than floaty.
    orb.vx *= 0.55;
    sfx("flip");
    buzz("light");
  }

  function onPress(e) {
    e.preventDefault();
    if (running) flip();     // taps only steer in-game; menus use buttons
  }

  // First user gesture unlocks audio (iOS autoplay policy).
  let audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    if (window.TidalFX) { TidalFX.unlock(); applySettings(); }
  }
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  // Lock the page: stop the WebView from scrolling/panning on swipes.
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });

  canvas.addEventListener("pointerdown", onPress);
  startBtn.addEventListener("click", (e) => { e.stopPropagation(); primaryAction(); });
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); goMenu(); });
  pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); pauseGame(); });

  // Title / How-to / Settings navigation
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = b.dataset.action;
      if (a === "play") start();
      else if (a === "howto") showScreen("howto");
      else if (a === "settings") { refreshToggles(); showScreen("settings"); }
      else if (a === "back") showScreen("title");
      else if (a === "leaderboard") { if (window.TidalGC) TidalGC.show(); }
    });
  });

  // Leaderboard button on the game-over / pause overlay
  const lbOver = document.getElementById("lb-over");
  if (lbOver) lbOver.addEventListener("click", (e) => { e.stopPropagation(); if (window.TidalGC) TidalGC.show(); });

  // Reveal leaderboard buttons only where Game Center exists (the native app)
  if (window.TidalGC && TidalGC.available()) {
    const lbTitle = document.getElementById("lb-title");
    if (lbTitle) lbTitle.hidden = false;
    if (lbOver) lbOver.hidden = false;
  }

  // Hidden dev shortcut: tap the title logo 5× quickly to jump straight to 3D.
  (() => {
    const logo = document.getElementById("title-logo");
    if (!logo) return;
    let taps = 0, last = 0;
    logo.addEventListener("click", () => {
      const now = performance.now();
      taps = now - last < 800 ? taps + 1 : 1;
      last = now;
      if (taps >= 5) { taps = 0; reset("3d"); resume(); }
    });
  })();

  // Settings toggles
  document.querySelectorAll(".toggle").forEach((t) => {
    t.addEventListener("click", () => {
      const key = t.dataset.setting;
      settings[key] = !settings[key];
      saveSettings();
      applySettings();
      refreshToggles();
      buzz("light");
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "ArrowUp" || e.key === "Enter") {
      e.preventDefault();
      if (running) flip();
      else if (!overlay.classList.contains("hidden")) primaryAction(); // resume / restart
    }
    if ((e.key === "Escape" || e.key === "p" || e.key === "P") && running) pauseGame();
    // Dev preview: press "3" to jump straight into the 3D mode.
    if (e.key === "3") {
      if (!running) { reset("3d"); resume(); }
      else if (mode === "2d") enter3D();
    }
    // Dev: press "0" to toggle slow-motion (20% speed).
    if (e.key === "0") {
      timeScale = timeScale === SPEED_DEV ? SPEED_NORMAL : SPEED_DEV;
      if (!running) draw();
    }
  });

  // pause (don't kill) if the app is backgrounded
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) pauseGame();
  });

  // First paint — start on the title screen
  applySettings();
  refreshToggles();
  reset();
  draw();
  showScreen("title");

  // ---- PWA registration ----------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
