/* Tidal FX — procedural audio (Web Audio) + haptics.
   Dark, low synthwave: a Stranger Things-style arpeggio over a deep bass drone,
   and warm low-frequency sound effects (everything runs through low-pass
   filters for a bassy, non-arcade feel). No audio files — synthesized, offline.
   Exposed as window.TidalFX. Unlock with a user gesture (iOS autoplay). */

(() => {
  "use strict";

  let ctx, master, sfxBus, musicBus;
  let soundOn = true, musicOn = true, hapticsOn = true;
  let musicTimer = null, step = 0;

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
    const musicLP = ctx.createBiquadFilter(); musicLP.type = "lowpass"; musicLP.frequency.value = 820; musicLP.Q.value = 0.7;
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
      tone({ freq: 150, type: "sawtooth", dur: 0.6, gain: 0.40, to: 42 });
      tone({ freq: 60, type: "sine", dur: 0.5, gain: 0.35, to: 34 });
      noise(0.4, 0.16);
    },
    shift() {
      tone({ freq: 70, type: "sawtooth", dur: 1.1, gain: 0.30, to: 180 });
      tone({ freq: 45, type: "sine", dur: 1.2, gain: 0.32, to: 120 });
      noise(0.6, 0.10);
    },
    start() {
      tone({ freq: 160, type: "triangle", dur: 0.14, gain: 0.22 });
      tone({ freq: 120, type: "sine", dur: 0.18, gain: 0.18, delay: 0.06 });
    },
  };

  // ---- music: dark arpeggio + deep bass drone (Stranger Things-ish) --------
  const ARP = [130.81, 164.81, 196.00, 246.94, 261.63, 246.94, 196.00, 164.81]; // Cmaj7 up/down
  const ROOTS = [65.41, 65.41, 98.00, 65.41]; // C2, C2, G2, C2 per bar
  const STEP_MS = 200;

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
    const i = step % ARP.length;
    mvoice(ARP[i], "triangle", 0.30, 0.10);                 // arpeggio pulse
    if (i === 0) {
      const root = ROOTS[Math.floor(step / ARP.length) % ROOTS.length];
      mvoice(root, "sine", 1.7, 0.24);                      // bass drone (the bar)
      mvoice(root / 2, "sine", 1.7, 0.13);                  // sub octave
    }
    step++;
  }

  function startMusic() {
    if (!ctx || musicTimer || !musicOn) return;
    musicBus.gain.value = 1;
    step = 0;
    musicStep();
    musicTimer = setInterval(musicStep, STEP_MS);
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
  };
})();
