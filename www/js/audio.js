// Efectos de sonido generados con Web Audio (no necesita archivos de audio).
let ctx = null;
let master = null;
let noiseBuf = null;
let volume = 0.6;
let lastHurt = 0;

export function initAudio(vol = 0.6) {
  volume = vol;
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.0, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  volume = v;
  if (master) master.gain.value = v;
}

function noise(dur, { type = 'lowpass', freq = 1200, q = 0.7, gain = 0.6, attack = 0.001, decay = 0.2, detune = 0 } = {}) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 1 + detune;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(filt).connect(g).connect(master);
  src.start(t, Math.random() * 0.5, dur);
  src.stop(t + dur);
}

function tone(freq, dur, { type = 'sine', gain = 0.3, endFreq = null, attack = 0.002 } = {}) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

const SHOTS = {
  pistola:       { freq: 2200, decay: 0.12, gain: 0.5, thump: 180 },
  subfusil:      { freq: 2600, decay: 0.09, gain: 0.45, thump: 150 },
  escopeta:      { freq: 900,  decay: 0.35, gain: 0.9, thump: 90 },
  rifle:         { freq: 1800, decay: 0.14, gain: 0.55, thump: 120 },
  francotirador: { freq: 1200, decay: 0.45, gain: 0.8, thump: 70 },
};

export function playShot(weapon, dist = 0) {
  const s = SHOTS[weapon] || SHOTS.pistola;
  const v = Math.max(0.15, 1 - dist / 70);
  noise(s.decay + 0.1, { type: 'bandpass', freq: s.freq, q: 0.8, gain: s.gain * v, decay: s.decay, detune: Math.random() * 0.1 });
  tone(s.thump, 0.12, { type: 'sine', gain: 0.35 * v, endFreq: 40 });
}

export function playReload() {
  tone(900, 0.04, { type: 'square', gain: 0.12 });
  setTimeout(() => tone(1400, 0.05, { type: 'square', gain: 0.12 }), 320);
}

export function playHitMarker(head = false) {
  tone(head ? 1800 : 1200, 0.07, { type: 'triangle', gain: head ? 0.35 : 0.22 });
}

export function playHurt() {
  if (!ctx) return;
  const now = ctx.currentTime;
  if (now - lastHurt < 0.18) return;
  lastHurt = now;
  tone(160, 0.14, { type: 'sawtooth', gain: 0.18, endFreq: 70 });
}

export function playExplosion(dist = 0) {
  const v = Math.max(0.15, 1 - dist / 45);
  noise(1.2, { type: 'lowpass', freq: 500, gain: 1.0 * v, decay: 1.1, attack: 0.003 });
  tone(60, 0.9, { type: 'sine', gain: 0.8 * v, endFreq: 25 });
}

export function playPickup() {
  tone(880, 0.08, { type: 'triangle', gain: 0.2 });
  setTimeout(() => tone(1320, 0.1, { type: 'triangle', gain: 0.2 }), 70);
}

export function playChest() {
  tone(660, 0.09, { type: 'triangle', gain: 0.22 });
  setTimeout(() => tone(990, 0.1, { type: 'triangle', gain: 0.22 }), 90);
  setTimeout(() => tone(1320, 0.16, { type: 'triangle', gain: 0.2 }), 200);
}

export function playHeal() {
  tone(520, 0.2, { type: 'sine', gain: 0.2, endFreq: 980 });
}

export function playThrow() {
  noise(0.2, { type: 'highpass', freq: 800, gain: 0.25, decay: 0.15 });
}

export function playKill() {
  tone(440, 0.12, { type: 'square', gain: 0.1 });
  setTimeout(() => tone(660, 0.16, { type: 'square', gain: 0.1 }), 90);
}
