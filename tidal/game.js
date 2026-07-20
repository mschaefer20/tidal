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

  // ---- Orbital 6 "Wormholes": safe paired portals that reposition you -------
  const WH_R = 17;                   // ring radius (entry hit test)
  const WH_TELEGRAPH = 0.4;          // s of warning-ring before a pair goes live
  const WH_LOCK = 0.5;               // s the pair is inert after a teleport (no re-entry loop)
  const WH_EVERY_MIN = 1.6;          // s between pairs (min) — tune later
  const WH_EVERY_MAX = 2.8;          // s between pairs (max)
  const WH_MAX_PAIRS = 2;            // how many pairs can share the screen
  const WH_GAP_MIN = 96;             // horizontal distance between a pair's two rings
  const WH_GAP_MAX = 168;

  // ---- Orbital 8 chaos portals: pairs drift as a unit and occasionally hop --
  const WH_CHAOS_DRIFT_AMP = 48;     // px of sinusoidal pair drift
  const WH_CHAOS_DRIFT_FREQ = 0.35;  // drift cycles per second
  const WH_CHAOS_HOP_MIN = 2.5;      // s between pair relocations
  const WH_CHAOS_HOP_MAX = 4.0;

  // ---- Orbital 8 "Cosmic Strings": rotating laser lines that pulse deadly ---
  // A screen-fixed pivot above the orb row spins a full line clock-hand style.
  // The line is only deadly where it crosses the orb's row, and only while
  // firing; idle it stays faint, charge flickers bright with a row marker.
  const STR_OMEGA_MIN = 0.45;        // rad/s rotation (random per string + sign)
  const STR_OMEGA_MAX = 0.70;
  const STR_PIVOT_DY_MIN = 230;      // pivot height above the orb row
  const STR_PIVOT_DY_MAX = 300;
  const STR_CHARGE = 0.7;            // s of bright flicker before the beam goes hot
  const STR_FIRE = 0.9;              // s the beam is deadly
  const STR_FIRE_EVERY_MIN = 2.2;    // s between fire windows (per string)
  const STR_FIRE_EVERY_MAX = 3.6;
  const STR_KILL_W = 22;             // half-width of the deadly band at the orb row
  const STR_COS_MIN = 0.25;          // don't arm near-horizontal (crossing off-field)

  const BAR_SPACING = 230;           // vertical distance between barriers

  // ---- Orbital progression -------------------------------------------------
  // Five "Orbitals" the player ascends as the score climbs. Each has a form
  // (2d / 3d), its own music track, and (being built out) its own gameplay.
  //   1: 2D pendulum (the original)      2: 3D tunnel
  //   3: 2D multi-gravity expansion      4: 3D expansion
  //   5: black-hole boss (finale)
  // Each orbital is its base render mode (dim) plus the capability flags the
  // update/draw code keys off — flags, not orbital numbers, so mechanics can
  // be recombined freely in later orbitals.
  //   binary: two oscillating gravity wells      drift: vertical orb motion (3D)
  //   wells: render wells + pull-beam (3D)       taper: tapered/varied 3D gaps
  //   arena: top-down survival arena             surges: arena gravity surges
  //   wh: wormholes  whChaos: drifting/hopping   whY: rings at varying heights
  //   whArena: polar arena portals               strings: rotating laser lines
  //   novas: expanding shockwave rings
  const ORBITALS = [
    { n: 1,  dim: "2d" },                                          // 2D pendulum
    { n: 2,  dim: "3d" },                                          // 3D tunnel
    { n: 3,  dim: "2d", binary: true },                            // 2D binary
    { n: 4,  dim: "3d", drift: true, wells: true, taper: true },   // 3D binary tunnel
    { n: 5,  dim: "2d", arena: true, surges: true },               // black-hole survival arena
    { n: 6,  dim: "2d", wh: true },                                // wormholes (wave two intro)
    { n: 7,  dim: "3d", wh: true, whEvery: [2.0, 3.4] },           // wormhole tunnel (sparser pairs at tunnel speed)
    { n: 8,  dim: "2d", wh: true, whChaos: true, strings: true },  // cosmic strings
    { n: 9,  dim: "3d", wh: true, whY: true, drift: true, wells: true, taper: true, whEvery: [1.4, 2.4] }, // wormhole tunnel, harder (densest portals)
    { n: 10, dim: "2d", arena: true, novas: true, whArena: true, whEvery: [4.0, 6.0] }, // supernova finale
  ];
  // The active orbital's entry (or orbital n's, when given).
  function ORB(n) { return ORBITALS[(n || orbital) - 1] || ORBITALS[0]; }
  // Score to reach orbital n. Dev mode spaces them 7 apart (7/14/21/28);
  // regular mode 100 apart (100/200/300/400).
  function orbitalThreshold(n) { return n <= 1 ? 0 : (devMode ? 7 : 100) * (n - 1); }

  // Speed ramps over the FIRST DIFF_RAMP points of each orbital, then holds —
  // so it resets to slow at the start of every orbital.
  const DIFF_RAMP = 50;
  // After a continue, don't drop all the way back to crawl speed: hold at least
  // CONTINUE_DIFF_FLOOR of the ramp (0 = start speed, 1 = max). Reset each orbital.
  const CONTINUE_DIFF_FLOOR = 0.25;
  function difficulty() { return Math.max(diffFloor, Math.min(1, (score - orbitalStartScore) / DIFF_RAMP)); }
  function scrollSpeed() { return SCROLL_START + (SCROLL_MAX - SCROLL_START) * difficulty(); }
  function depthSpeedNow() {
    const base = DEPTH_SPEED_START + (DEPTH_SPEED_MAX - DEPTH_SPEED_START) * difficulty();
    return base * (orbital >= 4 ? O4_SPEED_MULT : 1);
  }
  const ORBITAL_LABEL = ["", "ORBITAL I", "ORBITAL II", "ORBITAL III", "ORBITAL IV", "ORBITAL V", "ORBITAL VI", "ORBITAL VII", "ORBITAL VIII", "ORBITAL IX", "ORBITAL X"];

  // The orb's two gravity-state colors (left pull / right pull).
  const ORB_LEFT = "#ff5e7e", ORB_RIGHT = "#4dd2ff";
  function orbColor() { return gravSide > 0 ? ORB_RIGHT : ORB_LEFT; }

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
  const O4_SPEED_MULT = 1.1;         // slight extra tunnel speed at orbital 4

  // ---- Orbital 5 "Event Horizon": top-down survival arena around a black hole
  const ARENA = { x: W / 2, y: H * 0.46, rEvent: 30, rArena: 196 };
  const ARENA_G = 1100;              // radial accel (a tap flips inward <-> outward)
  const ARENA_MAXVR = 300;           // radial speed cap
  const ARENA_OMEGA = 1.25;          // steady angular sweep around the hole (rad/s)
  const DEBRIS_FIRST = 1.8;          // delay before the first debris (arena starts empty)
  const DEBRIS_SPEED0 = 50;          // initial inward speed of falling debris
  const DEBRIS_GRAV = 85;            // inward acceleration (pulled toward the hole)
  const SURGE_EVERY = 6;             // seconds between gravity-surge attacks
  const SURGE_CHARGE = 0.8;          // telegraph time before a surge
  const SURGE_ACTIVE = 1.4;          // surge duration
  const SURGE_MULT = 1.9;            // gravity multiplier during a surge
  const TAU = Math.PI * 2;

  // ---- Orbital 10 "Supernova": expanding shockwave rings with one gap ------
  // The star periodically detonates: a ring expands from the core to the rim
  // and only a telegraphed angular gap is safe. Theta sweeps at a fixed rate,
  // so the player steers TIMING with radius — flip outward to meet the ring
  // later (and at a different angle), inward to meet it sooner.
  const NOVA_FIRST = 4.0;            // s after the intro before the first nova
  const NOVA_EVERY = 8.0;            // s between novas (shrinks with arenaTime)
  const NOVA_EVERY_MIN = 5.0;
  const NOVA_CHARGE = 1.2;           // telegraph: star swells + gap wedge shown
  const NOVA_RING_SPEED = 130;       // px/s ring expansion (core→rim ≈ 1.3s)
  const NOVA_RING_TH = 9;            // ring half-thickness for collision
  const NOVA_GAP_HALF0 = 0.55;       // rad half-width of the safe gap at ramp 0
  const NOVA_GAP_TIGHTEN = 0.17;     // gap shrinks to ~0.38 rad by full ramp

  // Orbital 10 arena portals — reposition across the arena (escape a ring
  // whose gap you can't make). Polar pair; one at a time, limited lifetime.
  const WH_ARENA_LIFE = 7.0;         // s a pair stays open (fades the last second)
  const WH_ARENA_RMIN = 70;          // radial band the portals occupy
  const WH_ARENA_RMAX = 165;
  const WH_ARENA_SEP = 1.6;          // min angular separation between the ends

  // ---- Orbital 3 "Binary" tunables (2D multi-gravity) ----------------------
  // Two planets offset diagonally so the pull is 2D: left tugs up-left,
  // right tugs down-right → curved, two-axis motion. Top/bottom are deadly.
  const G3_LEFT = { x: -0.10 * W, y: H * 0.5 };   // both centered → equal vertical range
  const G3_RIGHT = { x: 1.10 * W, y: H * 0.5 };
  const GRAVITY3 = 1650;             // directional accel toward the active planet
  const MAXV3 = 520;                 // 2D speed cap
  const Y_WALL = ORB_R + 8;          // deadly top/bottom margin
  const G3_AMP = 148;                // planet vertical sway amplitude (80% of prior 185)
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
    continue: document.getElementById("screen-continue"),
    startfrom: document.getElementById("screen-startfrom"),
    shop: document.getElementById("screen-shop"),
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
  let mode, depthSpeed, flash, intro, travel, orbital, countdown, invuln, orbitalStartScore, diffFloor;
  let wormholes, nextWormhole;  // Orbital 6: active portal pairs + spawn timer
  let strings;                  // Orbital 8: rotating cosmic-string lasers
  let continues, adUsed;        // continue ladder: count this run + whether the ad was used
  let frozen = false;           // shot mode: freeze the scene to capture a screenshot
  const COUNTDOWN_TIME = 3.0;   // wait + 3-2-1 before each new orbital (2-5)
  const CONTINUE_COST = 100;    // base coins per continue
  // First continue is free via ad (once per run); coin cost doubles each time.
  function continueCost() { return CONTINUE_COST * Math.pow(2, continues); }
  let g3Time, gpL, gpR;   // Orbital 3: oscillation clock + live planet positions
  let arenaTime, scoreClock, debris, coins, surge, nextSurge, nextDebris, escaped;   // Orbital 5 arena
  let nova, nextNova;           // Orbital 10: active shockwave + schedule
  let use3DEngine = false;   // becomes true once the WebGL engine inits OK

  const BEST_KEY = "tidal-best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  // Dev: open with ?3d (or ?mode=3d) to start straight in the 3D mode,
  // and ?slow to boot in dev slow-motion.
  const params = new URLSearchParams(location.search);
  const DEV_START_3D = params.has("3d") || params.get("mode") === "3d";
  // Dev shortcut: ?orbital=N boots every run straight into that Orbital.
  const DEV_START_ORBITAL = Math.max(0, Math.min(ORBITALS.length, Number(params.get("orbital")) || 0));
  // Screenshot helper: ?shot=N drops into a posed scene (score/best/orbital, no death).
  const SHOT = Math.max(0, Math.min(5, Number(params.get("shot")) || 0));
  const SHOTS = {
    1: { orbital: 1, score: 13, best: 44 },
    2: { orbital: 2, score: 122, best: 149 },
    3: { orbital: 3, score: 254, best: 277 },
    4: { orbital: 4, score: 302, best: 344 },
    5: { orbital: 5, score: 409, best: 422 },
  };
  let shotMode = false;
  // Dev mode = compressed thresholds + excluded from ranking. Only reachable
  // via URL params (?dev / ?orbital / ?3d) for testing — not in the shipped UI.
  let devMode = params.has("dev") || DEV_START_3D || DEV_START_ORBITAL > 0;
  // Highest orbital the player has reached — unlocks "Start From" (persisted).
  const UNLOCK_KEY = "tidal-unlocked";
  let unlocked = Math.max(1, Math.min(ORBITALS.length, Number(localStorage.getItem(UNLOCK_KEY) || 1)));
  function setUnlocked(n) {
    if (n > unlocked) { unlocked = n; localStorage.setItem(UNLOCK_KEY, String(unlocked)); }
  }

  // Persists across runs (it's a setting, not part of a game).
  let timeScale = params.has("slow") ? SPEED_DEV : SPEED_NORMAL;

  // The orbital this run began at (>1 when begun via "Start From") — the death
  // screen offers to restart there in addition to a from-scratch run.
  let runStartOrbital = 1;

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
    runStartOrbital = 1;
    intro = mode === "3d" ? 0 : 1;
    depthSpeed = DEPTH_SPEED_START;
    countdown = 0;
    invuln = 0;
    shotMode = false;
    frozen = false;
    orbitalStartScore = 0;
    diffFloor = 0;
    wormholes = []; nextWormhole = randRange(WH_EVERY_MIN, WH_EVERY_MAX);
    strings = [];
    continues = 0;
    adUsed = false;
    g3Time = 0;
    gpL = { x: G3_LEFT.x, y: G3_LEFT.y };
    gpR = { x: G3_RIGHT.x, y: G3_RIGHT.y };
    arenaTime = 0; scoreClock = 0; surge = null; nextSurge = SURGE_EVERY;
    nextDebris = DEBRIS_FIRST; debris = []; coins = []; escaped = false;
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
    orbitalStartScore = score;   // speed ramp resets at the start of each orbital
    diffFloor = 0;               // (a continue re-raises this afterward)
    setUnlocked(n);
    mode = ORBITALS[n - 1].dim;
    flash = settings.reduceMotion ? 0.25 : 1;
    countdown = COUNTDOWN_TIME;   // wait + countdown before the new orbital begins
    // clean, centered start for the new orbital
    orb.x = W / 2;
    orb.y = n === 3 ? H / 2 : ORB_Y;
    orb.vx = 0;
    orb.vy = 0;
    if (ORB(n).binary || ORB(n).drift) g3Time = 0;
    // Wormholes never survive an orbital change — their coordinate space
    // (y-scroll vs depth vs polar) differs between orbitals.
    wormholes = [];
    nextWormhole = nextWormholeDelay();
    strings = [];
    if (mode === "3d") {
      depthSpeed = DEPTH_SPEED_START;
      intro = 0;
      travel = 0;
      build3DField();
      show3D();
    } else {
      intro = ORB(n).arena ? 0 : 1;   // the arena gets a settle-in intro
      hide3D();
      if (ORB(n).arena) buildArena(); else build2DField();
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
    if (small) small.textContent = "";
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
      orbLeft: ORB_LEFT, orbRight: ORB_RIGHT,
      orbNX: Math.max(-1.2, Math.min(1.2, nx(orb.x))),
      orbNY: ORB().drift ? (orb.y - H / 2) / (H / 2) : 0,
      wellL: ORB().wells ? { x: nx(gpL.x), y: (gpL.y - H / 2) / (H / 2) } : null,
      wellR: ORB().wells ? { x: nx(gpR.x), y: (gpR.y - H / 2) / (H / 2) } : null,
      gravSide,
      intro,
      travel,
      orbital,
      reduceMotion: settings.reduceMotion,
      bars: bars.filter((b) => b.d > -1.2).map((b) => ({
        d: b.d,
        cx: nx(b.gapX + b.gapW / 2),
        half: (b.gapW / 2) / halfPlay,
        taper: b.taper || 0,
      })),
      bonuses: bonuses.filter((o) => !o.taken && o.d > -1).map((o) => ({ nx: nx(o.x), d: o.d })),
      wormholes: ORB().wh
        ? wormholes.filter((w) => w.d > -1).map((w) => ({ d: w.d, nxa: nx(w.xa), nxb: nx(w.xb), ny: w.ny || 0, age: w.age, lock: w.lock }))
        : null,
    };
  }

  function gapWidth() {
    const t = Math.min(1, score / 40);
    return GAP_START - (GAP_START - GAP_MIN) * t;
  }

  function randomGapX(gap) {
    return WALL + 10 + Math.random() * (W - 2 * WALL - 20 - gap);
  }

  function randRange(a, b) { return a + Math.random() * (b - a); }
  function orbitalHasWormholes() { return !!ORB().wh; }
  // Seconds until the next portal pair — per-orbital override via whEvery.
  function nextWormholeDelay() {
    const [mn, mx] = ORB().whEvery || [WH_EVERY_MIN, WH_EVERY_MAX];
    return randRange(mn, mx);
  }

  // Spawn one linked portal pair above the screen: two rings a moderate gap
  // apart, placed at a random x, scrolling down together. Enter either → snap
  // to the other's x (Orbital 6). Vertically it lands on a barrier MID-row
  // (equidistant between walls) and stays there — bars scroll at the same rate.
  function spawnWormhole() {
    const half = randRange(WH_GAP_MIN, WH_GAP_MAX) / 2;
    // Chaos pairs drift ±WH_CHAOS_DRIFT_AMP, so keep their base further from
    // the walls — an exit must never drop the orb inside a wall.
    const inset = WALL + 30 + half + (ORB().whChaos ? WH_CHAOS_DRIFT_AMP : 0);
    const cx = randRange(inset, W - inset);
    const ref = bars.length ? bars[0].y : -40;    // any bar → the grid phase
    let wy = ref - BAR_SPACING / 2;                // half a spacing = between rows
    while (wy > -20) wy -= BAR_SPACING;            // put it just above the screen top
    while (wy <= -20 - BAR_SPACING) wy += BAR_SPACING;
    wormholes.push({ y: wy, xa: cx - half, xb: cx + half, age: 0, lock: 0,
      baseC: cx, half, phase: Math.random() * TAU,
      hop: randRange(WH_CHAOS_HOP_MIN, WH_CHAOS_HOP_MAX) });
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
    let gap = gapWidth();
    // Orbital 4: each gap varies up to ±20% so the tunnel reads less uniform
    // (worst case ~77px vs the 26px orb — tight but fair).
    if (ORB().taper) gap *= 0.8 + Math.random() * 0.4;
    const gapX = randomGapX(gap);
    // Orbital 4: gaps also taper — up to 20% wider/narrower at the top vs the
    // bottom (±10% around the middle), so where you cross vertically matters.
    const taper = ORB().taper ? Math.random() * 0.2 - 0.1 : 0;
    bars.push({ d, gapX, gapW: gap, taper, passed: false });
    if (Math.random() < 0.6) {
      const bx = gapX + Math.random() * gap;
      bonuses.push({ x: bx, d: d - DEPTH_SPACING / 2, taken: false });
    }
  }

  // ---- Simulation ----------------------------------------------------------
  function update(dt) {
    if (flash > 0) flash = Math.max(0, flash - dt * 1.6);
    if (invuln > 0) invuln = Math.max(0, invuln - dt);
    if (mode === "3d") return update3D(dt);
    if (ORB().arena) return updateArena(dt);
    if (ORB().binary) return updateBinary(dt);
    return update2D(dt);
  }

  // ---- Orbital 3 "Binary": 2D gravity toward the active planet -------------
  function updateBinary(dt) {
    const fromOrbital = orbital;
    scroll = scrollSpeed();

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
        sfx("coin"); buzz("light"); if (window.TidalStore) TidalStore.addCoins(TidalStore.coinMultiplier());
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

  // Orbital 4: 2D flight toward oscillating wells inside the tunnel (Orbital 3's
  // pull, but in the depth-tunnel). Deadly side walls AND top/bottom edges.
  function stepBinary3D(dt) {
    g3Time += dt;
    const sway = (ph) => G3_AMP * (
      0.5 * Math.sin(g3Time * G3_FREQ + ph) +
      0.3 * Math.sin(g3Time * G3_FREQ2 + ph * 1.7) +
      0.2 * Math.sin(g3Time * G3_FREQ3 + ph * 0.6)
    );
    gpL.y = G3_LEFT.y + sway(0);
    gpR.y = G3_RIGHT.y + sway(2.4);
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
    if (orb.trail.length > 14) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    return !(orb.x <= WALL || orb.x >= W - WALL || orb.y <= Y_WALL || orb.y >= H - Y_WALL);
  }

  function addScore(n) {
    if (shotMode) return;            // posed screenshot: keep the score fixed
    score += n;
    scoreEl.textContent = score;
    // advance to the next Orbital once its score threshold is reached
    const next = ORBITALS[orbital]; // orbital is 1-based → this is the next one
    if (next && score >= orbitalThreshold(next.n)) enterOrbital(next.n);
  }

  function inGap(b) {
    let gx = b.gapX, gw = b.gapW;
    if (b.taper) {
      // Orbital 4 tapered gap: width varies linearly with the orb's height
      // (same ny the renderer slants the walls by), centered on the midpoint.
      const ny = (orb.y - H / 2) / (H / 2);
      const eff = b.gapW * (1 + b.taper * ny);
      gx += (b.gapW - eff) / 2;
      gw = eff;
    }
    return orb.x > gx + ORB_R * 0.5 && orb.x < gx + gw - ORB_R * 0.5;
  }

  function update2D(dt) {
    const fromOrbital = orbital;
    scroll = scrollSpeed();   // score-based, capped at DIFF_MAX_SCORE

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
        sfx("coin"); buzz("light"); if (window.TidalStore) TidalStore.addCoins(TidalStore.coinMultiplier());
      }
    }

    if (orbitalHasWormholes()) updateWormholes(dt, dy);
    if (ORB().strings) updateStrings(dt);
  }

  // ---- Orbital 8 "Cosmic Strings" ------------------------------------------
  // Where the string's beam crosses the orb's row (off-field when near-horizontal).
  function stringXHit(s) {
    const c = Math.cos(s.ang);
    if (Math.abs(c) < 0.03) return -9999;
    return s.px + (ORB_Y - s.py) * Math.tan(s.ang);
  }
  // A second string joins once the orbital's speed ramp passes the halfway mark.
  function stringCount() { return difficulty() > 0.5 ? 2 : 1; }

  function updateStrings(dt) {
    while (strings.length < stringCount()) {
      strings.push({
        px: randRange(W * 0.30, W * 0.70),
        py: ORB_Y - randRange(STR_PIVOT_DY_MIN, STR_PIVOT_DY_MAX),
        ang: Math.random() * Math.PI,
        omega: randRange(STR_OMEGA_MIN, STR_OMEGA_MAX) * (Math.random() < 0.5 ? -1 : 1),
        phase: "idle",
        t: randRange(1.5, 2.5),          // beam stays readable well before it first fires
      });
    }
    for (const s of strings) {
      s.ang += s.omega * dt;
      s.t -= dt;
      if (s.phase === "idle") {
        if (s.t > 0) continue;
        // Only arm when the beam's row-crossing is on-field and not sweeping so
        // fast it would blanket the row (near-horizontal) — no cheap kills.
        const xh = stringXHit(s);
        if (Math.abs(Math.cos(s.ang)) > STR_COS_MIN && xh > WALL && xh < W - WALL) {
          s.phase = "charge"; s.t = STR_CHARGE;
        } else {
          s.t = 0.3;                     // bad geometry right now — retry shortly
        }
      } else if (s.phase === "charge") {
        if (s.t > 0) continue;
        s.phase = "fire"; s.t = STR_FIRE;
        sfx("laser"); buzz("light");
      } else if (s.phase === "fire") {
        const xh = stringXHit(s);
        if (!shotMode && xh > 0 && xh < W && Math.abs(orb.x - xh) < STR_KILL_W) { die(); return; }
        if (s.t <= 0) { s.phase = "idle"; s.t = randRange(STR_FIRE_EVERY_MIN, STR_FIRE_EVERY_MAX); }
      }
    }
  }

  // Orbital 7: same escape-hatch portals in the 3D tunnel — depth (d) instead
  // of y. A pair recedes toward the camera; when it reaches the camera plane
  // and you're lined up with a ring, snap to the twin's x (horizontal hop).
  function spawnWormhole3D() {
    const half = randRange(WH_GAP_MIN, WH_GAP_MAX) / 2;
    const minC = WALL + 30 + half, maxC = W - WALL - 30 - half;
    // Usually bias the pair toward the far side of the most imminent gap, so
    // portals tend to offer a jump you actually want (never always — a solved
    // pattern would trivialize the read).
    let cx;
    const near = bars.reduce((a, b) => (b.d > 0 && (!a || b.d < a.d) ? b : a), null);
    if (near && Math.random() < 0.6) {
      const mid = (minC + maxC) / 2;
      cx = near.gapX + near.gapW / 2 < W / 2 ? randRange(mid, maxC) : randRange(minC, mid);
    } else {
      cx = randRange(minC, maxC);
    }
    const ref = bars.length ? bars[0].d : 0;      // barrier depth grid
    let wd = ref + DEPTH_SPACING / 2;             // half a spacing = between rings
    while (wd < D_SPAWN - DEPTH_SPACING) wd += DEPTH_SPACING;
    while (wd > D_SPAWN) wd -= DEPTH_SPACING;
    // Orbital 9: rings sit at varying heights (the orb drifts vertically there),
    // stored normalized like orbNY. One shared y per pair keeps the link readable.
    const ny = ORB().whY ? randRange(-0.55, 0.55) : 0;
    wormholes.push({ d: wd, xa: cx - half, xb: cx + half, ny, age: 0, lock: 0 });
  }

  function updateWormholes3D(dt, dd) {
    for (const w of wormholes) {
      w.d -= dd;
      w.age += dt;
      if (w.lock > 0) w.lock = Math.max(0, w.lock - dt);
    }
    wormholes = wormholes.filter((w) => w.d > -1);

    nextWormhole -= dt;
    if (nextWormhole <= 0 && wormholes.length < WH_MAX_PAIRS) {
      spawnWormhole3D();
      nextWormhole = nextWormholeDelay();
    }

    for (const w of wormholes) {
      if (w.age < WH_TELEGRAPH || w.lock > 0) continue;
      if (w.d > 0.4 || w.d < -0.4) continue;             // only at the camera plane
      // Orbital 9: the orb must also be at the ring's height to enter.
      if (ORB().whY && Math.abs(orb.y - (H / 2 + w.ny * (H / 2))) > WH_R + 10) continue;
      const inA = Math.abs(orb.x - w.xa) < WH_R + 4;
      const inB = Math.abs(orb.x - w.xb) < WH_R + 4;
      if (!inA && !inB) continue;
      orb.x = inA ? w.xb : w.xa;
      orb.vx = 0;
      orb.vy *= 0.3;               // gentle exit — don't fling into the ceiling
      w.lock = WH_LOCK;
      flash = Math.max(flash, 0.4);
      sfx("warp"); buzz("medium");
      bonuses.push({ x: orb.x, d: 1.4, taken: false });   // reward coins arrive next
      bonuses.push({ x: orb.x, d: 2.2, taken: false });
      break;
    }
  }

  // Orbital 6: scroll portal pairs, spawn on a timer, teleport on entry.
  // Orbital 8 (whChaos): pairs also drift sinusoidally as a unit and
  // occasionally blink out and reappear at a new x (always re-telegraphed).
  function updateWormholes(dt, dy) {
    for (const w of wormholes) {
      w.y += dy;
      w.age += dt;
      if (w.lock > 0) w.lock = Math.max(0, w.lock - dt);
      if (ORB().whChaos) {
        w.hop -= dt;
        if (w.hop <= 0) {
          const inset = WALL + 30 + w.half + WH_CHAOS_DRIFT_AMP;
          w.baseC = randRange(inset, W - inset);
          w.age = 0;                        // re-run the telegraph at the new spot
          w.lock = Math.max(w.lock, 0.25);  // inert through the blink
          w.hop = randRange(WH_CHAOS_HOP_MIN, WH_CHAOS_HOP_MAX);
        }
        const off = WH_CHAOS_DRIFT_AMP * Math.sin(w.age * WH_CHAOS_DRIFT_FREQ * TAU + w.phase);
        w.xa = w.baseC - w.half + off;
        w.xb = w.baseC + w.half + off;
      }
    }
    wormholes = wormholes.filter((w) => w.y < H + 40);   // scroll off → disappear

    // spawn cadence: up to WH_MAX_PAIRS pairs can share the screen
    nextWormhole -= dt;
    if (nextWormhole <= 0 && wormholes.length < WH_MAX_PAIRS) {
      spawnWormhole();
      nextWormhole = nextWormholeDelay();
    }

    // teleport: when an active ring reaches the orb's row and lines up in x
    for (const w of wormholes) {
      if (w.age < WH_TELEGRAPH || w.lock > 0) continue;   // still telegraphing / locked
      if (Math.abs(w.y - ORB_Y) > WH_R) continue;         // ring not at the orb's row yet
      const inA = Math.abs(orb.x - w.xa) < WH_R;
      const inB = Math.abs(orb.x - w.xb) < WH_R;
      if (!inA && !inB) continue;
      orb.x = inA ? w.xb : w.xa;   // pop out the twin's x (horizontal reposition)
      orb.vx = 0;
      w.lock = WH_LOCK;            // both rings inert briefly so we don't loop
      flash = Math.max(flash, 0.4);
      sfx("warp"); buzz("medium");
      // reward the read: a couple coins drift down toward where you landed
      bonuses.push({ x: orb.x, y: ORB_Y - 34, taken: false });
      bonuses.push({ x: orb.x, y: ORB_Y - 66, taken: false });
      break;                       // one jump per frame (avoid chaining pairs)
    }
  }

  // ---- Orbital 5 "Event Horizon": survival arena ---------------------------
  function spawnDebris() {
    // Spawn far enough ahead (in the sweep direction) that — after the warn +
    // fall time — it lands where the orb will be, so you actually have to dodge.
    const ang = orb.theta - ARENA_OMEGA * 1.6 + (Math.random() - 0.5) * 0.7;
    debris.push({
      ang,
      r: ARENA.rArena - 4,                 // appears at the rim
      vr: 0,                               // stationary while warning
      vAng: -(0.05 + Math.random() * 0.3), // counter-clockwise drift once falling
      size: 9 + Math.random() * 7,
      warn: 0.7,                           // telegraph time before it drops
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
    nova = null; nextNova = NOVA_FIRST;
    nextDebris = DEBRIS_FIRST;    // starts empty; debris arrives gradually
    escaped = false;
    orb.theta = -Math.PI / 2;     // start at the top of the ring
    orb.rho = 125;                // mid-band radius
    orb.vrho = 0;
    orb.x = ARENA.x + Math.cos(orb.theta) * orb.rho;
    orb.y = ARENA.y + Math.sin(orb.theta) * orb.rho;
    orb.trail = [];
    gravSide = -1;                // start drifting gently outward (rim is farther = safer)
    debris = [];
    coins = []; for (let i = 0; i < 3; i++) spawnCoin();
  }

  function updateArena(dt) {
    const fromOrbital = orbital;

    // Intro: hold still while the scene settles (the hole charges ominously),
    // then release into play.
    if (intro < 1) {
      orb.x = ARENA.x + Math.cos(orb.theta) * orb.rho;
      orb.y = ARENA.y + Math.sin(orb.theta) * orb.rho;
      orb.trail.push({ x: orb.x, y: orb.y });
      if (orb.trail.length > 22) orb.trail.shift();
      return;
    }

    // flung past the rim: keep flying outward into space, then it's over
    if (escaped) {
      orb.theta -= ARENA_OMEGA * dt;
      orb.rho += ARENA_MAXVR * 1.4 * dt;
      orb.x = ARENA.x + Math.cos(orb.theta) * orb.rho;
      orb.y = ARENA.y + Math.sin(orb.theta) * orb.rho;
      orb.trail.push({ x: orb.x, y: orb.y });
      if (orb.trail.length > 22) orb.trail.shift();
      if (orb.rho > 470) return die();   // off into space → game over
      return;
    }

    arenaTime += dt;

    // boss attack: scheduled gravity surges (telegraphed, then strong inward
    // pull). Orbital 10 swaps this attack out for the supernova rings.
    let gMult = 1;
    if (ORB().surges) {
      nextSurge -= dt;
      if (!surge && nextSurge <= 0) surge = { phase: "charge", t: SURGE_CHARGE };
      if (surge) {
        surge.t -= dt;
        if (surge.phase === "charge") {
          if (surge.t <= 0) { surge.phase = "active"; surge.t = SURGE_ACTIVE; }
        } else {
          gMult = SURGE_MULT;
          if (surge.t <= 0) { surge = null; nextSurge = Math.max(3.5, SURGE_EVERY - arenaTime * 0.04); }
        }
      }
    }

    // steady angular sweep; the tap flips the RADIAL pull in <-> out, so you
    // sway between the hole (inner wall) and the rim (outer wall) — a pendulum
    // bent into a circle.
    orb.theta -= ARENA_OMEGA * dt;   // counter-clockwise sweep
    orb.vrho += (gravSide > 0 ? -1 : 1) * ARENA_G * gMult * dt;   // attract = inward
    orb.vrho = Math.max(-ARENA_MAXVR, Math.min(ARENA_MAXVR, orb.vrho));
    orb.rho += orb.vrho * dt;
    orb.x = ARENA.x + Math.cos(orb.theta) * orb.rho;
    orb.y = ARENA.y + Math.sin(orb.theta) * orb.rho;

    orb.trail.push({ x: orb.x, y: orb.y });
    if (orb.trail.length > 22) orb.trail.shift();
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    // pulled into the hole → consumed
    if (orb.rho <= ARENA.rEvent + ORB_R * 0.3) return die();
    // flung past the rim → fly off into space (handled on the next frames)
    if (orb.rho >= ARENA.rArena) { escaped = true; return; }

    // supernova shockwaves + repositioning portals (orbital 10's attacks)
    if (ORB().novas) {
      if (updateNova(dt)) return die();
      if (orbital !== fromOrbital) return;   // ring-clear score could shift orbitals
    }
    if (ORB().whArena) updateWormholesArena(dt);

    // debris falls inward from the rim — spawns gradually, faster over time.
    // Thinner while novas run, so the expanding rings stay readable.
    nextDebris -= dt;
    if (nextDebris <= 0) {
      spawnDebris();
      nextDebris = Math.max(0.38, 1.5 - arenaTime * 0.05) * (ORB().novas ? 1.4 : 1);
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      if (d.warn > 0) { d.warn -= dt; continue; }   // telegraphing at the rim (no fall/collision)
      if (d.vr === 0) d.vr = -DEBRIS_SPEED0;          // release into the fall
      d.vr -= DEBRIS_GRAV * gMult * dt;     // accelerates toward the hole (harder mid-surge)
      d.r += d.vr * dt;
      d.ang += d.vAng * dt;
      if (d.r <= ARENA.rEvent) {            // consumed by the hole → score
        debris.splice(i, 1);
        addScore(1);
        if (orbital !== fromOrbital) return;
        continue;
      }
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

  // ---- Orbital 10: supernova shockwaves ------------------------------------
  // Advance the nova state machine. Returns true if the ring caught the orb.
  function updateNova(dt) {
    nextNova -= dt;
    if (!nova && nextNova <= 0) {
      nova = {
        phase: "charge", t: NOVA_CHARGE,
        gapAng: Math.random() * TAU,
        gapHalf: NOVA_GAP_HALF0 - NOVA_GAP_TIGHTEN * difficulty(),
      };
    }
    if (!nova) return false;
    nova.t -= dt;
    if (nova.phase === "charge") {
      if (nova.t <= 0) {
        nova.phase = "ring"; nova.r = ARENA.rEvent; nova.cleared = false;
        sfx("laser"); buzz("medium");
      }
      return false;
    }
    nova.r += NOVA_RING_SPEED * dt;
    if (Math.abs(nova.r - orb.rho) < ORB_R + NOVA_RING_TH) {
      // wrap-safe angular distance to the gap center; the gap is shrunk by the
      // orb's own angular radius so grazing its edge kills honestly
      const da = ((orb.theta - nova.gapAng + Math.PI) % TAU + TAU) % TAU - Math.PI;
      const margin = Math.asin(Math.min(1, ORB_R / Math.max(orb.rho, ARENA.rEvent)));
      if (Math.abs(da) > nova.gapHalf - margin) return true;   // caught by the wave
    }
    if (!nova.cleared && nova.r > orb.rho + ORB_R + NOVA_RING_TH) {
      nova.cleared = true;
      addScore(3);                       // threaded the gap
      if (!nova) return false;           // (score advanced the orbital → state rebuilt)
    }
    if (nova.r > ARENA.rArena + 30) {
      nova = null;
      nextNova = Math.max(NOVA_EVERY_MIN, NOVA_EVERY - arenaTime * 0.06);
    }
    return false;
  }

  // ---- Orbital 10: polar repositioning portals ------------------------------
  function spawnWormholeArena() {
    const a1 = Math.random() * TAU;
    const a2 = a1 + WH_ARENA_SEP + Math.random() * (TAU - 2 * WH_ARENA_SEP);
    wormholes.push({
      a1, r1: randRange(WH_ARENA_RMIN, WH_ARENA_RMAX),
      a2, r2: randRange(WH_ARENA_RMIN, WH_ARENA_RMAX),
      age: 0, lock: 0, life: WH_ARENA_LIFE,
    });
  }

  function updateWormholesArena(dt) {
    for (const w of wormholes) {
      w.age += dt;
      w.life -= dt;
      if (w.lock > 0) w.lock = Math.max(0, w.lock - dt);
    }
    wormholes = wormholes.filter((w) => w.life > 0);

    nextWormhole -= dt;
    if (nextWormhole <= 0 && wormholes.length < 1) {   // one pair at a time
      spawnWormholeArena();
      nextWormhole = nextWormholeDelay();
    }

    for (const w of wormholes) {
      if (w.age < WH_TELEGRAPH || w.lock > 0 || w.life < 1) continue;
      for (const [aIn, rIn, aOut, rOut] of [[w.a1, w.r1, w.a2, w.r2], [w.a2, w.r2, w.a1, w.r1]]) {
        const ex = ARENA.x + Math.cos(aIn) * rIn, ey = ARENA.y + Math.sin(aIn) * rIn;
        const dx = ex - orb.x, dy = ey - orb.y;
        if (dx * dx + dy * dy > (WH_R + 4) * (WH_R + 4)) continue;
        // teleport: land at the twin with no radial momentum
        orb.theta = aOut;
        orb.rho = rOut;
        orb.vrho = 0;
        orb.x = ARENA.x + Math.cos(orb.theta) * orb.rho;
        orb.y = ARENA.y + Math.sin(orb.theta) * orb.rho;
        w.lock = WH_LOCK;
        flash = Math.max(flash, 0.4);
        sfx("warp"); buzz("medium");
        return;
      }
    }
  }

  // ---- 3D simulation -------------------------------------------------------
  function update3D(dt) {
    const fromOrbital = orbital;
    depthSpeed = depthSpeedNow();   // score-based, capped at DIFF_MAX_SCORE

    // Hold the orb dead-center for the first ~2.4s of the 3D intro, then release
    // it to gravity — a clear beat to see it before it starts drifting.
    if (intro < 0.6) {
      orb.x = W / 2; orb.vx = 0;
      if (ORB().drift) { orb.y = H / 2; orb.vy = 0; }   // center vertically too
      orb.trail.push({ x: orb.x, y: orb.y });
      if (orb.trail.length > 14) orb.trail.shift();
    } else if (ORB().drift) {
      if (!stepBinary3D(dt)) return die();                // Orbital 4: 2D oscillating-well flight
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
        if (orbital !== fromOrbital) return;   // advanced orbital mid-loop; bail
      }
    }

    // bonus pickups near the camera plane
    for (const o of bonuses) {
      if (o.taken) continue;
      if (o.d <= 0.5 && o.d > -0.5 && Math.abs(o.x - orb.x) < ORB_R + 12) {
        o.taken = true;
        addScore(5);
        sfx("coin"); buzz("light"); if (window.TidalStore) TidalStore.addCoins(TidalStore.coinMultiplier());
      }
    }

    if (orbitalHasWormholes()) updateWormholes3D(dt, dd);

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
    } else if (ORB().arena) {
      drawArena();
    } else if (ORB().binary) {
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

    if (orbitalHasWormholes()) for (const w of wormholes) drawWormhole(w);

    // barriers
    for (const b of bars) {
      drawBar(b);
    }

    if (ORB().strings) for (const s of strings) drawString(s);

    // bonus orbs
    for (const o of bonuses) {
      if (o.taken) continue;
      glowCircle(o.x, o.y, 7, "#ffd84d");
    }

    // orb trail
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.4;
      glowCircle(orb.trail[i].x, orb.trail[i].y, ORB_R * (0.4 + a * 0.5), orbColor());
    }
    ctx.globalAlpha = 1;

    // orb (color shows which way it's being pulled)
    glowCircle(orb.x, orb.y, ORB_R, orbColor(), true);
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
      glowCircle(orb.trail[i].x, orb.trail[i].y, ORB_R * (0.4 + a * 0.5), orbColor());
    }
    ctx.globalAlpha = 1;
    glowCircle(orb.x, orb.y, ORB_R, orbColor(), true);
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
    const intro5 = intro < 1;

    // ominous backdrop: near-black with a deep red glow welling from the hole
    ctx.fillStyle = "#05030a";
    ctx.fillRect(-12, -12, W + 24, H + 24);
    const bg = ctx.createRadialGradient(cx, cy, 16, cx, cy, 300);
    bg.addColorStop(0, "rgba(72,10,16,0.9)");
    bg.addColorStop(1, "rgba(8,4,12,0)");
    ctx.fillStyle = bg;
    ctx.fillRect(-12, -12, W + 24, H + 24);

    // arena boundary (deadly outer edge)
    ctx.strokeStyle = "rgba(255,80,90,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rArena, 0, TAU); ctx.stroke();

    // intro charge-up: a pulsing ring tightening onto the hole
    if (intro5) {
      const p = 0.5 + 0.5 * Math.sin(intro * 26);
      ctx.strokeStyle = `rgba(255,90,40,${0.25 + p * 0.4})`;
      ctx.lineWidth = 2 + p * 2;
      ctx.beginPath(); ctx.arc(cx, cy, ARENA.rEvent * (4.5 - intro * 3), 0, TAU); ctx.stroke();
    }

    // accretion glow (brightens while a surge charges / fires)
    const glowR = ARENA.rEvent * (active ? 3.6 : charging ? 2.6 + Math.sin(arenaTime * 22) * 0.5 : 2.2);
    const grd = ctx.createRadialGradient(cx, cy, ARENA.rEvent * 0.5, cx, cy, glowR);
    grd.addColorStop(0, active ? "rgba(255,120,40,0.95)" : "rgba(255,140,60,0.7)");
    grd.addColorStop(1, "rgba(255,80,30,0)");
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, TAU); ctx.fill();

    // swirling accretion streaks spiralling around the hole
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-(arenaTime * 0.9 + intro * 3));   // counter-clockwise swirl
    ctx.strokeStyle = "rgba(255,120,40,0.5)";
    ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, ARENA.rEvent * (1.45 + k * 0.55), k * 2.1, k * 2.1 + 2.3);
      ctx.stroke();
    }
    ctx.restore();

    // photon ring + event horizon
    ctx.strokeStyle = "rgba(255,232,205,0.9)"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rEvent * 1.08, 0, TAU); ctx.stroke();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(cx, cy, ARENA.rEvent, 0, TAU); ctx.fill();

    // supernova: swelling star + gap telegraph, then the expanding shockwave
    if (ORB().novas && nova) drawNova(cx, cy);

    // debris — warning pulse at the rim, then the falling rock
    for (const d of debris) {
      const ex = cx + Math.cos(d.ang) * d.r, ey = cy + Math.sin(d.ang) * d.r;
      if (d.warn > 0) {
        const p = 0.5 + 0.5 * Math.sin(d.warn * 22);
        ctx.strokeStyle = `rgba(255,90,60,${0.4 + p * 0.5})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(ex, ey, d.size + 5 + p * 5, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = "#8a8398";
        ctx.beginPath(); ctx.arc(ex, ey, d.size, 0, TAU); ctx.fill();
      }
    }

    // coins
    for (const c of coins) {
      if (c.taken) continue;
      glowCircle(cx + Math.cos(c.ang) * c.r, cy + Math.sin(c.ang) * c.r, 7, "#ffd84d");
    }

    // repositioning portals
    if (ORB().whArena) for (const w of wormholes) drawWormholeArena(w);

    // pull / repel indicator (toward or away from the hole)
    const color = orbColor();
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

    // dark vignette to close the edges in (oppressive)
    const vg = ctx.createRadialGradient(cx, cy, 130, cx, cy, 330);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(-12, -12, W + 24, H + 24);

    // surge screen tint
    if (active) {
      ctx.fillStyle = "rgba(255,60,30,0.12)";
      ctx.fillRect(-12, -12, W + 24, H + 24);
    }
  }

  // Orbital 10: the nova — gold-white swell + dashed safe-wedge telegraph
  // while charging (distinct from the surge's red), then the shockwave arc
  // stroked over the DEADLY span so the gap reads as the dark notch.
  function drawNova(cx, cy) {
    if (nova.phase === "charge") {
      const p = 0.5 + 0.5 * Math.sin(nova.t * 30);
      const r = ARENA.rEvent * (1.6 + p * 0.8);
      const g = ctx.createRadialGradient(cx, cy, ARENA.rEvent * 0.4, cx, cy, r * 1.6);
      g.addColorStop(0, "rgba(255,243,192,0.95)");
      g.addColorStop(1, "rgba(255,200,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, TAU); ctx.fill();
      ctx.save();
      ctx.globalAlpha = 0.25 + p * 0.35;
      ctx.strokeStyle = "#9dffb0";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      for (const a of [nova.gapAng - nova.gapHalf, nova.gapAng + nova.gapHalf]) {
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * ARENA.rEvent, cy + Math.sin(a) * ARENA.rEvent);
        ctx.lineTo(cx + Math.cos(a) * ARENA.rArena, cy + Math.sin(a) * ARENA.rArena);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = "rgba(255,214,140,0.95)";
      ctx.lineWidth = NOVA_RING_TH * 2;
      ctx.shadowBlur = 18; ctx.shadowColor = "#ffb347";
      ctx.beginPath();
      ctx.arc(cx, cy, nova.r, nova.gapAng + nova.gapHalf, nova.gapAng - nova.gapHalf + TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  // Orbital 10: a polar portal pair — same visual language as the 2D rings.
  function drawWormholeArena(w) {
    const COL = "#b884ff";
    const pts = [[w.a1, w.r1], [w.a2, w.r2]].map(([a, r]) =>
      [ARENA.x + Math.cos(a) * r, ARENA.y + Math.sin(a) * r]);
    const active = w.age >= WH_TELEGRAPH;
    const fade = Math.min(1, w.life);        // fade out over the last second
    ctx.save();
    ctx.globalAlpha = (active ? 0.28 : 0.12) * fade;
    ctx.strokeStyle = COL; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke();
    ctx.restore();

    for (const [px, py] of pts) {
      if (!active) {
        const t = Math.min(1, w.age / WH_TELEGRAPH);
        ctx.save();
        ctx.globalAlpha = (0.15 + 0.35 * t) * fade;
        ctx.strokeStyle = COL; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, WH_R * t, 0, TAU); ctx.stroke();
        ctx.restore();
        continue;
      }
      const dim = (w.lock > 0 ? 0.4 : 1) * fade;
      ctx.save();
      ctx.globalAlpha = dim;
      ctx.strokeStyle = COL; ctx.lineWidth = 3;
      ctx.shadowBlur = 16; ctx.shadowColor = COL;
      ctx.beginPath(); ctx.arc(px, py, WH_R, 0, TAU); ctx.stroke();
      const a0 = w.age * 4;
      ctx.globalAlpha = dim * 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, WH_R * 0.55, a0, a0 + Math.PI * 1.2); ctx.stroke();
      ctx.restore();
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

    // wormhole ring pairs — basic projected rings (the WebGL engine draws the
    // real tori; without this the fallback had invisible-but-active portals)
    if (orbitalHasWormholes()) {
      for (const w of wormholes) {
        if (w.d < -0.5) continue;
        const wy = ORB().whY ? H / 2 + (w.ny || 0) * (H / 2) : ORB_Y;
        const active = w.age >= WH_TELEGRAPH;
        const dim = w.lock > 0 ? 0.35 : active ? 0.9 : 0.4;
        for (const cx of [w.xa, w.xb]) {
          const p = proj(cx, wy, w.d);
          ctx.save();
          ctx.globalAlpha = dim;
          ctx.strokeStyle = "#b884ff"; ctx.lineWidth = 2.5;
          ctx.shadowBlur = 12; ctx.shadowColor = "#b884ff";
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, WH_R * 1.4 * p.s), 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
      }
    }

    // orb (always at the camera plane)
    for (let i = 0; i < orb.trail.length; i++) {
      const a = (i + 1) / orb.trail.length;
      ctx.globalAlpha = a * 0.35;
      glowCircle(orb.trail[i].x, ORB_Y, ORB_R * (0.4 + a * 0.5), orbColor());
    }
    ctx.globalAlpha = 1;
    glowCircle(orb.x, ORB_Y, ORB_R, orbColor(), true);
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

  function drawWormhole(w) {
    const active = w.age >= WH_TELEGRAPH;
    const COL = "#b884ff";               // matched pair color → shows they're linked
    // faint link line between the two rings
    ctx.save();
    ctx.globalAlpha = active ? 0.28 : 0.12;
    ctx.strokeStyle = COL; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.moveTo(w.xa, w.y); ctx.lineTo(w.xb, w.y); ctx.stroke();
    ctx.restore();

    for (const cx of [w.xa, w.xb]) {
      if (!active) {
        // telegraph: a growing warning ring, no swirl yet
        const t = Math.min(1, w.age / WH_TELEGRAPH);
        ctx.save();
        ctx.globalAlpha = 0.15 + 0.35 * t;
        ctx.strokeStyle = COL; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, w.y, WH_R * t, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        continue;
      }
      const dim = w.lock > 0 ? 0.4 : 1;   // fade briefly after a jump
      ctx.save();
      ctx.globalAlpha = dim;
      ctx.strokeStyle = COL; ctx.lineWidth = 3;
      ctx.shadowBlur = 16; ctx.shadowColor = COL;
      ctx.beginPath(); ctx.arc(cx, w.y, WH_R, 0, Math.PI * 2); ctx.stroke();
      // rotating inner swirl arc
      const a0 = w.age * 4;
      ctx.globalAlpha = dim * 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, w.y, WH_R * 0.55, a0, a0 + Math.PI * 1.2); ctx.stroke();
      ctx.restore();
    }
  }

  // Orbital 8: one cosmic string — the full rotating line, its pivot node, and
  // a marker where it crosses the orb's row (the only place it can kill).
  function drawString(s) {
    const c = Math.cos(s.ang), sn = Math.sin(s.ang);
    const COL = "#ff5e7e";
    let alpha, width;
    if (s.phase === "fire") { alpha = 0.9; width = 3.5; }
    else if (s.phase === "charge") { alpha = 0.3 + 0.4 * (0.5 + 0.5 * Math.sin(s.t * 40)); width = 2; }
    else { alpha = 0.15; width = 1.5; }
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COL;
    ctx.lineWidth = width;
    if (s.phase !== "idle") { ctx.shadowBlur = 14; ctx.shadowColor = COL; }
    ctx.beginPath();
    ctx.moveTo(s.px - sn * 1500, s.py - c * 1500);
    ctx.lineTo(s.px + sn * 1500, s.py + c * 1500);
    ctx.stroke();
    // pivot node (the spacetime defect the line spins around)
    ctx.shadowBlur = 10; ctx.shadowColor = "#ffffff";
    ctx.globalAlpha = Math.min(1, alpha + 0.25);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(s.px, s.py, 4, 0, TAU); ctx.fill();
    // row-crossing marker: exactly where the beam can hit you
    const xh = stringXHit(s);
    if (s.phase !== "idle" && xh > 0 && xh < W) {
      ctx.globalAlpha = s.phase === "fire" ? 0.95 : 0.6;
      ctx.shadowBlur = 14; ctx.shadowColor = COL;
      ctx.fillStyle = s.phase === "fire" ? "#ffffff" : COL;
      ctx.beginPath(); ctx.arc(xh, ORB_Y, s.phase === "fire" ? 7 : 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
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
    // transition fly-in / intro runs on real time (independent of slow-mo)
    if (mode === "3d" && intro < 1) intro = Math.min(1, intro + dt / 4.0);
    else if (ORB().arena && intro < 1) intro = Math.min(1, intro + dt / 2.0);

    // Countdown before a new orbital: freeze gameplay, let the intro/camera
    // play, show 3-2-1, then release into play.
    if (countdown > 0) {
      countdown = Math.max(0, countdown - dt);
      updateCountdownUI();
      draw();
      rafId = requestAnimationFrame(loop);
      return;
    }
    updateCountdownUI();

    if (frozen) { draw(); rafId = requestAnimationFrame(loop); return; }   // shot-mode freeze

    update(dt * timeScale);       // global pace multiplier
    if (running) draw();
    rafId = requestAnimationFrame(loop);
  }

  let lastCd = -1;
  function updateCountdownUI() {
    const el = document.getElementById("countdown");
    if (!el) return;
    const n = countdown > 0 ? Math.ceil(countdown) : 0;
    if (n === lastCd) return;
    lastCd = n;
    if (n > 0) {
      el.textContent = n;
      el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
    } else {
      el.classList.remove("show");
    }
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
    if (invuln > 0) return;          // protected right after a continue
    running = false;
    shake = settings.reduceMotion ? 4 : 10;
    draw();
    cancelAnimationFrame(rafId);
    pauseBtn.classList.remove("show");
    sfx("crash");
    buzz("heavy");
    showContinue();                  // offer a continue before finalizing
  }

  // ---- Continue / Shop -----------------------------------------------------
  function coinsNow() { return window.TidalStore ? TidalStore.getCoins() : 0; }
  function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt; }

  function showContinue() {
    overlay.classList.add("hidden");
    hideScreens();
    // Record best now (running max) so the death screen can show "New Best!".
    const newBest = !devMode && score > best;
    if (newBest) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = best;
    }
    setText("continue-score", newBest ? `Score ${score} — New Best!` : `Score ${score} · Best ${best}`);
    showContinueConfirm(false);
    refreshContinue();
    screens.continue.classList.remove("hidden");
  }
  function refreshContinue() {
    const cost = continueCost();
    const coinsBtn = document.getElementById("cont-coins");
    if (coinsBtn) { coinsBtn.textContent = `Continue — ${cost} coins`; coinsBtn.disabled = coinsNow() < cost; }
    const adBtn = document.getElementById("cont-ad");
    if (adBtn) adBtn.hidden = adUsed || !window.TidalStore;   // one free ad-continue per run
    // Runs begun via "Start From" get a restart-there button; the plain
    // start-over is then relabeled so the two aren't ambiguous.
    const ro = document.getElementById("cont-restart-orbital");
    const started = runStartOrbital > 1;
    if (ro) { ro.hidden = !started; ro.textContent = `Restart at ${ORBITAL_LABEL[runStartOrbital]}`; }
    const so = document.getElementById("cont-startover");
    if (so) so.textContent = started ? "Start from Orbital I" : "Start Over";
    setText("coin-balance", coinsNow() + " coins");
  }
  // Toggle between the choice buttons and the "spend coins?" confirmation.
  function showContinueConfirm(on) {
    ["cont-ad", "cont-coins", "cont-restart-orbital", "cont-startover", "cont-menu"].forEach((id) => {
      const el = document.getElementById(id); if (el) el.hidden = on;
    });
    if (!on) {
      const ad = document.getElementById("cont-ad"); if (ad) ad.hidden = adUsed || !window.TidalStore;
      const ro = document.getElementById("cont-restart-orbital"); if (ro) ro.hidden = runStartOrbital <= 1;
    }
    ["cont-confirm-text", "cont-yes", "cont-no"].forEach((id) => {
      const el = document.getElementById(id); if (el) el.hidden = !on;
    });
    if (on) setText("cont-confirm-text", `Spend ${continueCost()} coins to continue?`);
  }

  function doContinue() {
    screens.continue.classList.add("hidden");
    invuln = 2.0;                    // brief grace after the revive countdown
    enterOrbital(orbital);           // rebuild the current orbital cleanly + 3-2-1
    diffFloor = CONTINUE_DIFF_FLOOR; // resume at 25% speed, not a full crawl (enterOrbital cleared it)
    resume();
  }

  // The run has truly ended (submit to the leaderboard when it's live).
  function finalizeRun() {
    if (!devMode && window.TidalGC) TidalGC.submit(score);
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
    refreshCoinsUI();
  }

  function refreshToggles() {
    document.querySelectorAll(".toggle").forEach((t) => {
      t.classList.toggle("on", !!settings[t.dataset.setting]);
    });
  }

  // ---- Input ---------------------------------------------------------------
  function flip() {
    if (!running || countdown > 0) return;   // can't steer during the countdown
    gravSide *= -1;
    // Shed some momentum on flip so the reversal registers immediately,
    // making the back-and-forth feel reactive rather than floaty.
    if (ORB().arena) {
      orb.vrho *= 0.5;       // arena: shed radial momentum for a responsive sway
    } else {
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
  startBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!paused) { devMode = false; }   // "Play again" = fresh ranked run
    primaryAction();
  });
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); goMenu(); });
  pauseBtn.addEventListener("click", (e) => { e.stopPropagation(); pauseGame(); });

  // Title / How-to / Settings navigation
  document.querySelectorAll("[data-action]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = b.dataset.action;
      if (a === "play") { devMode = false; start(); }
      else if (a === "startfrom") showStartFrom();
      else if (a === "shop") { refreshShop(); showScreen("shop"); }
      else if (a === "howto") showScreen("howto");
      else if (a === "settings") { refreshToggles(); showScreen("settings"); }
      else if (a === "back") { showScreen("title"); refreshCoinsUI(); }
      else if (a === "leaderboard") { if (window.TidalGC) TidalGC.show(); }
    });
  });

  // Continue-screen buttons
  document.querySelectorAll("[data-cont]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const a = b.dataset.cont;
      if (a === "ad") {
        // One free continue per run via a rewarded ad.
        if (adUsed || !window.TidalStore) return;
        b.disabled = true;
        TidalStore.watchAd().then((ok) => {
          b.disabled = false;
          if (ok) { adUsed = true; continues++; doContinue(); }
        });
      } else if (a === "coins") {
        // First tap asks for confirmation (so coins aren't spent by accident).
        if (coinsNow() >= continueCost()) showContinueConfirm(true);
      } else if (a === "confirm-yes") {
        if (window.TidalStore && TidalStore.spendCoins(continueCost())) { continues++; doContinue(); }
        else showContinueConfirm(false);
      } else if (a === "confirm-no") {
        showContinueConfirm(false);
      } else if (a === "restart-orbital") {
        finalizeRun();                 // submit the ended run's score first
        screens.continue.classList.add("hidden");
        startFrom(runStartOrbital);
      } else if (a === "startover") {
        finalizeRun();
        screens.continue.classList.add("hidden");
        start();
      } else if (a === "menu") {
        finalizeRun();
        goMenu();
      } else if (a === "leaderboard") {
        if (window.TidalGC) TidalGC.show();
      }
    });
  });

  function refreshCoinsUI() {
    const prem = window.TidalStore && TidalStore.hasPremium();
    setText("title-coins", coinsNow() + " coins" + (prem ? " · 2×" : ""));
    const sf = document.getElementById("btn-startfrom");
    if (sf) sf.hidden = unlocked < 2;        // unlocks after you first reach orbital 2 (score 100)
  }

  function refreshShop() {
    const owned = window.TidalStore && TidalStore.hasPremium();
    setText("shop-balance", coinsNow() + " coins" + (owned ? " · Premium 2× active" : ""));
    const u = document.getElementById("shop-premium");
    if (u) {
      u.textContent = owned ? "Tidal Premium — Owned ✓" : "Tidal Premium — 2× Coins";
      u.disabled = !!owned;
      u.classList.toggle("owned", !!owned);
    }
    const err = window.TidalStore && TidalStore.lastError && TidalStore.lastError();
    setText("shop-status", err ? "Store: " + err : "");
  }

  // Shop buttons (purchases are async via RevenueCat)
  document.querySelectorAll("[data-shop]").forEach((b) => {
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!window.TidalStore) return;
      const a = b.dataset.shop;
      if (a === "premium" && TidalStore.hasPremium()) { refreshShop(); return; }  // already owned
      b.disabled = true;
      const done = () => { b.disabled = false; refreshShop(); refreshCoinsUI(); };
      if (a === "premium") TidalStore.buyPremium().then(done);
      else if (a === "coins200") TidalStore.buyCoins(200).then(done);
      else if (a === "coins500") TidalStore.buyCoins(500).then(done);
      else if (a === "coins800") TidalStore.buyCoins(800).then(done);
      else if (a === "restore") TidalStore.restore().then(done);
    });
  });

  // The store syncs entitlements asynchronously (boot, purchase, restore) —
  // re-render the premium/coin UI whenever that lands.
  window.addEventListener("tidal-premium-change", () => { refreshShop(); refreshCoinsUI(); });

  // ---- Start From: begin your run at any orbital you've reached ------------
  function showStartFrom() {
    const list = document.getElementById("startfrom-list");
    if (list) {
      list.innerHTML = "";
      for (let n = 1; n <= unlocked; n++) {
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = ORBITAL_LABEL[n];
        btn.addEventListener("click", (ev) => { ev.stopPropagation(); startFrom(n); });
        list.appendChild(btn);
      }
    }
    showScreen("startfrom");
  }

  function startFrom(n) {
    devMode = false;
    reset(ORBITALS[n - 1].dim);
    runStartOrbital = n;
    score = orbitalThreshold(n);            // your journey resumes at this orbital's score
    scoreEl.textContent = score;
    resume();
    enterOrbital(n);
  }

  // Pose a scene for App Store screenshots (?shot=N): set score/best/orbital,
  // skip the countdown, and disable death so you can frame the shot.
  function setupShot(s) {
    devMode = true;
    reset(ORBITALS[s.orbital - 1].dim);
    shotMode = true;
    best = s.best; bestEl.textContent = best;
    score = s.score; scoreEl.textContent = score;
    resume();
    enterOrbital(s.orbital);
    countdown = 0;                          // no 3-2-1
    invuln = 1e9;                           // never die
    score = s.score; scoreEl.textContent = score;
  }

  // Leaderboard button on the game-over / pause overlay
  const lbOver = document.getElementById("lb-over");
  if (lbOver) lbOver.addEventListener("click", (e) => { e.stopPropagation(); if (window.TidalGC) TidalGC.show(); });

  // Reveal leaderboard buttons only where Game Center exists (the native app)
  if (window.TidalGC && TidalGC.available()) {
    ["lb-title", "lb-over", "cont-lb"].forEach((id) => {
      const el = document.getElementById(id); if (el) el.hidden = false;
    });
  }


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
    if ((e.key === "f" || e.key === "F") && shotMode) frozen = !frozen;   // freeze/unfreeze for screenshots
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
  refreshCoinsUI();
  // ?shot=N → posed screenshot scene. Wait for `load` so the WebGL engine
  // module (deferred) is ready, otherwise 3D orbitals fall back to canvas.
  if (SHOT && SHOTS[SHOT]) window.addEventListener("load", () => setupShot(SHOTS[SHOT]));
  // ?screen=shop → open that screen directly (for screenshots / testing).
  if (params.get("screen") === "shop") window.addEventListener("load", () => { refreshShop(); showScreen("shop"); });

  // ---- PWA registration ----------------------------------------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
