/* Tidal FX — procedural audio (Web Audio) + haptics.
   Dark, low synthwave: a Stranger Things-style arpeggio over a deep bass drone,
   and warm low-frequency sound effects (everything runs through low-pass
   filters for a bassy, non-arcade feel). No audio files — synthesized, offline.
   Exposed as window.TidalFX. Unlock with a user gesture (iOS autoplay). */

(() => {
  "use strict";

  let ctx, master, sfxBus, musicBus, musicLP;
  let soundOn = true, musicOn = true, hapticsOn = true;
  let musicTimer = null, step = 0, currentTrack = 1;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    // SFX bus → gentle low-pass (warm, tames harsh highs)
    const sfxGain = ctx.createGain(); sfxGain.gain.value = 0.7;
    const sfxLP = ctx.createBiquadFilter(); sfxLP.type = "lowpass"; sfxLP.frequency.value = 2000;
    sfxGain.connect(sfxLP); sfxLP.connect(master);
    sfxBus = sfxGain;

    // Music bus → darker low-pass (bass-forward)
    const musicGain = ctx.createGain(); musicGain.gain.value = 0.0;
    musicLP = ctx.createBiquadFilter(); musicLP.type = "lowpass"; musicLP.frequency.value = 820; musicLP.Q.value = 0.7;
    musicGain.connect(musicLP); musicLP.connect(master);
    musicBus = musicGain;
  }

  // ---- generic voices ------------------------------------------------------
  function tone({ freq = 200, type = "triangle", dur = 0.12, gain = 0.3, to = null, delay = 0 }) {
    if (!ctx || !soundOn) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur, gain) {
    if (!ctx || !soundOn) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(sfxBus);
    src.start(t);
  }

  // ---- low / bass-forward sound effects ------------------------------------
  const sfx = {
    flip() { tone({ freq: 150, type: "triangle", dur: 0.12, gain: 0.30, to: 104 }); },
    coin() {
      tone({ freq: 196, type: "triangle", dur: 0.10, gain: 0.24 });
      tone({ freq: 262, type: "triangle", dur: 0.13, gain: 0.18, delay: 0.05 });
    },
    crash() {
      tone({ freq: 300, type: "sine", dur: 0.55, gain: 0.24, to: 70 });   // soft descending fall
      tone({ freq: 78, type: "sine", dur: 0.5, gain: 0.26, to: 40 });     // low thud
      noise(0.14, 0.07);                                                  // faint texture
    },
    shift() {
      tone({ freq: 70, type: "sawtooth", dur: 1.1, gain: 0.30, to: 180 });
      tone({ freq: 45, type: "sine", dur: 1.2, gain: 0.32, to: 120 });
      noise(0.6, 0.10);
    },
    start() {
      tone({ freq: 130, type: "sine", dur: 0.32, gain: 0.16, to: 196 });  // gentle low swell
    },
    warp() {   // wormhole teleport: quick rising shimmer
      tone({ freq: 220, type: "sine", dur: 0.14, gain: 0.22, to: 520 });
      tone({ freq: 330, type: "triangle", dur: 0.16, gain: 0.14, to: 700, delay: 0.05 });
    },
    laser() {  // cosmic-string fire: descending zap
      tone({ freq: 880, type: "sawtooth", dur: 0.22, gain: 0.16, to: 160 });
      noise(0.08, 0.05);
    },
  };

  // ---- music: one dark synth track per Orbital -----------------------------
  // Same low/bass DNA throughout; key, tempo, waveform and brightness shift.
  const TRACKS = {
    1: { arp: [110.00, 130.81, 164.81, 220.00, 164.81, 130.81], roots: [55.00], step: 240, type: "sine", lp: 1100, gain: 0.10, bass: 0.20 },                       // I — calm Am
    2: { arp: [130.81, 164.81, 196.00, 246.94, 261.63, 246.94, 196.00, 164.81], roots: [65.41, 65.41, 98.00, 65.41], step: 200, type: "triangle", lp: 1300, gain: 0.10, bass: 0.24 }, // II — ST Cmaj7
    3: { arp: [146.83, 174.61, 220.00, 261.63, 293.66, 261.63, 220.00, 174.61], roots: [73.42, 73.42, 98.00, 110.00], step: 220, type: "triangle", lp: 1400, gain: 0.10, bass: 0.22 }, // III — warm D dorian
    4: { arp: [164.81, 196.00, 246.94, 329.63, 246.94, 196.00], roots: [82.41, 82.41, 110.00, 98.00], step: 160, type: "sawtooth", lp: 1600, gain: 0.09, bass: 0.24 },               // IV — driving Em
    5: { arp: [110.00, 130.81, 155.56, 185.00, 196.00, 185.00, 155.56, 130.81], roots: [55.00, 58.27, 55.00, 49.00], step: 150, type: "sawtooth", lp: 1400, gain: 0.10, bass: 0.28 }, // V — ominous boss
    6: { arp: [123.47, 164.81, 185.00, 246.94, 277.18, 246.94, 185.00, 164.81], roots: [61.74, 61.74, 82.41, 92.50], step: 190, type: "triangle", lp: 1300, gain: 0.10, bass: 0.24 }, // VI — floaty B suspended (wormholes)
    7: { arp: [138.59, 185.00, 220.00, 277.18, 329.63, 277.18, 220.00, 185.00], roots: [69.30, 69.30, 92.50, 103.83], step: 175, type: "sawtooth", lp: 1500, gain: 0.10, bass: 0.24 }, // VII — driving F# (wormhole tunnel)
    8: { arp: [164.81, 196.00, 220.00, 246.94, 329.63, 246.94, 220.00, 174.61], roots: [82.41, 82.41, 87.31, 77.78], step: 140, type: "sawtooth", lp: 1500, gain: 0.09, bass: 0.26 }, // VIII — tense staccato Em, b9 menace (cosmic strings)
    9: { arp: [155.56, 207.65, 246.94, 311.13, 369.99, 311.13, 246.94, 207.65], roots: [103.83, 103.83, 123.47, 92.50], step: 130, type: "sawtooth", lp: 1700, gain: 0.09, bass: 0.24 }, // IX — hardest-driving G#m (wormhole tunnel II)
    10: { arp: [110.00, 116.54, 110.00, 103.83, 130.81, 110.00, 98.00, 116.54], roots: [55.00, 51.91, 49.00, 46.25], step: 170, type: "sawtooth", lp: 1200, gain: 0.11, bass: 0.30 }, // X — apocalyptic Am, descending bass (supernova)
  };
  function trk() { return TRACKS[currentTrack] || TRACKS[1]; }

  function mvoice(freq, type, dur, peak) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(musicBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function musicStep() {
    if (!ctx || !musicOn) return;
    const T = trk();
    const i = step % T.arp.length;
    const noteDur = (T.step / 1000) * 1.5;
    // Arp plays an octave above the TRACKS values (~220-660 Hz): iPhone
    // speakers roll off steeply below ~200 Hz, so at written pitch the music
    // was inaudible on the phone speaker (fine in headphones).
    mvoice(T.arp[i] * 2, T.type, noteDur, T.gain);          // arpeggio pulse
    if (i === 0) {
      const barLen = (T.arp.length * T.step) / 1000;
      const root = T.roots[Math.floor(step / T.arp.length) % T.roots.length];
      mvoice(root, "sine", barLen, T.bass);                // bass drone (headphones/full-range)
      mvoice(root * 2, "triangle", barLen, T.bass * 0.5);  // octave-up harmonic so the bassline carries on small speakers (replaces the /2 sub, which sat below 55 Hz)
    }
    step++;
  }

  function startMusic() {
    if (!ctx || !musicOn) return;
    stopMusic();
    if (musicLP) musicLP.frequency.value = trk().lp;
    musicBus.gain.value = 1;
    step = 0;
    musicStep();
    musicTimer = setInterval(musicStep, trk().step);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function haptic(kind) {
    if (!hapticsOn) return;
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Haptics) {
      const style = kind === "heavy" ? "HEAVY" : kind === "light" ? "LIGHT" : "MEDIUM";
      try { cap.Plugins.Haptics.impact({ style }); } catch (e) { /* no-op */ }
      return;
    }
    if (navigator.vibrate) navigator.vibrate(kind === "heavy" ? 55 : kind === "light" ? 10 : 22);
  }

  window.TidalFX = {
    unlock() {
      ensure();
      if (ctx && ctx.state === "suspended") ctx.resume();
      if (musicOn) startMusic();
    },
    play(name) { ensure(); if (sfx[name]) sfx[name](); },
    haptic,
    setSound(v) { soundOn = !!v; },
    setMusic(v) {
      musicOn = !!v;
      if (musicOn) { ensure(); if (ctx && ctx.state === "suspended") ctx.resume(); startMusic(); }
      else stopMusic();
    },
    setHaptics(v) { hapticsOn = !!v; },
    // Switch the music track to the given Orbital (restarts the loop on the
    // new key/tempo; running notes ring out so the change feels continuous).
    setOrbital(n) {
      currentTrack = Math.max(1, Math.min(10, n || 1));
      if (musicOn && ctx) startMusic();
    },
  };
})();
