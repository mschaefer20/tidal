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

  // ---- Orbital progression -------------------------------------------------
  // Five "Orbitals" the player ascends as the score climbs. Each has a form
  // (2d / 3d), its own music track, and (being built out) its own gameplay.
  //   1: 2D pendulum (the original)      2: 3D tunnel
  //   3: 2D multi-gravity expansion      4: 3D expansion
  //   5: black-hole boss (finale)
  const FAST_ORBITALS = true;   // DEV: compress thresholds for quick testing (false for release)
  const ORBITALS = [
    { n: 1, dim: "2d", threshold: 0 },
    { n: 2, dim: "3d", threshold: FAST_ORBITALS ? 5 : 100 },
    { n: 3, dim: "2d", threshold: FAST_ORBITALS ? 10 : 250 },
    { n: 4, dim: "3d", threshold: FAST_ORBITALS ? 15 : 450 },
    { n: 5, dim: "2d", threshold: FAST_ORBITALS ? 20 : 700 },  // black-hole survival arena
  ];
  const ORBITAL_LABEL = ["", "ORBITAL I", "ORBITAL II", "ORBITAL III", "ORBITAL IV", "ORBITAL V"];

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

  // Orbital 4 "Drift": gaps slide horizontally as barriers approach, + faster.
  const GAP_DRIFT_AMP = 70;          // how far a gap slides from its base
  const GAP_DRIFT_FREQ = 0.55;       // slide speed (vs world travel)
  const O4_SPEED_MULT = 1.25;        // extra tunnel speed at orbital 4

  // ---- Orbital 5 "Event Horizon": top-down survival arena around a black hole
  const ARENA = { x: W / 2, y: H * 0.46, rEvent: 30, rArena: 196 };
  const ARENA_G = 1000;              // radial accel (a tap flips attract <-> repel)
  const ARENA_MAXV = 470;            // 2D speed cap
  const DEBRIS_FIRST = 2.5;          // delay before the first debris (arena starts empty)
  const DEBRIS_SPEED0 = 50;          // initial inward speed of falling debris
  const DEBRIS_GRAV = 85;            // inward acceleration (pulled toward the hole)
  const SURGE_EVERY = 6;             // seconds between gravity-surge attacks
  const SURGE_CHARGE = 0.8;          // telegraph time before a surge
  const SURGE_ACTIVE = 1.4;          // surge duration
  const SURGE_MULT = 1.9;            // gravity multiplier during a surge
  const TAU = Math.PI * 2;

  // ---- Orbital 3 "Binary" tunables (2D multi-gravity) ----------------------
  // Two planets offset diagonally so the pull is 2D: left tugs up-left,
  // right tugs down-right → curved, two-axis motion. Top/bottom are deadly.
  const G3_LEFT = { x: -0.10 * W, y: H * 0.5 };   // both centered → equal vertical range
  const G3_RIGHT = { x: 1.10 * W, y: H * 0.5 };
  const GRAVITY3 = 1650;             // directional accel toward the active planet
  const MAXV3 = 520;                 // 2D speed cap
  const Y_WALL = ORB_R + 8;          // deadly top/bottom margin
  const G3_AMP = 185;                // planet vertical sway amplitude (equal both sides)
  // Three incommensurate frequencies → wandering, non-repeating oscillation.
  const G3_FREQ = 1.2;
  const G3_FREQ2 = 0.73;
  const G3_FREQ3 = 0.31;

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
  let mode, depthSpeed, flash, intro, travel, orbital;
  let g3Time, gpL, gpR;   // Orbital 3: oscillation clock + live planet positions
  let arenaTime, scoreClock, debris, coins, surge, nextSurge, nextDebris;   // Orbital 5 arena
  let use3DEngine = false;   // becomes true once the WebGL engine inits OK

  const BEST_KEY = "tidal-best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  // Dev: open with ?3d (or ?mode=3d) to start straight in the 3D mode,
  // and ?slow to boot in dev slow-motion.
  const params = new URLSearchParams(location.search);
  const DEV_START_3D = params.has("3d") || params.get("mode") === "3d";
  // Dev shortcut: ?orbital=N (1-5) boots every run straight into that Orbital.
  const DEV_START_ORBITAL = Math.max(0, Math.min(5, Number(params.get("orbital")) || 0));

  // Persists across runs (it's a setting, not part of a game).
  let timeScale = params.has("slow") ? SPEED_DEV : SPEED_NORMAL;

  function reset(startMode) {
    orb = { x: W / 2, vx: 0, y: ORB_Y, vy: 0, trail: [] };
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
    orbital = mode === "3d" ? 2 : 1;
    intro = mode === "3d" ? 0 : 1;
    depthSpeed = DEPTH_SPEED_START;
    g3Time = 0;
    gpL = { x: G3_LEFT.x, y: G3_LEFT.y };
    gpR = { x: G3_RIGHT.x, y: G3_RIGHT.y };
    arenaTime = 0; scoreClock = 0; surge = null; nextSurge = SURGE_EVERY;
    nextDebris = DEBRIS_FIRST; debris = []; coins = [];
    if (mode === "3d") build3DField(); else { hide3D(); build2DField(); }
    if (window.TidalFX) TidalFX.setOrbital(orbital);
    scoreEl.textContent = score;
  }

  // Build a fresh set of scrolling barriers above the screen (2D forms).
  function build2DField() {
    bars = [];
    bonuses = [];
    for (let y = -40; y > -BAR_SPACING * 3; y -= BAR_SPACING) spawnBar(y);
  }

  // Build a fresh set of barriers receding into the distance (3D forms).
  function build3DField() {
    bars = [];
    bonuses = [];
    for (let d = 7; d <= D_SPAWN; d += DEPTH_SPACING) spawnBar3D(d);
  }

  // Advance into a new Orbital mid-run: swap form, music, field, and play the
  // transition. Works for any 2D⇄3D combination.
  function enterOrbital(n) {
    orbital = n;
    mode = ORBITALS[n - 1].dim;
    flash = settings.reduceMotion ? 0.25 : 1;
    // clean, centered start for the new orbital
    orb.x = W / 2;
    orb.y = n === 3 ? H / 2 : ORB_Y;
    orb.vx = 0;
    orb.vy = 0;
    if (n === 3) g3Time = 0;
    if (mode === "3d") {
      depthSpeed = DEPTH_SPEED_START;
      intro = 0;
      travel = 0;
      build3DField();
      show3D();
    } else {
      intro = 1;
      hide3D();
      if (n === 5) buildArena(); else build2DField();
    }
    if (window.TidalFX) TidalFX.setOrbital(n);
    playShiftBanner(n);
    sfx("shift");
    buzz("medium");
  }

  function playShiftBanner(n) {
    const el = document.getElementById("shift-banner");
    if (!el) return;
    const big = el.querySelector(".big");
    const small = el.querySelector(".small");
    if (big) big.textContent = ORBITAL_LABEL[n] || "ORBITAL";
    if (small) small.textContent = ORBITALS[n - 1].dim === "3d" ? "3D" : "2D";
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
      orbital,
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
    let baseX;
    if (orbital >= 4) {
      // keep the gap's full oscillation within the walls (always passable)
      const lo = WALL + 10 + GAP_DRIFT_AMP;
      const hi = W - WALL - 10 - gap - GAP_DRIFT_AMP;
      baseX = lo + Math.random() * Math.max(0, hi - lo);
    } else {
      baseX = randomGapX(gap);
    }
    bars.push({ d, gapX: baseX, baseX, phase: Math.random() * Math.PI * 2, gapW: gap, passed: false });
    if (Math.random() < 0.6) {
      const bx = baseX + Math.random() * gap;
      bonuses.push({ x: bx, d: d - DEPTH_SPACING / 2, taken: false });
    }
  }

  // ---- Simulation ----------------------------------------------------------
  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (mode === "3d") return update3D(dt);
    if (orbital === 5) return updateArena(dt);
    if (orbital === 3) return updateBinary(dt);
    return update2D(dt);
  }

  // ---- Orbital 3 "Binary": 2D gravity toward the active planet -------------
  function updateBinary(dt) {
    const fromOrbital = orbital;
    scroll = Math.min(SCROLL_MAX, scroll + SCROLL_ACCEL * dt);

    // oscillate both planets over the same vertical range, but with a layered,
    // non-repeating wander (and different phase per side, so they're independent)
    g3Time += dt;
    const t = g3Time;
    const sway = (ph) => G3_AMP * (
      0.5 * Math.sin(t * G3_FREQ + ph) +
      0.3 * Math.sin(t * G3_FREQ2 + ph * 1.7) +
      0.2 * Math.sin(t * G3_FREQ3 + ph * 0.6)
    );
    gpL.y = G3_LEFT.y + sway(0);
    gpR.y = G3_RIGHT.y + sway(2.4);

    // accelerate toward the active planet (a 2D direction → curved motion)
    const tp = gravSide > 0 ? gpR : gpL;
    const dx = tp.x - orb.x, dy = tp.y - orb.y;
    const len = Math.hypot(dx, dy) || 1;
    orb.vx += (dx / len) * GRAVITY3 * dt;
    orb.vy += (dy / len) * GRAVITY3 * dt;
    orb.vx = Math.max(-MAXV3, Math.min(MAXV3, orb.vx));
    orb.vy = Math.max(-MAXV3, Math.min(MAXV3, orb.vy));
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;

    orb.trail.push({ x: orb.x, y: orb.y });
    if (orb.trail.length > 18) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    // deadly: planet surfaces (sides) and top/bottom edges
    if (orb.x <= WALL || orb.x >= W - WALL) return die();
    if (orb.y <= Y_WALL || orb.y >= H - Y_WALL) return die();

    // scroll + recycle barriers (same field as Orbital 1)
    const dys = scroll * dt;
    for (const b of bars) b.y += dys;
    for (const o of bonuses) o.y += dys;
    bars = bars.filter((b) => b.y < H + 40);
    bonuses = bonuses.filter((o) => o.y < H + 40 && !o.taken);
    while (bars.length === 0 || bars[bars.length - 1].y > -BAR_SPACING) {
      const topY = bars.length ? bars[bars.length - 1].y : -40;
      spawnBar(topY - BAR_SPACING);
    }

    // scoring + collisions (against the orb's live y)
    for (const b of bars) {
      if (!b.passed && b.y > orb.y) {
        b.passed = true;
        addScore(1);
        if (orbital !== fromOrbital) return;
      }
      if (b.y + BAR_TH >= orb.y - ORB_R && b.y <= orb.y + ORB_R) {
        if (!inGap(b)) return die();
      }
    }

    // coins
    for (const o of bonuses) {
      if (o.taken) continue;
      const cx = o.x - orb.x, cy = o.y - orb.y;
      if (cx * cx + cy * cy < (ORB_R + 9) * (ORB_R + 9)) {
        o.taken = true;
        addScore(5);
        sfx("coin"); buzz("light");
      }
    }
  }

  // Shared horizontal pendulum physics. Returns false if the orb crashed
  // into a planet surface (so the caller can stop).
  function stepOrb(dt) {
    orb.vx += gravSide * GRAVITY * dt;
    orb.vx = Math.max(-MAX_VX, Math.min(MAX_VX, orb.vx));
    orb.x += orb.vx * dt;
    orb.trail.push({ x: orb.x, y: orb.y });
    if (orb.trail.length > 14) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    return !(orb.x <= WALL || orb.x >= W - WALL);
  }

  function addScore(n) {
    score += n;
    scoreEl.textContent = score;
    // advance to the next Orbital once its score threshold is reached
    const next = ORBITALS[orbital]; // orbital is 1-based → this is the next one
    if (next && score >= next.threshold) enterOrbital(next.n);
  }

  function inGap(b) {
    return orb.x > b.gapX + ORB_R * 0.5 && orb.x < b.gapX + b.gapW - ORB_R * 0.5;
  }

  function update2D(dt) {
    const fromOrbital = orbital;
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
        if (orbital !== fromOrbital) return;   // advanced orbital mid-loop; bail
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

  // ---- Orbital 5 "Event Horizon": survival arena ---------------------------
  function spawnDebris() {
    debris.push({
      ang: Math.random() * TAU,
      r: ARENA.rArena - 4,                 // spawns at the rim
      vr: -DEBRIS_SPEED0,                  // falling inward
      vAng: (Math.random() - 0.5) * 0.5,   // slight sideways drift
      size: 9 + Math.random() * 7,
    });
  }
  function spawnCoin(c) {
    const o = c || {};
    o.ang = Math.random() * TAU;
    o.r = 70 + Math.random() * 105;
    o.spd = (Math.random() < 0.5 ? -1 : 1) * 0.6;
    o.taken = false;
    o.respawn = 0;
    if (!c) coins.push(o);
  }
  function buildArena() {
    arenaTime = 0; scoreClock = 0; surge = null; nextSurge = SURGE_EVERY;
    nextDebris = DEBRIS_FIRST;    // starts empty; debris arrives gradually
    orb.x = ARENA.x; orb.y = ARENA.y - 115;
    orb.vx = 340; orb.vy = 0;     // ~circular orbit velocity: sqrt(ARENA_G * r)
    orb.trail = [];
    gravSide = 1;                 // start by attracting
    debris = [];
    coins = []; for (let i = 0; i < 3; i++) spawnCoin();
  }

  function updateArena(dt) {
    const fromOrbital = orbital;
    arenaTime += dt;

    // boss attack: scheduled gravity surges (telegraphed, then strong inward pull)
    nextSurge -= dt;
    if (!surge && nextSurge <= 0) surge = { phase: "charge", t: SURGE_CHARGE };
    let gMult = 1;
    if (surge) {
      surge.t -= dt;
      if (surge.phase === "charge") {
        if (surge.t <= 0) { surge.phase = "active"; surge.t = SURGE_ACTIVE; }
      } else {
        gMult = SURGE_MULT;
        if (surge.t <= 0) { surge = null; nextSurge = Math.max(3.5, SURGE_EVERY - arenaTime * 0.04); }
      }
    }

    // radial attract / repel toward the black hole
    const dx = orb.x - ARENA.x, dy = orb.y - ARENA.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;        // outward unit vector
    const sign = gravSide > 0 ? -1 : 1;          // attract = inward
    const g = ARENA_G * gMult;
    orb.vx += ux * g * sign * dt;
    orb.vy += uy * g * sign * dt;
    const sp = Math.hypot(orb.vx, orb.vy);
    if (sp > ARENA_MAXV) { orb.vx *= ARENA_MAXV / sp; orb.vy *= ARENA_MAXV / sp; }
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;

    orb.trail.push({ x: orb.x, y: orb.y });
    if (orb.trail.length > 22) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    // death: consumed by the hole, or flung out of the arena
    const r = Math.hypot(orb.x - ARENA.x, orb.y - ARENA.y);
    if (r <= ARENA.rEvent + ORB_R * 0.3 || r >= ARENA.rArena) return die();

    // debris falls inward from the rim — spawns gradually, faster over time
    nextDebris -= dt;
    if (nextDebris <= 0) {
      spawnDebris();
      nextDebris = Math.max(0.55, 2.4 - arenaTime * 0.05);
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.vr -= DEBRIS_GRAV * gMult * dt;     // accelerates toward the hole (harder mid-surge)
      d.r += d.vr * dt;
      d.ang += d.vAng * dt;
      if (d.r <= ARENA.rEvent) { debris.splice(i, 1); continue; }   // consumed by the hole
      const ex = ARENA.x + Math.cos(d.ang) * d.r, ey = ARENA.y + Math.sin(d.ang) * d.r;
      const a = ex - orb.x, b = ey - orb.y;
      if (a * a + b * b < (ORB_R + d.size) * (ORB_R + d.size)) return die();
    }

    // orbiting coins (respawn after being collected)
    for (const c of coins) {
      c.ang += c.spd * dt;
      if (c.taken) { c.respawn -= dt; if (c.respawn <= 0) spawnCoin(c); continue; }
      const ex = ARENA.x + Math.cos(c.ang) * c.r, ey = ARENA.y + Math.sin(c.ang) * c.r;
      const a = ex - orb.x, b = ey - orb.y;
      if (a * a + b * b < (ORB_R + 8) * (ORB_R + 8)) {
        c.taken = true; c.respawn = 2.5;
        addScore(5); sfx("coin"); buzz("light");
        if (orbital !== fromOrbital) return;
      }
    }

    // survival scoring
    scoreClock += dt;
    while (scoreClock >= 0.5) {
      scoreClock -= 0.5;
      addScore(1);
      if (orbital !== fromOrbital) return;
    }
  }

  // ---- 3D simulation -------------------------------------------------------
  function update3D(dt) {
    const fromOrbital = orbital;
    const speedCap = DEPTH_SPEED_MAX * (orbital >= 4 ? O4_SPEED_MULT : 1);
    depthSpeed = Math.min(speedCap, depthSpeed + DEPTH_ACCEL * dt);

    // Hold the orb dead-center for the first ~2.4s of the 3D intro, then release
    // it to gravity — a clear beat to see it before it starts drifting.
    if (intro < 0.6) {
      orb.x = W / 2;
      orb.vx = 0;
      orb.trail.push({ x: orb.x, y: orb.y });
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

    // Orbitals 4+: slide each barrier's gap horizontally as it approaches
    if (orbital >= 4) {
      for (const b of bars) {
        b.gapX = b.baseX + GAP_DRIFT_AMP * Math.sin(travel * GAP_DRIFT_FREQ + b.phase);
      }
    }

    // collisions / scoring as barriers reach the camera plane (d crossing 0)
    for (const b of bars) {
      if (!b.passed && b.d <= 0) {
        b.passed = true;
        if (!inGap(b)) return die();
        addScore(1);
        if (orbital !== fromOrbital) return;   // advanced orbital mid-loop; bail
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
    } else if (orbital === 5) {
      drawArena();
    } else if (orbital === 3) {
      drawBinary();
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
      glowCircle(orb.trail[i].x, orb.trail[i].y, ORB_R * (0.4 + a * 0.5), gravSide > 0 ? "#4dd2ff" : "#ff5e7e");
    }
    ctx.globalAlpha = 1;

    // orb (color shows which way it's being pulled)
    glowCircle(orb.x, orb.y, ORB_R, gravSide > 0 ? "#4dd2ff" : "#ff5e7e", true);
  }

  // ---- Orbital 3 rendering -------------------------------------------------
  function drawBinary() {
    // deadly top/bottom danger zones
    ctx.fillStyle = "rgba(255,60,90,0.12)";
    ctx.fillRect(0, 0, W, Y_WALL);
    ctx.fillRect(0, H - Y_WALL, W, Y_WALL);

    // the two offset gravity planets (active one brighter), live oscillating y
    planet(gpL.x, gpL.y, 150, "#ff5e7e", gravSide < 0);
    planet(gpR.x, gpR.y, 150, "#4dd2ff", gravSide > 0);

    // pull line toward the active planet (makes the force readable)
    const tp = gravSide > 0 ? gpR : gpL;
    ctx.strokeStyle = gravSide > 0 ? "rgba(77,210,255,0.28)" : "rgba(255,94,126,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(orb.x, orb.y); ctx.lineTo(tp.x, tp.y); ctx.stroke();

    // barriers
    for (const b of bars) drawBar(b);

    // coins
    for (const o of bonuses) {
      if (o.taken) continue;
      glowCircle(o.x, o.y, 7, "#ffd84d");
    }

    // orb trail (curved) + orb
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.4;
      glowCircle(orb.trail[i].x, orb.trail[i].y, ORB_R * (0.4 + a * 0.5), gravSide > 0 ? "#4dd2ff" : "#ff5e7e");
    }
    ctx.globalAlpha = 1;
    glowCircle(orb.x, orb.y, ORB_R, gravSide > 0 ? "#4dd2ff" : "#ff5e7e", true);
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

  // ---- Orbital 5 rendering: the black-hole arena ---------------------------
  function drawArena() {
    const cx = ARENA.x, cy = ARENA.y;
    const charging = surge && surge.phase === "charge";
    const active = surge && surge.phase === "active";

    // arena boundary (deadly outer edge)
    ctx.strokeStyle = "rgba(255,80,90,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rArena, 0, TAU); ctx.stroke();

    // accretion glow (brightens while a surge charges / fires)
    const glowR = ARENA.rEvent * (active ? 3.6 : charging ? 2.6 + Math.sin(arenaTime * 22) * 0.5 : 2.2);
    const grd = ctx.createRadialGradient(cx, cy, ARENA.rEvent * 0.5, cx, cy, glowR);
    grd.addColorStop(0, active ? "rgba(255,120,40,0.95)" : "rgba(255,140,60,0.7)");
    grd.addColorStop(1, "rgba(255,80,30,0)");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, TAU); ctx.fill();

    // photon ring + event horizon
    ctx.strokeStyle = "rgba(255,232,205,0.9)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rEvent * 1.08, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rEvent, 0, TAU); ctx.fill();

    // debris
    ctx.fillStyle = "#8a8398";
    for (const d of debris) {
      const ex = cx + Math.cos(d.ang) * d.r, ey = cy + Math.sin(d.ang) * d.r;
      ctx.beginPath(); ctx.arc(ex, ey, d.size, 0, TAU); ctx.fill();
    }

    // coins
    for (const c of coins) {
      if (c.taken) continue;
      glowCircle(cx + Math.cos(c.ang) * c.r, cy + Math.sin(c.ang) * c.r, 7, "#ffd84d");
    }

    // pull / repel indicator (toward or away from the hole)
    const color = gravSide > 0 ? "#4dd2ff" : "#ff5e7e";
    const ux = orb.x - cx, uy = orb.y - cy;
    const ul = Math.hypot(ux, uy) || 1;
    const reach = gravSide > 0 ? -22 : 22;   // inward when attracting
    ctx.strokeStyle = gravSide > 0 ? "rgba(77,210,255,0.4)" : "rgba(255,94,126,0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(orb.x, orb.y);
    ctx.lineTo(orb.x + (ux / ul) * reach, orb.y + (uy / ul) * reach);
    ctx.stroke();

    // orb trail + orb
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.4;
      glowCircle(orb.trail[i].x, orb.trail[i].y, ORB_R * (0.4 + a * 0.5), color);
    }
    ctx.globalAlpha = 1;
    glowCircle(orb.x, orb.y, ORB_R, color, true);

    // surge screen tint
    if (active) {
      ctx.fillStyle = "rgba(255,60,30,0.10)";
      ctx.fillRect(0, 0, W, H);
    }
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
      glowCircle(orb.trail[i].x, ORB_Y, ORB_R * (0.4 + a * 0.5), gravSide > 0 ? "#4dd2ff" : "#ff5e7e");
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
    if (DEV_START_ORBITAL >= 2) enterOrbital(DEV_START_ORBITAL);   // dev: ?orbital=N
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
    if (orbital !== 5) {     // arena keeps orbital momentum; only flips the pull
      orb.vx *= 0.55;
      orb.vy *= 0.55;
    }
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
      if (taps >= 5) { taps = 0; reset("3d"); resume(); enterOrbital(2); }
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
    // Dev: press 1–5 to jump straight to that Orbital.
    if (e.key >= "1" && e.key <= "5") {
      const n = Number(e.key);
      if (!running) { reset(ORBITALS[n - 1].dim); resume(); enterOrbital(n); }
      else enterOrbital(n);
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
