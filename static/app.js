'use strict';

/* =========================================================
   The-Keyboard — play your computer keyboard like a piano
   ---------------------------------------------------------
   • Default mapping: keyboard keys -> piano notes (C4..C6)
   • Remap: click a piano key, then press a keyboard key
   • Sound: synthesized piano via Web Audio API (no files)
   • Mapping + volume are saved in localStorage
   ========================================================= */

/* ---------------- notes & frequency ---------------- */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);
// number of white keys before each black key within an octave
const WHITES_BEFORE = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 };

const RANGE_START = 'C2';
const RANGE_END = 'C7';

function parseNote(name) {
  const m = /^([A-G]#?)(\d)$/.exec(name);
  if (!m) throw new Error('Invalid note: ' + name);
  const semitone = NOTE_NAMES.indexOf(m[1]);
  const octave = +m[2];
  return { name, semitone, octave, midi: (octave + 1) * 12 + semitone };
}

function freqOf(name) {
  const { midi } = parseNote(name);
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function buildNotes(start, end) {
  const s = parseNote(start), e = parseNote(end);
  const notes = [];
  for (let midi = s.midi; midi <= e.midi; midi++) {
    const semitone = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    notes.push({
      name: NOTE_NAMES[semitone] + octave,
      midi, semitone, octave,
      isBlack: BLACK_SEMITONES.has(semitone),
    });
  }
  return notes;
}
const NOTES = buildNotes(RANGE_START, RANGE_END);

/* ---------------- audio engine ---------------- */
const Audio = (() => {
  let ctx = null;
  let dry, wet, convolver, comp, volume;
  const active = new Map(); // noteName -> { token, oscs, gain }

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;

      convolver = ctx.createConvolver();
      convolver.buffer = makeImpulse(ctx, 2.0, 3.2);

      dry = ctx.createGain(); dry.gain.value = 1;
      wet = ctx.createGain(); wet.gain.value = 0.32;

      volume = ctx.createGain(); volume.gain.value = getSavedVolume();

      dry.connect(comp);
      wet.connect(comp);
      convolver.connect(wet);
      comp.connect(volume);
      volume.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function makeImpulse(c, seconds, decay) {
    const rate = c.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  // Piano-ish tone: fundamental + a few slightly-detuned harmonics,
  // fast attack, natural decay while held, fast fade on release.
  function noteOn(name) {
    const c = ensure();
    if (!c) return null;
    if (active.has(name)) noteOff(name); // retrigger

    const freq = freqOf(name);
    const t = c.currentTime;
    const noteGain = c.createGain();
    const g = noteGain.gain;
    const peak = 0.20;

    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + 0.006);
    g.exponentialRampToValueAtTime(peak * 0.35, t + 1.4);
    g.exponentialRampToValueAtTime(0.0001, t + 5.0);

    const partials = [
      { mult: 1, amp: 1.00, det: 0 },
      { mult: 2, amp: 0.50, det: 2.5 },
      { mult: 3, amp: 0.28, det: -3.0 },
      { mult: 4, amp: 0.15, det: 4.0 },
      { mult: 5, amp: 0.08, det: -4.5 },
      { mult: 6, amp: 0.045, det: 5.0 },
    ];
    const oscs = partials.map(p => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * p.mult;
      o.detune.value = p.det;
      const og = c.createGain();
      og.gain.value = p.amp;
      o.connect(og);
      og.connect(noteGain);
      o.start(t);
      return o;
    });

    noteGain.connect(dry);
    noteGain.connect(convolver);

    const token = {};
    active.set(name, { token, oscs, gain: g });
    return token;
  }

  function noteOff(name, token) {
    const n = active.get(name);
    if (!n) return;
    if (token && n.token !== token) return; // retriggered since; don't kill the new note
    active.delete(name);
    const c = ctx;
    const t = c.currentTime;
    const cur = Math.max(n.gain.value, 0.0001);
    n.gain.cancelScheduledValues(t);
    n.gain.setValueAtTime(cur, t);
    n.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    n.oscs.forEach(o => o.stop(t + 0.2));
  }

  function releaseAll() {
    [...active.keys()].forEach(name => noteOff(name));
  }

  function setVolume(v) {
    if (ctx && volume) volume.gain.setTargetAtTime(v, ctx.currentTime, 0.02);
  }

  return { noteOn, noteOff, releaseAll, setVolume, ensure };
})();

/* ---------------- mapping ---------------- */
const STORAGE_MAP = 'the-keyboard.mapping.v2';
const STORAGE_VOL = 'the-keyboard.volume.v1';

// VirtualPiano-style standard layout: each row covers a complete range.
// Home row = whites C4..F5 (the main octave), Q row = black keys C#4..D#6,
// bottom row = C3..E4 whites, number row = C5..G6 whites. A few notes are
// reachable from two rows, just like a real online piano.
const DEFAULT_MAPPING = {
  // home row — whites C4..F5  (main)
  KeyA: 'C4',   KeyS: 'D4',   KeyD: 'E4',  KeyF: 'F4',  KeyG: 'G4',
  KeyH: 'A4',   KeyJ: 'B4',   KeyK: 'C5',  KeyL: 'D5',  Semicolon: 'E5',
  Quote: 'F5',
  // Q row — black keys C#4..D#6
  KeyQ: 'C#4',  KeyW: 'D#4',  KeyE: 'F#4', KeyR: 'G#4', KeyT: 'A#4',
  KeyY: 'C#5',  KeyU: 'D#5',  KeyI: 'F#5', KeyO: 'G#5', KeyP: 'A#5',
  BracketLeft: 'C#6', BracketRight: 'D#6',
  // bottom row — whites C3..E4
  KeyZ: 'C3',   KeyX: 'D3',   KeyC: 'E3',  KeyV: 'F3',  KeyB: 'G3',
  KeyN: 'A3',   KeyM: 'B3',   Comma: 'C4', Period: 'D4', Slash: 'E4',
  // number row — whites C5..G6
  Digit1: 'C5', Digit2: 'D5', Digit3: 'E5', Digit4: 'F5', Digit5: 'G5',
  Digit6: 'A5', Digit7: 'B5', Digit8: 'C6', Digit9: 'D6', Digit0: 'E6',
  Minus: 'F6',  Equal: 'G6',
};

const PUNCT_LABELS = {
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Comma: ',', Period: '.', Slash: '/', Minus: '-',
  Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
};

const EXCLUDED_CODES = new Set([
  'Escape', 'Tab', 'CapsLock', 'ShiftLeft', 'ShiftRight', 'ControlLeft',
  'ControlRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight', 'ContextMenu',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
]);

function prettyCode(code) {
  if (PUNCT_LABELS[code]) return PUNCT_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6);
  return code;
}

function loadMapping() {
  try {
    const raw = localStorage.getItem(STORAGE_MAP);
    if (raw) return { ...DEFAULT_MAPPING, ...JSON.parse(raw) };
  } catch (_) { /* ignore corrupt storage */ }
  return { ...DEFAULT_MAPPING };
}

function getSavedVolume() {
  const v = parseFloat(localStorage.getItem(STORAGE_VOL));
  return isNaN(v) ? 0.8 : v;
}

let mapping = loadMapping();

function saveMapping() {
  try { localStorage.setItem(STORAGE_MAP, JSON.stringify(mapping)); } catch (_) { /* ignore */ }
}

function codeForNote(note) {
  for (const [code, n] of Object.entries(mapping)) if (n === note) return code;
  return null;
}

function assignKey(code, note) {
  delete mapping[code]; // this key may have pointed at another note before
  mapping[code] = note; // the same note may live on several keys, like an online piano
  saveMapping();
  renderPianoLabels();
  renderMappingList();
  flashKey(note);
}

function resetMapping() {
  mapping = { ...DEFAULT_MAPPING };
  saveMapping();
  renderPianoLabels();
  renderMappingList();
  clearSelected();
  setStatus('Mapping reset to defaults.');
}

/* ---------------- DOM refs & state ---------------- */
const el = {
  piano: document.getElementById('piano'),
  keysArea: document.getElementById('keys-area'),
  status: document.getElementById('status'),
  remapToggle: document.getElementById('remap-toggle'),
  resetBtn: document.getElementById('reset-btn'),
  volume: document.getElementById('volume'),
  banner: document.getElementById('remap-banner'),
  bannerText: document.getElementById('banner-text'),
  mappingList: document.getElementById('mapping-list'),
};

const keyEls = new Map(); // noteName -> element
const heldNotes = new Set(); // notes currently sounding

let remapMode = false;
let remapTarget = null; // note name of the piano key awaiting a keyboard key

function setStatus(msg) { el.status.textContent = msg; }

/* ---------------- piano rendering ---------------- */
function renderPiano() {
  const whites = NOTES.filter(n => !n.isBlack);
  const blacks = NOTES.filter(n => n.isBlack);
  const whiteW = 100 / whites.length; // % width of one white key
  const blackW = whiteW * 0.62;

  const whiteLayer = document.createElement('div');
  whiteLayer.className = 'white-keys';
  for (const n of whites) {
    const k = document.createElement('div');
    k.className = 'key white';
    k.dataset.note = n.name;
    k.innerHTML = `<span class="note-label">${n.name}</span><span class="key-label"></span>`;
    whiteLayer.appendChild(k);
    keyEls.set(n.name, k);
  }

  const blackLayer = document.createElement('div');
  blackLayer.className = 'black-keys';
  for (const n of blacks) {
    const k = document.createElement('div');
    k.className = 'key black';
    k.dataset.note = n.name;
    k.style.left = (WHITES_BEFORE[n.semitone] * whiteW - blackW / 2) + '%';
    k.style.width = blackW + '%';
    k.innerHTML = `<span class="key-label"></span>`;
    blackLayer.appendChild(k);
    keyEls.set(n.name, k);
  }

  el.keysArea.appendChild(whiteLayer);
  el.keysArea.appendChild(blackLayer);

  // pointer interaction on every key (touch-friendly)
  for (const [note, k] of keyEls) {
    k.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (remapMode) { selectRemapTarget(note, k); return; }
      pressNote(note);
    });
    k.addEventListener('pointerup', () => releaseNote(note));
    k.addEventListener('pointercancel', () => releaseNote(note));
    k.addEventListener('pointerleave', () => releaseNote(note));
  }
}

function renderPianoLabels() {
  for (const [note, k] of keyEls) {
    const code = codeForNote(note);
    const labelEl = k.querySelector('.key-label');
    if (code) {
      labelEl.textContent = prettyCode(code);
      k.classList.add('mapped');
      k.title = prettyCode(code) + ' → ' + note;
    } else {
      labelEl.textContent = '';
      k.classList.remove('mapped');
      k.title = note + ' (not mapped)';
    }
  }
}

/* ---------------- play / release ---------------- */
function pressNote(note) {
  Audio.noteOn(note);
  heldNotes.add(note);
  const k = keyEls.get(note);
  if (k) k.classList.add('active');
  setStatus('▶ ' + note);
}

function releaseNote(note) {
  Audio.noteOff(note);
  heldNotes.delete(note);
  const k = keyEls.get(note);
  if (k) k.classList.remove('active');
}

function releaseAll() {
  [...heldNotes].forEach(releaseNote);
}

function flashKey(note) {
  const k = keyEls.get(note);
  if (!k) return;
  k.classList.add('flash');
  clearTimeout(k._flashT);
  k._flashT = setTimeout(() => k.classList.remove('flash'), 350);
}

function clearSelected() {
  document.querySelectorAll('.key.selected').forEach(k => k.classList.remove('selected'));
}

/* ---------------- remap ---------------- */
function setRemapMode(on) {
  remapMode = on;
  remapTarget = null;
  clearSelected();
  el.remapToggle.classList.toggle('active', on);
  el.remapToggle.textContent = on ? 'Remap: ON' : 'Remap keys';
  el.piano.classList.toggle('remap-mode', on);
  el.banner.classList.toggle('hidden', !on);
  updateBanner();
}

function updateBanner() {
  if (!remapMode) return;
  if (remapTarget) {
    el.bannerText.textContent = `Press a keyboard key to assign it to ${remapTarget} — Esc to cancel.`;
    el.banner.classList.add('on');
  } else {
    el.bannerText.textContent = 'Remap mode: click a piano key, then press any keyboard key to map it.';
    el.banner.classList.remove('on');
  }
}

function selectRemapTarget(note, k) {
  clearSelected();
  remapTarget = note;
  k.classList.add('selected');
  updateBanner();
  // brief audition so you can hear what you're mapping
  const token = Audio.noteOn(note);
  setTimeout(() => Audio.noteOff(note, token), 400);
}

function handleRemapKey(e) {
  const code = e.code;
  if (EXCLUDED_CODES.has(code)) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return; // don't hijack shortcuts
  e.preventDefault();
  if (!remapTarget) {
    setStatus('First click a piano key to select it, then press a keyboard key.');
    return;
  }
  const note = remapTarget;
  assignKey(code, note);
  remapTarget = null;
  updateBanner();
  setStatus(`✔ ${prettyCode(code)} → ${note} assigned!`);
}

/* ---------------- mapping list ---------------- */
function renderMappingList() {
  const entries = Object.entries(mapping)
    .map(([code, note]) => ({ code, note, midi: parseNote(note).midi }))
    .sort((a, b) => a.midi - b.midi || a.code.localeCompare(b.code));

  el.mappingList.innerHTML = '';
  for (const { code, note } of entries) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.innerHTML =
      `<span class="chip-key">${prettyCode(code)}</span>` +
      `<span class="chip-arrow">→</span>` +
      `<span class="chip-note">${note}</span>` +
      `<span class="chip-x" title="Unassign">×</span>`;

    chip.addEventListener('click', e => {
      if (e.target.classList.contains('chip-x')) {
        e.stopPropagation();
        delete mapping[code];
        saveMapping();
        renderPianoLabels();
        renderMappingList();
        setStatus(`Unmapped ${prettyCode(code)}.`);
        return;
      }
      if (!remapMode) setRemapMode(true);
      const k = keyEls.get(note);
      selectRemapTarget(note, k);
      if (k) k.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    });
    el.mappingList.appendChild(chip);
  }
}

/* ---------------- keyboard events ---------------- */
window.addEventListener('keydown', e => {
  if (e.repeat) return;

  if (e.code === 'Escape') {
    if (remapTarget) { remapTarget = null; clearSelected(); updateBanner(); }
    else if (remapMode) setRemapMode(false);
    return;
  }

  if (remapMode) { handleRemapKey(e); return; }

  const note = mapping[e.code];
  if (!note) return;
  e.preventDefault();
  pressNote(note);
});

window.addEventListener('keyup', e => {
  if (remapMode) return;
  const note = mapping[e.code];
  if (!note) return;
  e.preventDefault();
  releaseNote(note);
});

window.addEventListener('blur', releaseAll);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

/* ---------------- controls ---------------- */
el.remapToggle.addEventListener('click', () => setRemapMode(!remapMode));
el.resetBtn.addEventListener('click', resetMapping);

el.volume.value = getSavedVolume();
el.volume.addEventListener('input', () => {
  const v = parseFloat(el.volume.value);
  try { localStorage.setItem(STORAGE_VOL, String(v)); } catch (_) { /* ignore */ }
  Audio.setVolume(v);
});

/* ---------------- init ---------------- */
renderPiano();
renderPianoLabels();
renderMappingList();
setStatus('Press a key to play. Hold to sustain. Enable “Remap keys” to change the mapping.');
