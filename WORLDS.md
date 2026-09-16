# Tidal Orbit — Worlds (the next gameplay direction)

Status (2026-09-15): **design + working mock on branch `worlds`.** The world
model is implemented in `tidal/game.js`, the title screen has a world picker,
and all five Anomalies orbitals are playable as a PREVIEW. Nothing here has
shipped. Companion docs: `V1.2-ORBITALS.md` (how VI–X were designed),
`V3-ORBITALS-11-20.md` on branch `orbitals-11-20` (XI/XII, a possible source
of Anomalies orbitals).

## Why worlds

Origins (the shipped ten) is a single 900-point ladder. Only a handful of
hundreds of players have reached orbital X, so anything added on top of X is
content almost nobody sees, and the per-orbital speed ramp plus 100-point
spacing means "seeing more of the game" costs days or weeks of play.

Worlds fix the *access* problem without touching Origins:

- **Origins stays exactly as it is** — same ladder, thresholds, physics, and
  the existing `tidal_high_scores` leaderboard. No reset, no migration.
- **Every new world starts everyone at its orbital I.** New content is played
  by every user on day one instead of the five people who can reach X.
- **Each world has its own identity, best score, leaderboard and Start From
  progress**, so the ranked Origins ladder keeps its integrity while the game
  grows sideways.

## The model

A **World** is a named ladder of orbitals plus a few world-level settings.
Everything about a run is scoped to the active world.

| Field | Meaning | Origins | Anomalies |
| --- | --- | --- | --- |
| `id` / `name` | storage id, display name | `origins` / ORIGINS | `anomalies` / ANOMALIES |
| `tagline` | title-screen line under the picker | One button. Two gravities. | Gravity itself is unstable here. |
| `orbitals` | ordered table of capability-flag entries (same `ORB()` flag system as before) | the ten (unchanged) | I–V (mock) |
| `step` | points per orbital (thresholds are `step × (n−1)`) | 100 | **60** |
| `physics` | world-wide multipliers: `gravity` (pendulum pull), `gap` (barrier gap width) | — | gravity 0.85, gap 1.12 |
| `palette` | left/right planet + orb colors (2D canvas and WebGL) | pink / cyan | violet `#c77dff` / mint `#5cf2c0` |
| `leaderboard` | Game Center leaderboard id | `tidal_high_scores` | `tidal_anomalies` (to be created) |
| `bestKey` / `unlockKey` | localStorage keys for best score and Start From progress | `tidal-best` / `tidal-unlocked` (the pre-worlds keys) | `tidal-best-anomalies` / `tidal-unlocked-anomalies` |
| `mock` | shows the PREVIEW tag in the picker | — | true |

Shared across worlds on purpose: the coin wallet, continue costs, Premium,
settings. Splitting the economy would hurt more than it helps.

Orbital entries gained one optional field: `track` (fx.js music id). Origins
entries omit it and fall back to the orbital number, as before.

### Code map (branch `worlds`)

- `tidal/game.js` — `ORIGINS`/`ANOMALIES` tables, `WORLDS`, world selection
  (`?world=<id>` or persisted `tidal-world`), `setWorld()`/`cycleWorld()`/
  `refreshWorldUI()`, `gravMult()`/`fluxNow()`, `drawFlux()`/`drawFluxHalo()`,
  palette accessors `colLeft()`/`colRight()`. `orbitalThreshold()` reads
  `world.step`; `gapWidth()` and `stepOrb()` read `world.physics`.
- `tidal/index.html` — `.world-pick` (‹ NAME ›, sub-line, PREVIEW tag),
  `#title-tagline`.
- `tidal/style.css` — picker styles; `body[data-world="anomalies"]` retints
  `--left`/`--right` (logo, buttons, HUD title) and the board background.
- `tidal/fx.js` — `TRACKS[11]` (Anomalies I), `setOrbital()` looks tracks up
  by id.
- `tidal/gamecenter.js` — `submit(score, id)` / `show(id)` take a leaderboard
  id; default remains `tidal_high_scores`.
- `tidal/sw.js` — cache bumped to `tidal-v76`.

### UI

- Title screen: logo → **world picker** (‹ ORIGINS › with "Best 412 ·
  ORBITAL VII reached" or "10 orbitals") → the world's tagline → Play.
  Switching worlds retints the screen, reloads best/progress, redraws the
  idle board, and persists the choice.
- Shift banner shows the world name under "ORBITAL N".
- Death screen, Start From, and every Leaderboard button are scoped to the
  active world. The "Something is waiting at N…" tease uses the world's step
  and hides on single-orbital worlds.

### Leaderboards (App Store Connect, before Anomalies ships)

1. Create a **leaderboard set** (e.g. "Tidal Worlds") and move
   `tidal_high_scores` into it — existing scores are preserved.
2. Add `tidal_anomalies` (classic, high-score, integer) to the set, localize,
   attach to the version.
3. Android has no leaderboards in v1; nothing to do there.

## Anomalies — world two

**Similar theme, different gameplay, a little more forgiving.** Anomalies is
space where gravity itself misbehaves. Its identity is one signature twist
that runs through every orbital, the way wormholes defined Origins VI–X.

### Signature twist: Flux (chosen, built)

The pull strength **breathes** on a slow cycle — the tide rises and falls:

```
gravity × (1 + FLUX_AMP · sin(2π · t / FLUX_PERIOD))
```

| Tunable | Value | Note |
| --- | --- | --- |
| `FLUX_PERIOD` | 6.0 s | one full breath; ≈ 3 bars of track 11 (8 notes × 260 ms = 2.08 s/bar). Set to 6.24 to lock exactly to the music. |
| `FLUX_LOW` / `FLUX_HIGH` | 0.20 / 0.35 | asymmetric swing: 0.80× at low tide (floaty, never a crawl — user: "make the slowest not super slow"), 1.35× at high tide. Per-orbital `fluxLow`/`fluxHigh` override. |
| `FLUX_RAMP` | 4.0 s | amplitude eases in so an orbital never opens mid-surge; resets on every orbital entry and continue |

Read-out (both cues drawn in the world palette):

- **Wall glow** on both sides widens and brightens at high tide and almost
  vanishes at low tide. Gravity is global, so both walls breathe together;
  the active side glows a little stronger.
- **Orb halo** swells with the pull.

Why Flux over the alternatives considered:

| Candidate | What it is | Verdict |
| --- | --- | --- |
| **Flux** | global gravity oscillation | **Chosen.** Zero new geometry, works in 2D, 3D and the arena, one number (`FLUX_AMP`) turns it from gentle to brutal, and it is *Tidal* — the tide. |
| Magnetic gaps | gaps drift toward the orb (easier) or away (harder) | Very forgiving, but 2D-only and collides with Origins IV's gap drift. Keep as a per-orbital flag idea. |
| Charged gaps (Magnetar, built on `orbitals-11-20`) | color-keyed gaps only pass a matching orb | Strong per-orbital mechanic, weak world identity. Slot it INTO Anomalies as an orbital rather than as the twist. |

### Anomalies orbital I — "Flux" (the mock)

The plain 2D pendulum under the breathing pull, so the twist is learned clean
before anything is stacked on it. World physics make it a touch easier than
Origins I: 0.85× pull (floatier), 1.12× gap width, 60-point spacing. Music:
track 11, slow triangle-wave C lydian.

Play it: `http://localhost:8123/tidal/?world=anomalies` (title picker also
reaches it). `?probe` exposes `window.TidalProbe()` for headless tests.

What the mocks do NOT do yet:

- Flux drives the 2D pendulum (`stepOrb`, also the 3D tunnel's horizontal
  physics) and the arena's radial pull. Binary wells (`GRAVITY3`) don't read
  `gravMult()` yet — wire them if Anomalies ever gains that form.
- World `physics.gravity` likewise touches the pendulum and the arena only.
- No per-world "how to play" copy; no world-specific shift-banner art.

### Proposed Anomalies ladder (five orbitals, all under Flux)

Tide-themed names, one new idea each, finale on the arena — the same rhythm
as Origins I–V.

| # | Name | Form | Adds | Notes |
| --- | --- | --- | --- | --- |
| I | Flux | 2D pendulum | the breath itself | BUILT (mock) |
| II | Eddies | 2D pendulum | local tides: surge / void / drift / bounty / invert discs scrolling with the field | BUILT (mock) — user: "I like the eddies" |
| III | Twin Tides | 2D pendulum | the two planets breathe half a cycle apart; the pull you feel is the tide of the planet you're falling toward | BUILT (mock) |
| IV | Magnetar | 2D pendulum | charged gates (ported from `orbitals-11-20`) under twin tides — the color you need is the tide that helps you | BUILT (mock) |
| V | Maelstrom | arena | the black hole's pull breathes; debris falls harder at high tide; surges wait for the swell and land on high tide | BUILT (mock) |

Thresholds at step 60: II 60 · III 120 · IV 180 · V 240.

Constraints from playtesting so far: **no 3D in Anomalies** (user), and the
weakest pull must never feel like a crawl (`FLUX_LOW` 0.20, `EDDY_VOID` 0.35).

### Anomalies II — "Eddies" (mock)

Local tides. Translucent discs (`EDDY_R_MIN`–`EDDY_R_MAX` px) spawn between
barrier rows and scroll with the field, at most `EDDY_MAX` on screen. Types
(`EDDY_TYPES` = type, weight, min speed-ramp):

| Type | Look | Inside | Weight |
| --- | --- | --- | --- |
| surge | gold disc, fast ring | pull ×2 | 0.28 |
| void | dark hole, slow ring | pull ×`EDDY_VOID` 0.35 — nearly gone, not dead | 0.22 |
| drift | pale blue, streaming chevrons | sideways current `EDDY_DRIFT` px/s² on top of gravity | 0.20 |
| bounty | pale gold | no physics; carries `EDDY_BOUNTY` coins that scroll with it | 0.15 |
| invert | planet colors swapped across the disc | pull reversed; orb color + lit planet flip while inside | 0.15, only once the speed ramp passes 0.35 |

Bounty is what makes eddies a *choice*: a reason to steer into discs instead
of always around them. The global breath runs underneath at a gentler swing
(`fluxLow` 0.10 / `fluxHigh` 0.22). Test: `?world=anomalies&orbital=2`.

### Anomalies III — "Twin Tides" (mock)

Each planet has its own tide, half a cycle apart (`TWIN_LOW` 0.20 /
`TWIN_HIGH` 0.35): when the left is at 1.35× the right is at 0.80×, and they
trade every three seconds. The pull you feel is the tide of the planet you're
falling toward, so which way to swing depends on which tide is up, not just
where the gap is. The per-side wall glow is the read-out: one wall swells as
the other fades. `fluxNow(side)` / `fluxT(side)` take the side; with no
argument they use the side the orb is actually pulled toward.
Test: `?world=anomalies&orbital=3`.

### Anomalies IV — "Magnetar" (mock)

The charged gates from `orbitals-11-20`, ported: some gaps carry a charge in
one planet's color and only an orb pulled toward THAT planet passes. The
charge is a membrane at the door — checked once on first contact, then you
may flip inside the gap (holding a color through the whole band fought the
pendulum in the original playtest). Wrong charge = repel burst in the gate's
color + death. Shape cue for color-blind players: circles = right pull,
diamonds = left pull. `keyEvery [1, 2]` — one or two neutral gates between
charged ones, after `KEY_FIRST` 2 free gates at entry. Runs under twin tides,
so the color you need and the tide that helps you get there are the same read.
Test: `?world=anomalies&orbital=4`.

### Anomalies V — "Maelstrom" (mock)

The Origins V arena under the tide. The radial pull is multiplied by
`gravMult()` (world physics × breath), debris falls harder at high tide, the
accretion glow breathes, and gravity surges WAIT for the swell
(`MAEL_SURGE_T` 0.5 on the tide read-out) so they always land on high tide —
a surge is telegraphed twice, by the glow and by the tide you were already
reading. Scoring is the standard arena rule (asteroids +1, coins +5 + wallet).
Test: `?world=anomalies&orbital=5`.

Playtest question: an eddy crosses the orb's row in ~0.4–1.0 s at current
scroll speeds, so the local tide is a jolt rather than a zone. If it reads as
random, options are taller (elliptical) discs, a slower relative scroll for
eddies, or applying the eddy once the orb is inside its x-span and the disc is
within one row.

### Shelved: "Slack Water" (built 2026-09-15, removed the same day)

The tide bottomed out near zero for a beat: the orb coasted, taps only shed
momentum (a brake), walls went dark, a label faded in, and coins burst into
reach at each trough. User: "I don't really get the slackwater." The idea
(a deliberately powerless beat you ride rather than fight) may return as an
arena finale flavor — a black hole whose pull pauses — but not as a 2D
pendulum orbital. Code is in git history (commit "Anomalies II Slack Water +
III Eddies"). Also shelved: "Undertow" (3D tunnel whose speed breathes) — no
3D in Anomalies for now.

Thresholds at 60: 60/120/180/240 — a full Anomalies run is ~300 points, so
its finale is reachable by far more players than Origins X.

## Decisions still open

1. **Step:** 60 (proposed) or 75? 60 makes the finale a ~5-minute goal.
2. **Ship size:** Anomalies I–II in the first release with III–V following,
   or all five at once? Incremental keeps a release cadence; all-five gives
   the picker a complete world.
3. **Preview or not:** ship Anomalies I alone behind the PREVIEW tag to get
   feel feedback early, or hold until the world is complete.
4. **Flux amplitude per orbital:** constant 0.35, or ramp (I: 0.25 → V: 0.45)?
5. **Music lock:** set `FLUX_PERIOD` to 6.24 so the tide peaks on the bar.

## Ship checklist (when Anomalies goes out)

- [ ] Decide the open questions above; retune `FLUX_*`, `step`, `physics`.
- [ ] Wire `gravMult()` into binary/arena physics as needed.
- [ ] Create `tidal_anomalies` in App Store Connect (leaderboard set).
- [ ] Remove `mock: true`; update How to Play and store listing copy.
- [ ] Bump `sw.js` cache; Codemagic build; device playtest both worlds.
- [ ] Screenshots: extend `?shot` to accept a world.
