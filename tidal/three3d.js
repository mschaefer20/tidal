/* Tidal 3D engine — ANIME CYBERPUNK style.
   A painterly dusk sky with a distant city skyline + moon, soft cel-shaded
   surfaces with clean dark ink outlines, muted colors and gentle atmospheric
   haze. Restrained bloom — mood over flash. game.js owns the simulation; this
   module only RENDERS the state it's handed each frame (window.Tidal3D).
   If anything here fails to load, game.js falls back to its canvas renderer. */

import * as THREE from "./vendor/three.module.js";
import { EffectComposer } from "./vendor/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "./vendor/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "./vendor/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "./vendor/jsm/postprocessing/OutputPass.js";

// Muted dusk palette (gravity sides).
const ROSE = new THREE.Color(0xe08aa0);
const TEAL = new THREE.Color(0x6fc6cf);
const INK = 0x14132a;

const HALFW = 5;
const FY = 4.6;
const DZ = 4.6;
const BAR_POOL = 16;
const BONUS_POOL = 10;
const GS = 4;
const GN = 46;

let renderer, scene, camera, composer, bloom;
let orbMesh, orbLight, leftLight, rightLight;
let floorGrid, ceilGrid;
let wellL, wellR, pullLine;   // Orbital 4: visible gravity wells + pull line
const UP = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
let barPool = [], bonusPool = [];
let toonMap;
let inited = false;

// ---- cel-shading helpers -------------------------------------------------
function makeToonMap() {
  // soft 3-tone ramp for an anime cel look
  const steps = new Uint8Array([110,110,110,255, 180,180,180,255, 255,255,255,255]);
  const t = new THREE.DataTexture(steps, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

function toonMat(color, emissive, eInt) {
  return new THREE.MeshToonMaterial({
    color, gradientMap: toonMap,
    emissive: emissive || 0x000000, emissiveIntensity: eInt || 0,
  });
}

// dark inverted-hull outline (anime ink line)
function addOutline(mesh, scale) {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  o.scale.setScalar(scale);
  mesh.add(o);
  return o;
}

function inkEdges(geo) {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: INK }));
}

// Painted deep-space backdrop: high-res starfield, layered wispy nebula,
// and a single dramatic black hole. Rendered once at 1024² for crisp detail.
function makeSkyTexture() {
  const S = 2048;
  const f = S / 1024;          // coords below were tuned at 1024²
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");

  // deep space base
  const grad = g.createLinearGradient(0, 0, 0, S);
  grad.addColorStop(0.0, "#04040b");
  grad.addColorStop(0.5, "#070617");
  grad.addColorStop(1.0, "#0c0820");
  g.fillStyle = grad; g.fillRect(0, 0, S, S);

  // nebula — broad colour washes, then fine wispy structure layered on top
  g.globalCompositeOperation = "lighter";
  const clouds = [
    [300, 380, 520, "120,40,150"],
    [760, 600, 470, "40,150,180"],
    [610, 240, 430, "90,50,200"],
    [430, 770, 440, "190,60,120"],
  ].map(([x, y, r, col]) => [x * f, y * f, r * f, col]);
  for (const [cx, cy, r, col] of clouds) {
    const neb = g.createRadialGradient(cx, cy, 12, cx, cy, r);
    neb.addColorStop(0, `rgba(${col},0.20)`);
    neb.addColorStop(0.5, `rgba(${col},0.07)`);
    neb.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = neb; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 160; i++) {
    const base = clouds[i % clouds.length];
    const ang = Math.random() * Math.PI * 2, rad = Math.random() * base[2] * 0.85;
    const x = base[0] + Math.cos(ang) * rad, y = base[1] + Math.sin(ang) * rad * 0.7;
    const r = 24 + Math.random() * 80;
    const a = 0.012 + Math.random() * 0.03;
    const bl = g.createRadialGradient(x, y, 0, x, y, r);
    bl.addColorStop(0, `rgba(${base[3]},${a})`);
    bl.addColorStop(1, `rgba(${base[3]},0)`);
    g.fillStyle = bl; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = "source-over";

  // stars — round, varied colour temperature, size and brightness;
  // the brightest get a soft halo so they read as point lights, not pixels
  const starCols = ["255,255,255", "201,221,255", "255,236,212", "187,205,255", "255,214,196"];
  for (let i = 0; i < 540; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const col = starCols[(Math.random() * starCols.length) | 0];
    const mag = Math.random();
    const r = (mag > 0.97 ? 2.4 + Math.random() * 1.8 : 0.5 + mag * 1.3) * f;
    if (mag > 0.92) {
      const h = g.createRadialGradient(x, y, 0, x, y, r * 6);
      h.addColorStop(0, `rgba(${col},0.55)`);
      h.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = h; g.beginPath(); g.arc(x, y, r * 6, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = `rgba(${col},${0.35 + mag * 0.6})`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  drawBlackHole(g, S * 0.5, S * 0.43, 0.068 * S);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Stylized black hole: glow, edge-on accretion disk, event horizon, photon
// ring, and the far side of the disk lensed up over the top.
function drawBlackHole(g, cx, cy, rH) {
  g.save();
  g.translate(cx, cy);

  // outer gravitational glow
  const glow = g.createRadialGradient(0, 0, rH, 0, 0, rH * 4.2);
  glow.addColorStop(0, "rgba(150,120,220,0.22)");
  glow.addColorStop(1, "rgba(150,120,220,0)");
  g.fillStyle = glow; g.beginPath(); g.arc(0, 0, rH * 4.2, 0, Math.PI * 2); g.fill();

  g.rotate(-0.32);

  // accretion disk (flattened bright ring), additive for hot glow
  g.globalCompositeOperation = "lighter";
  g.save(); g.scale(1, 0.34);
  const disk = g.createRadialGradient(0, 0, rH * 0.95, 0, 0, rH * 2.7);
  disk.addColorStop(0, "rgba(255,255,255,0)");
  disk.addColorStop(0.16, "rgba(255,252,225,0.95)");
  disk.addColorStop(0.4, "rgba(255,150,55,0.85)");
  disk.addColorStop(0.7, "rgba(220,70,40,0.4)");
  disk.addColorStop(1, "rgba(160,30,30,0)");
  g.fillStyle = disk; g.beginPath(); g.arc(0, 0, rH * 2.7, 0, Math.PI * 2); g.fill();
  g.restore();
  g.globalCompositeOperation = "source-over";

  // event horizon
  g.fillStyle = "#000"; g.beginPath(); g.arc(0, 0, rH, 0, Math.PI * 2); g.fill();

  // photon ring
  g.lineWidth = Math.max(1.5, rH * 0.09);
  g.strokeStyle = "rgba(255,235,200,0.95)";
  g.beginPath(); g.arc(0, 0, rH * 1.07, 0, Math.PI * 2); g.stroke();

  // lensed far side of the disk arcing over the top
  g.globalCompositeOperation = "lighter";
  g.lineWidth = rH * 0.55;
  g.strokeStyle = "rgba(255,170,80,0.55)";
  g.beginPath(); g.ellipse(0, 0, rH * 1.85, rH * 1.0, 0, Math.PI * 1.08, Math.PI * 1.92); g.stroke();
  g.lineWidth = rH * 0.22;
  g.strokeStyle = "rgba(255,240,210,0.7)";
  g.beginPath(); g.ellipse(0, 0, rH * 1.7, rH * 0.9, 0, Math.PI * 1.12, Math.PI * 1.88); g.stroke();
  g.globalCompositeOperation = "source-over";

  g.restore();
}

function buildGrid(color, y) {
  const pts = [];
  const hx = HALFW + 1.5;
  const zEnd = -GN * GS;
  for (let xi = -4; xi <= 4; xi++) { const x = (xi / 4) * hx; pts.push(x, y, GS, x, y, zEnd); }
  for (let i = 0; i <= GN; i++) { const z = -i * GS; pts.push(-hx, y, z, hx, y, z); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.18 }));
  return lines;
}

function makeBlock() {
  const geo = new THREE.BoxGeometry(1, 1, 0.7);
  const mesh = new THREE.Mesh(geo, toonMat(0x3c4a72, 0x222b45, 0.12));
  mesh.material.transparent = true;
  mesh.material.depthWrite = false;   // so a faded near wall doesn't hide the next one
  mesh.add(inkEdges(geo));     // clean ink outline (stays visible to show the gap)
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
}

const api = {
  ready: false,

  init(canvas, w, h) {
    if (inited) return true;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
    renderer.setSize(w, h, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    toonMap = makeToonMap();

    scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    scene.fog = new THREE.Fog(0x070617, 38, 150);   // dark-space haze

    // Environment map from the sky so the orb has real reflections.
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(scene).texture;
    pmrem.dispose();

    camera = new THREE.PerspectiveCamera(68, w / h, 0.1, 400);
    camera.position.set(0, 0.9, 9);

    // soft anime lighting: cool sky / warm ground + a gentle warm key
    scene.add(new THREE.HemisphereLight(0x4a5aa0, 0x100c22, 1.0));
    const key = new THREE.DirectionalLight(0xcfe0ff, 1.05);
    key.position.set(0.4, 1, 0.8);
    scene.add(key);
    leftLight = new THREE.PointLight(ROSE, 12, 55, 1.6); leftLight.position.set(-9, 0, 3);
    rightLight = new THREE.PointLight(TEAL, 12, 55, 1.6); rightLight.position.set(9, 0, 3);
    scene.add(leftLight, rightLight);

    // restrained grid floor + ceiling, swallowed by the haze
    floorGrid = buildGrid(0x8a6fb0, -FY);
    ceilGrid = buildGrid(0x5f86b0, FY);
    scene.add(floorGrid, ceilGrid);

    // the orb — a real, glossy 3D sphere (physical shading + reflections),
    // kept inside the anime scene by its soft color and gentle glow.
    orbMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.62, 64, 64),
      new THREE.MeshPhysicalMaterial({
        color: 0x2a3a55, metalness: 0.15, roughness: 0.5,
        clearcoat: 0.2, clearcoatRoughness: 0.5,
        emissive: TEAL, emissiveIntensity: 0.3, envMapIntensity: 0.65,
      })
    );
    scene.add(orbMesh);
    orbLight = new THREE.PointLight(TEAL, 6, 18, 2);
    orbMesh.add(orbLight);

    // Orbital 4: the two oscillating gravity wells + a pull line to the active one
    const wellGeo = new THREE.SphereGeometry(0.62, 24, 24);
    wellL = new THREE.Mesh(wellGeo, new THREE.MeshStandardMaterial({ color: 0x3a1020, emissive: 0xff5e7e, emissiveIntensity: 1.0 }));
    wellR = new THREE.Mesh(wellGeo, new THREE.MeshStandardMaterial({ color: 0x0a2230, emissive: 0x4dd2ff, emissiveIntensity: 1.0 }));
    wellL.visible = wellR.visible = false;
    scene.add(wellL, wellR);
    // pull "beam": a thin bright white core inside a soft additive colour glow
    // (bloom turns this into a lightsaber-like shaft)
    pullLine = new THREE.Group();
    const beamCore = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    const beamGlow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 1, 16),
      new THREE.MeshBasicMaterial({ color: 0x4dd2ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    pullLine.add(beamCore, beamGlow);
    pullLine.userData.glow = beamGlow.material;
    pullLine.visible = false;
    scene.add(pullLine);

    for (let i = 0; i < BAR_POOL; i++) barPool.push({ left: makeBlock(), right: makeBlock() });

    // bonus coins — 3D gold discs in the same soft (non-glossy) finish as the orb
    const coinGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.09, 30);
    coinGeo.rotateX(Math.PI / 2);   // face the camera; spins on Y like a collectible
    for (let i = 0; i < BONUS_POOL; i++) {
      const m = new THREE.Mesh(
        coinGeo,
        new THREE.MeshStandardMaterial({
          color: 0xf2c14e, metalness: 0.55, roughness: 0.45,
          emissive: 0xe7b94d, emissiveIntensity: 0.22, envMapIntensity: 0.65,
        })
      );
      m.visible = false;
      scene.add(m);
      bonusPool.push(m);
    }

    composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());   // render passes at full res, no upscaling
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.45, 0.6); // subtle
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    inited = true;
    api.ready = true;
    return true;
  },

  resize(w, h) {
    if (!inited) return;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
  },

  reset() {
    for (const b of barPool) { b.left.visible = false; b.right.visible = false; }
    for (const m of bonusPool) m.visible = false;
  },

  render(s) {
    if (!inited) return;
    const side = s.gravSide > 0 ? TEAL : ROSE;

    leftLight.intensity = s.gravSide < 0 ? 20 : 5;
    rightLight.intensity = s.gravSide > 0 ? 20 : 5;
    orbMesh.material.emissive.copy(side);
    orbMesh.material.color.copy(side).multiplyScalar(0.45);
    orbLight.color.copy(side);
    orbMesh.position.set(s.orbNX * HALFW, (s.orbNY || 0) * FY, 0);   // orbNY drives Orbital 4's vertical drift

    // Orbital 4: show the two gravity wells + a line to the active one
    if (s.wellL) {
      const lx = s.wellL.x * HALFW, ly = s.wellL.y * FY;
      const rx = s.wellR.x * HALFW, ry = s.wellR.y * FY;
      wellL.position.set(lx, ly, 0);
      wellR.position.set(rx, ry, 0);
      wellL.visible = wellR.visible = true;
      wellL.material.emissiveIntensity = s.gravSide < 0 ? 2.0 : 0.55;
      wellR.material.emissiveIntensity = s.gravSide > 0 ? 2.0 : 0.55;
      const ax = s.gravSide > 0 ? rx : lx, ay = s.gravSide > 0 ? ry : ly;
      const ox = s.orbNX * HALFW, oy = (s.orbNY || 0) * FY;
      const dx2 = ax - ox, dy2 = ay - oy;
      const dlen = Math.hypot(dx2, dy2) || 0.001;
      pullLine.position.set((ox + ax) / 2, (oy + ay) / 2, 0);
      pullLine.scale.set(1, dlen, 1);
      pullLine.quaternion.setFromUnitVectors(UP, _dir.set(dx2 / dlen, dy2 / dlen, 0));
      pullLine.userData.glow.color.set(s.gravSide > 0 ? 0x4dd2ff : 0xff5e7e);
      pullLine.visible = true;
    } else if (wellL) {
      wellL.visible = wellR.visible = pullLine.visible = false;
    }

    // intro fly-in — slow, cinematic rush from deep space into the tunnel
    const ip = Math.min(1, s.intro);
    const e = ip < 0.5 ? 4 * ip * ip * ip : 1 - Math.pow(-2 * ip + 2, 3) / 2; // easeInOutCubic
    camera.position.z = (s.reduceMotion ? 16 : 54) - (s.reduceMotion ? 7 : 45) * e;
    camera.position.x = 0;           // locked: tunnel stays fixed, only the orb moves
    camera.position.y = 0.6;
    if (s.orbital >= 5 && !s.reduceMotion) {   // black-hole gravitational tremor
      camera.position.x += (Math.random() - 0.5) * 0.13;
      camera.position.y += (Math.random() - 0.5) * 0.13;
    }
    camera.lookAt(0, -0.3, -6);
    if (scene.fog) scene.fog.color.set(s.orbital >= 5 ? 0x1a0509 : 0x070617);  // boss runs blood-red
    const orbitalGlow = (s.orbital >= 4 ? 0.18 : 0) + (s.orbital >= 5 ? 0.18 : 0);
    bloom.strength = 0.32 + orbitalGlow + (s.reduceMotion ? 0 : (1 - e) * 0.8); // glow rises with orbital + warp

    const gz = (s.travel * DZ) % GS;
    floorGrid.position.z = gz;
    ceilGrid.position.z = gz;

    for (let i = 0; i < barPool.length; i++) {
      const b = barPool[i], data = s.bars[i];
      if (!data) { b.left.visible = false; b.right.visible = false; continue; }
      const z = -data.d * DZ;
      const op = Math.max(0.12, Math.min(1, data.d / 2.2));   // fade as it nears the camera
      placeBlock(b.left, -HALFW, (data.cx - data.half) * HALFW, z, op);
      placeBlock(b.right, (data.cx + data.half) * HALFW, HALFW, z, op);
    }

    for (let i = 0; i < bonusPool.length; i++) {
      const m = bonusPool[i], data = s.bonuses[i];
      if (!data) { m.visible = false; continue; }
      m.visible = true;
      m.position.set(data.nx * HALFW, 0, -data.d * DZ);
      m.rotation.y += 0.06;
    }

    composer.render();
  },
};

function placeBlock(block, x0, x1, z, op) {
  const w = x1 - x0;
  if (w <= 0.06) { block.visible = false; return; }
  block.visible = true;
  block.position.set((x0 + x1) / 2, 0, z);
  block.scale.set(w, FY * 2, 0.7);
  block.material.opacity = op;
}

window.Tidal3D = api;
