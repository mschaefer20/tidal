# Orbitals XI–XX — brainstorm (v3 ladder)

Working doc on branch `orbitals-11-20`. Nothing here is final; it's the menu
we pick from. Companion to `V1.2-ORBITALS.md` (how VIII–X were designed).

## Status (2026-08-15)

Strategy per Marcus: **incremental** — build/ship one orbital at a time, do
NOT burn the whole ladder in one release. XI and XII are BUILT and playable
(`?orbital=11` / `?orbital=12`); the rest of this doc stays a menu.

Playtested decisions so far:
- **Membrane rule**: a charged gap checks your color ONCE, at first contact
  (2D) / at the barrier plane (3D). Holding a color through the whole
  collision band fought the pendulum at slow scroll — felt bad, cut.
- **Cadence is per-orbital** (`keyEvery: [min,max]` = neutral gates between
  charges). XI runs **[1,1] — every other gate charged** (Marcus preferred
  denser rhythm over the 3-4 ramp). XII keeps the default 3-4.
- Wrong-charge deaths get a **repel burst** in the gate's color (2D; the 3D
  equivalent — curtain flare on the death frame — still TODO if needed).
- Charged gaps: +15% width in 3D, never at extreme edges; charge odds ramp
  replaced by deterministic cadence everywhere.
- Open: does XII need [2,3] so it out-pressures XI? Ship XI solo or XI+XII
  together? (Same-update pairing teaches then escalates.)

## Design pillars (carried over from I–X)

1. **One button, always.** Every mechanic must read as "tap = flip the pull."
   If a concept needs a second input, it's out.
2. **Introduce clean, then remix.** New mechanic debuts in its purest 2D form,
   then returns harder in the 3D tunnel; every 5th orbital is an arena finale
   that celebrates the preceding four.
3. **Compose flags, don't write `=== N`.** Each new mechanic is a capability
   flag on the `ORBITALS` table, read via `ORB()`, so later orbitals can stack
   it freely.
4. **Telegraph everything.** Hazards announce themselves (the strings' lock-on
   cue, the novas' always-reachable gap). Deaths should feel earned.
5. **The fiction escalates.** I–V: one star system. VI–X: exotic space
   (wormholes, cosmic strings, a supernova). XI–XX: stellar remnants and
   cosmology — pulsars, magnetars, dark nebulae, antimatter, the Big Crunch.

## The proposed ladder at a glance

| # | Name | Stage | New flag | Stacked with |
|---|------|-------|----------|--------------|
| XI | Magnetar | 2D | `keyed` | — |
| XII | Ion Storm | 3D | — | `keyed` + `drift` + `taper` |
| XIII | Comet Shower | 2D | `comets` | `wh` |
| XIV | Quasar | 3D | `roll` | `taper` |
| XV | Pulsar | arena | `beacon` | `surges`, `scoreByDebris` |
| XVI | Dark Nebula | 2D | `dark` | `wh`, `whChaos` |
| XVII | Gravity Lens | 3D | `lens` | `dark` (weakened), `wells` |
| XVIII | Antimatter | 2D | `twin` | — |
| XIX | Singularity Run | 3D | — | `keyed` + `roll` + `strings`/`str3` |
| XX | Big Crunch | arena | `crunch` | `novas`, `whArena`, `beacon` |

Thresholds continue the 100-per-orbital spacing (XI starts at 1000, XX at
1900). Dev mode stays 7 apart.

## Per-orbital sketches

### XI — "Magnetar" (2D, new flag `keyed`)
The orb's color already shows its gravity state (pink = pulled left,
cyan = pulled right). Magnetar makes that mechanical: some gate gaps are
**charged** — tinted pink or cyan — and only pass an orb in the matching
state. Your route choice and your color are now the same decision, made
with the same tap. Uncharged gaps stay neutral (always passable) so the
early ramp still breathes.
- Tuning: `KEY_CHANCE` ramps with difficulty (0 → ~0.6); charged gaps glow
  + emit particles in their color; wrong-color contact = death with a
  distinct "repel" flash, not a generic hit.
- Music: taut, metallic ostinato; the two charge colors get L/R panned
  motifs (the fx engine already does per-orbital tracks).
- Risk: color-blind players — pair color with SHAPE (pink gaps have notched
  edges, cyan gaps rounded). Must-do, not nice-to-have.

### XII — "Ion Storm" (3D, stacks `keyed` + `drift` + `taper`)
Keyed gaps enter the tunnel: barrier gaps carry charge as they rush at you,
and IV's drift makes them slide while you commit. The tension: flipping to
steer ALSO flips your color — sometimes you must take the "wrong" line early
so you arrive with the right charge late.
- Reuses: O4 wells/pull-beam rendering, gap drift, taper.
- New tuning only: how early a gap's charge is readable at depth (charge
  visible from spawn; brightens at depth < 6).

### XIII — "Comet Shower" (2D, new flag `comets`)
Diagonal hazards. Comets streak across the field on shallow diagonals with
a bright warning line traced ~0.6s ahead (the strings taught players to
read telegraphs). Gates keep scrolling; wormholes (`wh`) return as the
escape valve — a well-timed portal hop dodges a comet volley.
- Comets never aim at the orb directly (fairness): they pick lanes, the
  telegraph shows the lane, the player weaves.
- Tuning: `COMET_EVERY [min,max]`, `COMET_SPEED`, volley size ramps to 3.
- Music: shimmering arpeggios with descending glissandi on each volley.

### XIV — "Quasar" (3D, new flag `roll`)
The tunnel itself slowly **rotates** around the depth axis — gaps drift
angularly, the whole world corkscrews. Roll speed oscillates (never a
constant spin — readability). At high difficulty brief counter-rotations
telegraph with a lens-flare cue from the quasar jet at the vanishing point.
- Implementation note: in the 3D engine barriers already know their x
  offset; roll = rotating the projection basis before DSCALE falloff, so it
  should be cheap. Canvas fallback: skip roll (flag-gated), keep taper.
- This is the "pure skill read" orbital — no new hazard type, just a
  disoriented frame. Palate cleanser before the arena.

### XV — "Pulsar" (arena, new flag `beacon`)
Third arena. A neutron-star lighthouse: one (later two) **rotating beam**
sweeps the arena like a radar hand. The beam is deadly but perfectly
predictable; debris still falls (points come from feeding debris to the
hole via `scoreByDebris`, like V). Taps still flip radial in/out — you're
timing orbit radius against the sweep.
- The beam accelerates briefly after each nova... no novas here — after
  each *surge* (reuse `surges`), giving the arena a phrase structure:
  calm → surge+fast beam → calm.
- Tuning: `BEAM_OMEGA0`, `BEAM_ACCEL`, `BEAM_WIDTH` (narrows with
  difficulty), second beam unlocks at +60 into the orbital.
- Music: actual pulsar timing — the track's percussion IS the beam period
  (fx.js gets the beam phase; we already sync per-orbital music).

### XVI — "Dark Nebula" (2D, new flag `dark`)
Visibility as the hazard. The field is wrapped in fog; gates are only
visible inside a soft light radius around the orb, PLUS a periodic
"echo-ping" (every ~2.5s) that flashes the whole upcoming field for a
beat. Wormholes return chaotic (`whChaos`) — a portal hop into fog you
just memorized is the signature moment.
- Fairness: ping cadence scales with scroll speed so you always get ≥1
  full-field read per gate; the gap edges nearest the orb always
  glimmer faintly.
- Accessibility: `reduceMotion`/comfort setting bumps the light radius.
- Music: sparse, reverb-heavy; the ping is IN the track (a sonar note).

### XVII — "Gravity Lens" (3D, new flag `lens`)
Massive invisible bodies bend your line: as you drift down the tunnel,
lens fields (rendered as subtle starlight distortion rings) add lateral
acceleration toward their center — gravity assist or gravity trap. Passing
close to a lens center slingshots you; the skill is using lenses to reach
gaps your taps alone can't. Weakened `dark` fog at high difficulty.
- One-button purity check: lenses add force, never take control away.
- Tuning: `LENS_G`, `LENS_R`, spawn density; lens rings pulse when they're
  about to matter (within 2 depth units).

### XVIII — "Antimatter" (2D, new flag `twin`)
The showstopper. A mirrored **antimatter twin** orbits the opposite wall:
it mirrors your x-position exactly (your tap flips both). Both orbs must
survive — the twin threads the mirrored gap of every gate. Gates in this
orbital are authored asymmetrically, so the puzzle is finding the line
where BOTH gaps work.
- Generation rule: every gate guarantees at least one x where both sides
  pass (mirror-feasibility check at spawn — same spirit as the novas'
  always-reachable gap).
- The twin renders in inverted colors (cyan↔pink swapped) with a matter/
  antimatter contact rule: if the orbs' mirrored paths would ever cross the
  centerline together, harmless flash (they never actually collide — the
  mirror makes it impossible; the flash is just drama).
- This one needs real prototyping time; if it doesn't feel fair we demote
  it to a later experiment and slide XIX/XX up.

### XIX — "Singularity Run" (3D, stacks `keyed` + `roll` + `str3`)
The gauntlet: everything the tunnel has taught, at once — charged gaps,
rolling frame, cosmic-string beams locking on. No new mechanic; the
composition IS the content (IX proved this works). Length check: with
thresholds 100 apart this is survivable-but-legendary territory.
- Fairness pass: cap simultaneous demands (never string-lock + counter-roll
  + charged gap within the same 1.5s window — a scheduler, like the nova
  debris pause on X).

### XX — "Big Crunch" (arena finale, new flag `crunch`)
The universe ends. The arena **breathes**: the outer wall slowly contracts
toward the event horizon, then rebounds (crunch → bang), on a long cycle.
During contraction, space is scarce and debris dense; the bang flings
everything outward (novas reversed). Polar portals (`whArena`) and a slow
beacon beam from XV return. Survive the cycles; feed the hole; the score
ticker crossing 2000 is the game's current summit.
- Signature image: at max contraction the playable ring is a sliver — one
  clean orbit inside it should always exist (crunch-feasibility rule).
- Music: the whole track breathes with the cycle (filter sweep down on
  crunch, full spectrum on bang). End-of-ladder fanfare on entry.

## Cross-cutting work (whichever subset we build)

- `ORBITAL_LABEL` extends to XX; `Start From` list, death-screen copy.
- fx.js: TRACKS 11–20 + new sfx: `charge` (keyed repel), `comet`, `ping`
  (dark), `beamwarn` (beacon), `crunch`. Beam/ping want music-phase sync.
- `?shot` scenes for store screenshots max at 5 today — extend or add
  `?shot=11..20` posed scenes when we get to marketing.
- Threshold math, speed ramp, and continue floor need zero changes (all
  parameterized) — verify `unlocked` clamp (`ORBITALS.length`) picks up 20.
- Color-blind/shape pairing for `keyed`; comfort setting for `dark`.
- sw.js CACHE bump on ship; App Store/Play "What's New" copy.

## Open questions for Marcus

1. Ship all ten at once (a "v3: The Deep Field" update) or two waves of
   five (XI–XV, then XVI–XX) like waves one/two?
2. Is `twin` (XVIII) too ambitious? It's the riskiest and the most
   marketable. Prototype first before committing the slot?
3. Difficulty ceiling: should thresholds stay 100 apart through XX, or
   widen late (e.g., 150 for XVIII–XX) so the finale feels epic?
4. Does the fiction sequence read right: Magnetar → Ion Storm → Comet
   Shower → Quasar → Pulsar → Dark Nebula → Gravity Lens → Antimatter →
   Singularity Run → Big Crunch?
5. Monetization hook: "Start From" already covers replay; do we want a
   one-time celebratory unlock (cosmetic trail?) at XX — or keep v3 purely
   content? (Skins were deliberately removed once; only revisit with intent.)
