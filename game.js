/* Neon Snake — a small, dependency-free canvas game.
   Structured so the core logic (createGame) is separable from
   the DOM/render layer, which makes it easy to port into a
   native shell (Capacitor / Electron / Tauri) later. */

(() => {
  "use strict";

  const GRID = 20;            // cells per side
  const TICK_START = 140;     // ms per step at start
  const TICK_MIN = 70;        // fastest speed
  const SPEED_STEP = 3;       // ms shaved off per food eaten

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const startBtn = document.getElementById("start-btn");

  const cell = canvas.width / GRID;

  // ---- Game state ----------------------------------------------------------
  let snake, dir, nextDir, food, score, tickMs, running, lastStep, rafId;

  const BEST_KEY = "neon-snake-best";
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = best;

  function reset() {
    snake = [{ x: 9, y: 10 }, { x: 8, y: 10 }, { x: 7, y: 10 }];
    dir = { x: 1, y: 0 };
    nextDir = dir;
    score = 0;
    tickMs = TICK_START;
    placeFood();
    scoreEl.textContent = score;
  }

  function placeFood() {
    let p;
    do {
      p = { x: rand(GRID), y: rand(GRID) };
    } while (snake.some((s) => s.x === p.x && s.y === p.y));
    food = p;
  }

  function rand(n) { return Math.floor(Math.random() * n); }

  // ---- Core step -----------------------------------------------------------
  function step() {
    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    const hitWall = head.x < 0 || head.y < 0 || head.x >= GRID || head.y >= GRID;
    const hitSelf = snake.some((s) => s.x === head.x && s.y === head.y);
    if (hitWall || hitSelf) return gameOver();

    snake.unshift(head);

    if (head.x === food.x && head.y === food.y) {
      score++;
      scoreEl.textContent = score;
      tickMs = Math.max(TICK_MIN, tickMs - SPEED_STEP);
      placeFood();
    } else {
      snake.pop();
    }
  }

  // ---- Rendering -----------------------------------------------------------
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // food
    drawCell(food.x, food.y, "#ff2d75", true);

    // snake
    for (let i = snake.length - 1; i >= 0; i--) {
      const t = 1 - i / snake.length;
      const color = mix([0, 229, 255], [57, 255, 20], t);
      drawCell(snake[i].x, snake[i].y, color, i === 0);
    }
  }

  function drawCell(x, y, color, glow) {
    const pad = 1.5;
    ctx.fillStyle = color;
    ctx.shadowBlur = glow ? 16 : 0;
    ctx.shadowColor = color;
    roundRect(x * cell + pad, y * cell + pad, cell - pad * 2, cell - pad * 2, 4);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function mix(a, b, t) {
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  // ---- Loop ----------------------------------------------------------------
  function loop(now) {
    if (!running) return;
    if (now - lastStep >= tickMs) {
      lastStep = now;
      step();
    }
    draw();
    rafId = requestAnimationFrame(loop);
  }

  function start() {
    reset();
    running = true;
    lastStep = performance.now();
    overlay.classList.add("hidden");
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function gameOver() {
    running = false;
    cancelAnimationFrame(rafId);
    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = best;
    }
    overlayTitle.textContent = "Game Over";
    overlayText.textContent = `You scored ${score}. ${score >= best ? "New best!" : ""}`;
    startBtn.textContent = "Play again";
    overlay.classList.remove("hidden");
  }

  // ---- Input ---------------------------------------------------------------
  function setDir(x, y) {
    // prevent reversing directly into self
    if (x === -dir.x && y === -dir.y) return;
    nextDir = { x, y };
  }

  const KEYMAP = {
    ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
    ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
    ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
    ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
  };

  window.addEventListener("keydown", (e) => {
    const m = KEYMAP[e.key];
    if (m) { e.preventDefault(); setDir(m[0], m[1]); }
    if ((e.key === " " || e.key === "Enter") && !running) start();
  });

  // On-screen d-pad
  document.querySelectorAll(".dpad").forEach((b) => {
    b.addEventListener("click", () => {
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[b.dataset.dir];
      setDir(d[0], d[1]);
    });
  });

  // Swipe on the canvas
  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    touchStart = e.touches[0];
  }, { passive: true });
  canvas.addEventListener("touchmove", (e) => {
    if (!touchStart) return;
    const dx = e.touches[0].clientX - touchStart.clientX;
    const dy = e.touches[0].clientY - touchStart.clientY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) setDir(Math.sign(dx), 0);
    else setDir(0, Math.sign(dy));
    touchStart = null;
  }, { passive: true });

  startBtn.addEventListener("click", start);

  // First paint
  reset();
  draw();

  // ---- PWA: register service worker for offline / installability ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
