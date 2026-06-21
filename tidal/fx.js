/* Tidal FX — procedural sound effects + music (Web Audio) and haptics.
   No audio files: everything is synthesized, so it stays tiny and offline.
   Exposed as window.TidalFX. Audio must be unlocked by a user gesture
   (call TidalFX.unlock() on the first tap) per iOS autoplay rules. */

(() => {
  "use strict";

  let ctx, master, sfxGain, musicGain;
  let soundOn = true, musicOn = true, hapticsOn = true;
  let musicTimer = null, chordIdx = 0;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85; master.connect(ctx.destination);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.7; sfxGain.connect(master);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
  }

  function tone({ freq = 440, type = "sine", dur = 0.12, gain = 0.3, to = null, delay = 0 }) {
    if (!ctx || !soundOn) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxGain);
    o.start(t); o.stop(t + dur + 0.03);
  }

  function noise(dur, gain) {
    if (!ctx || !soundOn) return;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(g); g.connect(sfxGain);
    src.start(t);
  }

  const sfx = {
    flip() { tone({ freq: 480, type: "triangle", dur: 0.10, gain: 0.22, to: 700 }); },
    coin() {
      tone({ freq: 880, type: "square", dur: 0.06, gain: 0.16 });
      tone({ freq: 1320, type: "square", dur: 0.10, gain: 0.15, delay: 0.06 });
    },
    crash() {
      tone({ freq: 200, type: "sawtooth", dur: 0.5, gain: 0.32, to: 55 });
      noise(0.35, 0.22);
    },
    shift() {
      tone({ freq: 300, type: "sawtooth", dur: 0.9, gain: 0.22, to: 1300 });
      tone({ freq: 180, type: "sine", dur: 1.1, gain: 0.18, to: 760, delay: 0.06 });
    },
    start() {
      tone({ freq: 440, type: "triangle", dur: 0.10, gain: 0.18 });
      tone({ freq: 660, type: "triangle", dur: 0.12, gain: 0.16, delay: 0.09 });
    },
  };

  // gentle ambient pad loop
  const CHORDS = [[220, 277, 330], [196, 247, 294], [247, 311, 370], [174, 220, 262]];
  function playChord() {
    if (!ctx || !musicOn) return;
    const t = ctx.currentTime, dur = 4.2;
    const chord = CHORDS[chordIdx++ % CHORDS.length];
    for (const f of chord) {
      const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 1.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(musicGain);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }
  function startMusic() {
    if (!ctx || musicTimer || !musicOn) return;
    musicGain.gain.value = 1;
    playChord();
    musicTimer = setInterval(playChord, 4000);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function haptic(kind) {
    if (!hapticsOn) return;
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Haptics) {
      const H = cap.Plugins.Haptics;
      const style = kind === "heavy" ? "HEAVY" : kind === "light" ? "LIGHT" : "MEDIUM";
      try { H.impact({ style }); } catch (e) { /* no-op */ }
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
