# Tidal Orbit — Worlds (the next gameplay direction)

Status (2026-09-16): **three complete worlds as PREVIEW mocks on branch `worlds`, ready to push.** The world
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
| `step` | points per orbital (thresholds are `step × (n−1)`) | 100 | 100 (was 60 in the mocks; user set every world to 100 on 2026-09-16) |
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
Origins I: 0.85× pull (floatier), 1.12× gap width, 100-point spacing. Music:
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
| V | Spring Tide | arena | the shoreline moves: horizon rides the left tide, rim rides the right; tide pockets surface in the band; surges land on high water | BUILT (mock) — replaced "Maelstrom", which the user found too close to Origins V |

Thresholds at step 100: II 100 · III 200 · IV 300 · V 400 (same spacing as Origins).

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

### Anomalies V — "Spring Tide" (mock)

The finale stacks the world's ideas in polar form. **Twin Tides (III) become
the shoreline:** the event horizon rides the left tide and swells from 30 to
`SPRING_HORIZON_MAX` 88 px at high water; the rim rides the right tide and
tightens from 196 to `SPRING_RIM_MIN` 164 px, half a cycle apart. The safe
band therefore slides in and out every three seconds and you ride it. Dashed
rings mark the horizon's high-water line and the rim's low-water line so the
extremes are always readable. **Eddies (II) become tide pockets:** one
surge / void / invert disc at a time surfaces in the always-safe part of the
band for `SPRING_EDDY_LIFE` 6.5 s, fading over its last second; an inverting
pocket flips the pull indicator and the orb's color. **Flux (I):** the radial
pull, the debris fall, and the accretion glow follow the horizon's tide, and
gravity surges wait for high water (`MAEL_SURGE_T`). Coins spawn only inside
the always-safe band. Standard arena scoring. Test: `?world=anomalies&orbital=5`.

Shelved first draft ("Maelstrom", same day): the Origins V arena with only the
pull breathing and surges on high tide. User: "5 is the same." It was — the
band never moved, so it played like Origins V with a slower rhythm.

## World three — "Perihelion" (orbital I built as a mock)

User's brief: a world where you avoid comets instead of gates. Name chosen by
the user: **Perihelion**. Decisions: the bend is the twist from orbital I;
density is a *shower* (several on screen), never fewer than one.

### Perihelion I — "Shower" (mock)

Open sky, no barriers; a three-layer parallax starfield falls past so the
sky reads as motion. Comets wait at the top edge for `COMET_WARN` 0.6 s with
their entry path drawn as a dashed streak and the head peeking over the edge,
then fall at `COMET_SPEED_START` 230 → `COMET_SPEED_MAX` 400 px/s. Each is
aimed at a point on the orb's row well inside the walls (tilt clamped to
`COMET_ANGLE` 0.45 rad), and one the bend carries into a planet glances off
it (`COMET_BOUNCE` 0.7) — every comet reaches the bottom. Head radius
`COMET_R` 15 (user asked for bigger twice: 9 → 12 → 15). **Only the head kills.** The tail is a
thinning polyline that curves with the bend; 45 % of comets carry a coin
`COMET_COIN_BACK` 56 px behind the head. Score +1 per head that passes the
orb's row, +5 per tail coin. Cadence 1.25 → 0.6 s and cap 3 → 5 on screen
ramp with `difficulty()`; if the sky is ever empty a comet spawns at once.
**The bend:** every falling comet accelerates sideways at `COMET_BEND`
260 px/s² toward the active planet — the same sign as the orb's own pull —
so a flip steers the sky. Palette ember `#ff8c42` / ice `#7fd7ff`. Music:
track 16. Test: `?world=perihelion` (`?probe` exposes `comets`).

Playtest so far (2026-09-16): warning time good; walls stay deadly (user);
heads were too small (9 → 12); comets that left the field sideways were
fixed with aiming + wall glance; starfield added for the sense of motion.
Open: is 260 px/s² of bend readable, or does the telegraph need to show the
*bent* path?

### Perihelion II — "Crossfire" (mock)

Half the comets now enter from a **side edge** (`sides` 0.5 on the orbital),
somewhere in the top third (`COMET_SIDE_Y` 5–33 % of H), angled 29°–43° below
horizontal (`COMET_SIDE_ANGLE`; the shallow end was steepened from 20° per
playtest), so they cross above the orb and come down —
the user's call over "arrive at your row." Same telegraph (dashed streak from
the edge, head peeking in), same speed, density, scoring, coins. Because a
side comet's motion is mostly horizontal, the bend is now the main event:
pull toward it and it drops onto you, pull away and it lifts and glances off
the far planet (`COMET_BOUNCE`), so ricochets appear from the wall rule
already in place. A few loose coins drift down the open sky on their own
(`coinRain` [3.5, 6.5] s apart, `COIN_RAIN_SPEED` 150 px/s) — a low-frequency
reward that isn't attached to a hazard. Track 17. Test: `?world=perihelion&orbital=2`.

### Perihelion III — "Rogues" (mock)

The twist mirrored: your planets pull the comets; a **rogue** pulls *you*.
A third of comets (`rogue` 0.33) are rogues — dark red-brown bodies, radius
`ROGUE_R` 22, 0.7× speed, barely bending (`ROGUE_BEND` 0.3) — each wrapped
in a visible well (`ROGUE_WELL` 115 px: a dim halo, rings falling inward, a
dashed edge). Inside the well the orb is pulled toward the body at up to
`ROGUE_PULL` 1400 px/s² at the surface, fading to zero at the edge, so the
pendulum bends toward the comet as it passes and you tap against it. The
well pulls the sky too (`ROGUE_PULL_SKY`): ice comets curve into it, loose
coins fall in. Bait: `ROGUE_COINS` 3 coins orbit each rogue at `ROGUE_COIN_R`
58 px — dive in and fight the pull, or stay clear. Only the head kills; the
well is harmless. Keeps II's side entries and loose coins. Track 18.
Test: `?world=perihelion&orbital=3`.

### Perihelion IV — "Pushers" (mock)

The well that repels. A pusher (`pusher` 0.22; rogues stay at 0.22) is a pale
ice-blue body with a white-hot core, radius `PUSH_R` 20, 0.75× speed, heavy
(`PUSH_BEND` 0.3), wrapped in the same 115 px well as a rogue — but its rings
**expand outward**, and inside it the orb and every comet are shoved away
(`PUSH_FORCE` 1350 px/s² at the surface → 0 at the edge; `PUSH_FORCE_SKY` 750
on the sky). Beside rogues this makes push-pull corridors: ice funnels between
a pusher and a rogue, loose coins scatter from pushers and fall into rogues,
and a pusher near a wall shoves you toward the planet. Pushers carry no bait.
Wells are signed in code (`wellSign`, `wellAx`, `wellPushBody`, `drawWell`),
so a third well kind is one more sign/colour. Track 19.
Test: `?world=perihelion&orbital=4`.

### Perihelion V — "Perihelion" (mock)

The Origins V black-hole arena with the sky replaced. Debris become comets
that fall from the rim, each telegraphed at the rim in its kind's color
(ice white, rogue rust, pusher ice-blue). **The twist in polar form:** your
radial pull steers the ice — attract inward and the comets rush the hole
(`PERI_BEND_IN` 240 px/s² extra inward), repel outward and they slow to a crawl
(`PERI_BEND_OUT` 150 px/s² outward; radial speed capped at `PERI_ICE_VMAX`).
Measured with the pull held: median inward speed ~160 px/s attracting vs
~40 px/s repelling. **Rogues and pushers** (`PERI_HEAVY_ODDS` 0.30 each — 60 % of
the sky is wells; spawns are `PERI_CADENCE` 1.8× sparser than Origins V, floor
`PERI_CADENCE_MIN` 0.8 s) fall at their own pace (`PERI_HEAVY_SPEED` 0.7) and their wells (`PERI_WELL`
100 px) drag / shove your **radius**, the one axis you control, at the same
strengths as the field; they also pull / push the falling ice. Rogues carry
three orbiting coins (`PERI_COIN_R` 40). No gravity surges — the comets and
the wells are the attacks. Scoring: ice the hole swallows +1, a swallowed
rogue or pusher `PERI_WELL_SCORE` **+5**, coins +5. Track 20. Test: `?world=perihelion&orbital=5`.

Shelved: "Sungrazers" (2026-09-16) — the active planet whipped comets back
across the field hot. Built and verified; user: "not as cool as I thought."
The whip was a wall event you mostly saw from a distance; wells are something
you feel.

Shelved: "Ice and Iron" (same day) — a second comet kind that merely bent
less. User: "I don't really love the iron concept … maybe they are like
little gravity well comets." It was a passive read in a world whose identity
is active physics; Rogues keep the "won't follow you" quality but make the
heavy comet *do* something.

Proposed rest of the ladder: IV Fragments or Sungrazers, V arena finale.

### Original brainstorm (kept for the ladder)

**Identity:** *everything falls.* No barriers at all. The pendulum, the two
planets and the one button are unchanged; the field is open sky and the
hazards are bodies with momentum — comets streaking through with glowing
heads and long tails. Because nothing is fixed, the read changes from
"where is the gap" to "where will that be in a second."

**Rules that keep it fair (carry the Origins pillars):**

- Every comet is telegraphed: its path is drawn as a faint streak for
  ~0.6 s before the head enters, the way strings lock on in Origins VIII.
- Only the head kills. The tail is light: harmless, and where the coins ride
  ("catch the tail" is the reward for cutting close).
- Score: +1 per comet whose head passes below the orb's row; coins +5.
- Spawn rate and speed ramp with the usual per-orbital `difficulty()`.

**Signature twist (the thing every orbital shares):** *the planets pull the
comets too.* A comet's path bends toward whichever planet is active — so
your tap steers the sky as well as the orb. Flip to swing left and the
incoming comet curves left with you. It is the one-button rule turned
outward, and it is unique to a world with no gates to hide behind. Introduce
it gently (orbital I has straight comets; the bend appears in II and grows).

**Proposed ladder (2D only, like Anomalies):**

| # | Name | Adds |
| --- | --- | --- |
| I | Shower | straight, vertical comets, one at a time, long telegraph |
| II | Crossfire | comets enter diagonally from both sides; paths cross; the gravity bend begins (small) |
| III | Fragments | a comet splits into two or three shards at a marked break point; you read the fan |
| IV | Sungrazers | full bend: comets whip around the active planet and come back across the field |
| V | Perihelion | arena finale: comets rain into the black hole from the rim; you thread the streaks while the sweep carries you |

Alternative world names: Comets (plain, what the user said), Perihelion,
Kuiper, Long Night. Palette: ember `#ff8c42` / ice `#7fd7ff` — warm planets,
cold comets, so a comet head reads instantly against either wall.

**Build notes:** a comet is `{x, y, vx, vy, r, tail[]}`; per frame integrate
with `GRAVITY_COMET × toward-active-planet` when the orbital has the bend
flag, record the tail, kill on head–orb distance. Telegraph = draw the
integrated path ahead for 0.6 s at spawn. Reuses the world model, palette
hooks, per-world leaderboard and Start From unchanged; new code is one update
function, one draw function, and a spawn table — roughly the size of the
eddies module. Estimated smaller than Anomalies I–V combined, since there is
no bar/gap system to integrate with.

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

1. ~~**Step:** 60 or 75?~~ Decided: **100**, same as Origins, for every world.
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
