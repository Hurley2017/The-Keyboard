'use strict';

/* ============ Piano key data ============ */

// 61 keys, C2 (midi 36) to C7 (midi 96)
const MIDI_START = 36;
const KEY_COUNT = 61;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return name + octave;
}

function isBlackMidi(midi) {
  return NOTE_NAMES[midi % 12].includes('#');
}

function makeNotes() {
  return Array.from({ length: KEY_COUNT }, (_, i) => {
    const midi = MIDI_START + i;
    return {
      midi,
      name: midiToName(midi),
      black: isBlackMidi(midi),
      // row 1: 1..=, row 2: q..\, row 3: a..', row 4: z../, then shifted extras
      defaultKey: '1234567890-=qwertyuiop[]\\asdfghjkl;\'zxcvbnm,./!@#$%^&*()_+`~|'[i],
      key: null // current assignment; null = follow default
    };
  });
}

const notes = makeNotes();

/* ============ Note name → midi (for display only) ============ */
const midiByDisplayName = new Map(notes.map(n => [n.name, n.midi]));

/* ============ Persistence ============ */
const STORAGE_KEY = 'keynote.layout.v1';

function loadLayout() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return;
    for (const n of notes) {
      if (typeof saved[n.name] === 'string') n.key = saved[n.name];
    }
  } catch (e) {
    /* corrupted storage — ignore */
  }
}

function saveLayout() {
  const map = {};
  for (const n of notes) if (n.key) map[n.name] = n.key;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    /* storage unavailable — layout stays in-memory */
  }
}

function resetLayout() {
  for (const n of notes) n.key = null;
  saveLayout();
  refreshAll();
}

/* ============ Sound engine ============ */
class Engine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sustain = false;
    this.active = new Map(); // midi -> { osc, osc2, osc3, gain, endAt, nodes, id }
    this.voiceId = 0;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      setStatus('Audio is not supported in this browser.');
      return;
    }
    this.ctx = new AC();
    // master -> compressor: chords keep their body without clipping
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -22;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 8;
    this.compressor.attack.value = 0.002;
    this.compressor.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
  }

  frequency(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  noteOn(midi, velocity = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    // retrigger: a held/sustained voice of the same note is faded out fast so
    // rapid repeats (tremolo, fast covers) are never swallowed
    const old = this.active.get(midi);
    if (old) {
      old.gain.gain.cancelScheduledValues(t);
      old.gain.gain.setValueAtTime(Math.max(old.gain.gain.value, 0.001), t);
      old.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      this.active.delete(midi);
    }

    // anti-ghosting: never drop a press — if we run out of voices,
    // steal the oldest one instead of silencing the new note
    if (this.active.size >= 28) {
      const oldestMidi = this.active.keys().next().value;
      const ov = this.active.get(oldestMidi);
      if (ov) {
        ov.gain.gain.cancelScheduledValues(t);
        ov.gain.gain.setValueAtTime(Math.max(ov.gain.gain.value, 0.001), t);
        ov.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        this.active.delete(oldestMidi);
      }
    }

    const freq = this.frequency(midi);
    const id = ++this.voiceId;
    const dur = 1.2;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t); // tiny floor avoids a click at t
    gain.gain.exponentialRampToValueAtTime(velocity * 0.5, t + 0.015);

    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    // gentle chorus-ish detune
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = freq;
    osc2.detune.value = 6;

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.3;
    osc2.connect(g2);
    g2.connect(gain);

    // warm body partial (an octave up) for a fuller tone
    const osc3 = this.ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2;
    const g3 = this.ctx.createGain();
    g3.gain.value = 0.12;
    osc3.connect(g3);
    g3.connect(gain);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3600;
    filter.Q.value = 0.4;
    gain.connect(filter);
    filter.connect(this.master);

    osc.start(t);
    osc2.start(t);
    osc3.start(t);
    gain.gain.exponentialRampToValueAtTime(velocity * 0.5, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    // hammer: a tiny filtered noise click on the attack, like felt hitting the string
    const hammer = this.makeHammer(t);
    if (hammer) {
      const { src } = hammer;
      const clean = () => { try { hammer.bp.disconnect(); hammer.hg.disconnect(); } catch (e) { /* gone */ } };
      src.onended = clean;
      setTimeout(clean, 120);
    }

    const endAt = t + dur;
    osc.stop(endAt + 0.05);
    osc2.stop(endAt + 0.05);
    osc3.stop(endAt + 0.05);

    // free Web Audio nodes once the note has died, or memory grows with every press
    const nodes = [osc, osc2, osc3, g2, g3, gain, filter];
    setTimeout(() => {
      try { nodes.forEach(n => n.disconnect()); } catch (e) { /* already gone */ }
    }, (dur + 0.5) * 1000);

    this.active.set(midi, { osc, osc2, osc3, gain, endAt, nodes, id });
    return id;
  }

  makeHammer(t) {
    if (!this.ctx) return null;
    const len = Math.floor(this.ctx.sampleRate * 0.03);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const hg = this.ctx.createGain();
    hg.gain.value = 0.15;
    src.connect(bp);
    bp.connect(hg);
    hg.connect(this.master);
    src.start(t);
    src.stop(t + 0.04);
    return { src, bp, hg };
  }

  noteOff(midi, id) {
    const v = this.active.get(midi);
    if (!v) return;
    // the player only ever releases its own voices, never a live key press
    if (id != null && v.id !== id) return;
    const t = this.ctx.currentTime;
    if (this.sustain) {
      // pedal down: fade out slowly instead of cutting off
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.001), t);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      this.active.delete(midi);
      return;
    }
    // quick dip, then the piano's hollow ring as the string settles
    v.gain.gain.cancelScheduledValues(t);
    const cur = Math.max(v.gain.gain.value, 0.001);
    v.gain.gain.setValueAtTime(cur, t);
    v.gain.gain.exponentialRampToValueAtTime(cur * 0.25, t + 0.06);
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    this.active.delete(midi);
    setTimeout(() => {
      try { v.osc.stop(); v.osc2.stop(); v.osc3.stop(); } catch (e) { /* already stopped */ }
      try { v.nodes.forEach(n => n.disconnect()); } catch (e) { /* already gone */ }
    }, 1000);
  }

  pedalDown() {
    this.sustain = true;
  }

  pedalUp() {
    this.sustain = false;
    // release all sustained notes now
    for (const [midi, v] of this.active) {
      if (!v) continue;
      const t = this.ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.001), t);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      this.active.delete(midi);
      setTimeout(() => {
        try { v.osc.stop(); v.osc2.stop(); } catch (e) { /* already stopped */ }
        try { v.nodes.forEach(n => n.disconnect()); } catch (e) { /* already gone */ }
      }, 350);
    }
  }

  panic() {
    if (!this.ctx) return;
    for (const [midi] of this.active) this.noteOff(midi);
    this.pedalUp();
  }
}

const engine = new Engine();

/* ============ Keyboard input ============ */

// keys currently held; guards against auto-repeat & OS-level repeats
const held = new Set();

// Which computer key is assigned to which piano key (midi). Rebuilt on remap.
let keyToMidi = new Map();
const reservedKeys = new Set([' ']);

// text inputs we must not steal keystrokes from
const isTypingTarget = el =>
  el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

function buildKeyMap() {
  keyToMidi = new Map();
  for (const n of notes) {
    const k = (n.key || n.defaultKey).toLowerCase();
    if (k && !reservedKeys.has(k) && !keyToMidi.has(k)) keyToMidi.set(k, n.midi);
  }
}

function findMidiForKey(k) {
  return keyToMidi.get(k) ?? null;
}

function onKeyDown(e) {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { // sustain pedal
    engine.ensure();
    engine.pedalDown();
    setStatus('Sustain pedal down');
    return;
  }
  if (remapMode) return; // remap mode consumes keys
  const midi = findMidiForKey(k);
  if (midi == null) return;
  if (held.has(midi)) return;
  held.add(midi);
  engine.ensure();
  engine.noteOn(midi);
  pressVisual(midi, true);
  spawnNoteAt(midi);
}

function onKeyUp(e) {
  const k = e.key.toLowerCase();
  if (k === ' ') {
    engine.pedalUp();
    setStatus('Ready.');
    return;
  }
  const midi = findMidiForKey(k);
  if (midi == null) return;
  held.delete(midi);
  engine.noteOff(midi);
  pressVisual(midi, false);
}

/* ============ Visual state ============ */

function pressVisual(midi, down) {
  const el = document.querySelector(`[data-midi="${midi}"]`);
  if (el) el.classList.toggle('pressed', down);
}

function isHeldMidi(midi) {
  return held.has(midi);
}

/* ============ UI: build piano ============ */

const pianoEl = document.getElementById('piano');

// group notes into octaves so white keys align
function octavesOf() {
  const groups = [];
  let current = [];
  let lastOct = null;
  for (const n of notes) {
    const oct = Math.floor(n.midi / 12);
    if (lastOct !== null && oct !== lastOct) {
      groups.push(current);
      current = [];
    }
    current.push(n);
    lastOct = oct;
  }
  groups.push(current);
  return groups;
}

function buildPiano() {
  pianoEl.innerHTML = '';
  for (const group of octavesOf()) {
    const octaveEl = document.createElement('div');
    octaveEl.className = 'octave';
    const whites = group.filter(n => !n.black);
    const blacks = group.filter(n => n.black);
    // size the octave group by how many white keys it holds, so a lone
    // trailing key (C7) stays the same width as every other white key
    octaveEl.style.flex = `${whites.length} ${whites.length} 0`;
    for (const n of whites) {
      const key = document.createElement('div');
      key.className = 'key white';
      key.dataset.midi = n.midi;
      key.innerHTML = `<span class="key-label">${n.name}</span><span class="key-hint">${displayKey(n) || '—'}</span>`;
      key.addEventListener('pointerdown', e => { e.preventDefault(); playFromUI(n.midi); });
      key.addEventListener('pointerup', () => stopFromUI(n.midi));
      key.addEventListener('pointerleave', () => stopFromUI(n.midi));
      octaveEl.appendChild(key);
    }
    for (const n of blacks) {
      const key = document.createElement('div');
      key.className = 'key black';
      key.dataset.midi = n.midi;
      // seat each black key on the seam between its two adjacent white keys
      const whitesBefore = whites.filter(w => w.midi < n.midi).length;
      key.style.left = `${((whitesBefore - 0.3) / 7) * 100}%`;
      key.innerHTML = `<span class="key-label">${n.name}</span><span class="key-hint">${displayKey(n) || '—'}</span>`;
      key.addEventListener('pointerdown', e => { e.preventDefault(); playFromUI(n.midi); });
      key.addEventListener('pointerup', () => stopFromUI(n.midi));
      key.addEventListener('pointerleave', () => stopFromUI(n.midi));
      octaveEl.appendChild(key);
    }
    pianoEl.appendChild(octaveEl);
  }
}

// Show which computer key plays this note
function displayKey(n) {
  const k = n.key || n.defaultKey;
  if (!k) return '';
  return k === ' ' ? 'Space' : k.toUpperCase();
}

function playFromUI(midi) {
  if (remapMode) { selectForRemap(midi); return; }
  if (held.has(midi)) return;
  held.add(midi);
  engine.ensure();
  engine.noteOn(midi);
  pressVisual(midi, true);
  spawnNoteAt(midi);
  setStatus(`Playing ${midiToName(midi)}`);
}

function stopFromUI(midi) {
  if (!held.has(midi)) return;
  held.delete(midi);
  engine.noteOff(midi);
  pressVisual(midi, false);
  setStatus('Ready.');
}

/* ============ Remap mode ============ */

let remapMode = false;
let selectedMidi = null;

const remapBtn = document.getElementById('remapBtn');
const closeRemap = document.getElementById('closeRemap');
const overlay = document.getElementById('overlay');
const layoutList = document.getElementById('layoutList');
const conflictsEl = document.getElementById('conflicts');

function startRemap() {
  remapMode = true;
  document.body.classList.add('remapping');
  overlay.classList.remove('hidden');
  renderLayoutList();
  updateRemapHints();
  document.getElementById('status').textContent = 'Remap mode: select a piano key, then press a key.';
  if (selectedMidi) selectForRemap(selectedMidi);
}

function stopRemap() {
  remapMode = false;
  selectedMidi = null;
  document.body.classList.remove('remapping');
  overlay.classList.add('hidden');
  updateRemapHints();
  buildKeyMap();
  refreshAll();
  setStatus('Ready.');
}

function selectForRemap(midi) {
  selectedMidi = midi;
  document.querySelectorAll('.key').forEach(k => k.classList.toggle('remap-selected', Number(k.dataset.midi) === midi));
  document.querySelectorAll('.layout-item').forEach(li =>
    li.classList.toggle('selected', Number(li.dataset.midi) === midi));
}

function renderLayoutList() {
  layoutList.innerHTML = '';
  for (const n of notes) {
    const li = document.createElement('li');
    li.dataset.midi = n.midi;
    const key = displayKey(n);
    li.className = 'layout-item' + (n.black ? ' black-item' : '');
    li.innerHTML = `<span class="layout-note">${n.name}</span><span class="layout-key${key ? '' : ' unset'}">${key || '—'}</span>`;
    li.addEventListener('click', () => selectForRemap(n.midi));
    layoutList.appendChild(li);
    if (n.midi === selectedMidi) li.classList.add('selected');
  }
}

function updateRemapHints() {
  document.querySelectorAll('.key-hint').forEach(el => {
    const n = notes.find(x => x.midi === Number(el.closest('.key').dataset.midi));
    el.textContent = displayKey(n) || '—';
  });
}

function flashKey(midi) {
  const el = document.querySelector(`[data-midi="${midi}"]`);
  if (el) {
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 200);
  }
}

function onRemapKey(e) {
  if (e.key === 'Escape') { stopRemap(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedMidi == null) return;
    notes.find(n => n.midi === selectedMidi).key = null;
    saveLayout();
    renderLayoutList();
    updateRemapHints();
    setStatus('Unassigned ' + midiToName(selectedMidi));
    return;
  }
  if (e.key === ' ' || e.key.length !== 1) return;
  if (selectedMidi == null) return;
  const k = e.key.toLowerCase();
  const n = notes.find(x => x.midi === selectedMidi);
  n.key = k;
  saveLayout();
  renderLayoutList();
  updateRemapHints();
  flashKey(selectedMidi);
  setStatus(`Assigned ${k.toUpperCase()} → ${n.name}`);
}

/* ============ Wire up events ============ */

remapBtn.addEventListener('click', startRemap);
closeRemap.addEventListener('click', stopRemap);

document.getElementById('octave').addEventListener('change', e => {
  const v = Number(e.target.value);
  const o = Math.min(7, Math.max(1, v || 4));
  e.target.value = o;
  const first = (o + 1) * 12; // midi of C at this octave
  const last = first + 11;
  document.querySelectorAll('.key').forEach(k => {
    const m = Number(k.dataset.midi);
    k.classList.toggle('octave-active', m >= first && m <= last);
  });
  setStatus(`Octave ${o} (${midiToName(first)} – ${midiToName(last)})`);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('Reset the key layout to defaults?')) resetLayout();
});

// Single keys play the piano; only intercept when nothing else needs them.
window.addEventListener('keydown', e => {
  if (isTypingTarget(e.target)) return;
  if (remapMode) { e.preventDefault(); onRemapKey(e); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return; // leave browser shortcuts alone
  if (e.key === 'Escape') { engine.panic(); setStatus('Panic — all notes stopped.'); return; }
  e.preventDefault(); // stop space from scrolling the page
  onKeyDown(e);
});

window.addEventListener('keyup', e => {
  if (isTypingTarget(e.target) || remapMode) return;
  onKeyUp(e);
});

window.addEventListener('blur', () => {
  engine.panic();
  held.clear();
  document.querySelectorAll('.key.pressed, .key.remap-selected').forEach(k => k.classList.remove('pressed', 'remap-selected'));
  selectedMidi = null;
});

/* ============ Music-note bursts ============ */

let burstCount = 0;

function spawnNoteAt(midi) {
  // throttle: too many bursts under fast playing hurt the frame rate
  if (burstCount >= 8) return;
  const el = document.querySelector(`.key[data-midi="${midi}"]`);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.className = 'note-burst';
  burst.innerHTML = '<span class="note">♪</span>';
  for (let i = 0; i < 4; i++) {
    const sp = document.createElement('i');
    sp.className = 'spark';
    const angle = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 18;
    sp.style.setProperty('--x', (Math.cos(angle) * dist).toFixed(1) + 'px');
    sp.style.setProperty('--y', (Math.sin(angle) * dist - 6).toFixed(1) + 'px');
    sp.style.setProperty('--d', (Math.random() * 0.2).toFixed(2) + 's');
    burst.appendChild(sp);
  }
  // float the icon *above* the piano, rising from the key's top edge
  burst.style.left = (r.left + r.width / 2) + 'px';
  burst.style.top = Math.max(6, r.top - 30) + 'px';
  document.body.appendChild(burst);
  burstCount++;
  requestAnimationFrame(() => burst.classList.add('go'));
  setTimeout(() => { burst.remove(); burstCount--; }, 1000);
}

/* ============ Drag-to-play (mouse glissando) ============ */

const drag = { active: false, lastMidi: null };

document.addEventListener('pointerdown', e => {
  const key = e.target.closest && e.target.closest('.key');
  if (key && !remapMode) {
    drag.active = true;
    drag.lastMidi = Number(key.dataset.midi);
  }
});

document.addEventListener('pointermove', e => {
  if (!drag.active) return;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const key = el && el.closest('.key');
  if (!key) return;
  const midi = Number(key.dataset.midi);
  if (midi !== drag.lastMidi) {
    drag.lastMidi = midi;
    playFromUI(midi);
  }
});

document.addEventListener('pointerup', () => { drag.active = false; });
document.addEventListener('pointercancel', () => { drag.active = false; });

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

function refreshAll() {
  document.querySelectorAll('.key .key-hint').forEach(el => {
    const n = notes.find(x => x.midi === Number(el.closest('.key').dataset.midi));
    if (n) el.textContent = displayKey(n) || '—';
  });
  renderLayoutList();
  buildKeyMap();
  showConflicts();
}

function showConflicts() {
  const seen = new Map();
  let conflicts = 0;
  for (const n of notes) {
    const k = n.key || n.defaultKey;
    if (!k) continue;
    if (seen.has(k)) {
      conflicts++;
      seen.get(k).push(n.name);
    } else {
      seen.set(k, [n.name]);
    }
  }
  conflictsEl.classList.toggle('hidden', conflicts === 0);
  conflictsEl.textContent = conflicts
    ? `${conflicts} conflict${conflicts > 1 ? 's' : ''}: ${[...seen.values()].filter(a => a.length > 1).map(a => a.join(' / ')).join(', ')}`
    : '';
}

/* ============ Famous piano covers ============ */

const SAMPLES = [
  {
    id: 'fur-elise', title: 'Für Elise', composer: 'Beethoven', bpm: 104,
    data:
      'E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:2 R:1 ' +
      'C4:0.5 E4:0.5 A4:0.5 B4:2 R:1 E4:0.5 G#4:0.5 B4:0.5 C5:2 R:1 ' +
      'E4:0.5 E5:0.5 D#5:0.5 E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 A4:2 R:1 ' +
      'C4:0.5 E4:0.5 A4:0.5 B4:2 R:1 E4:0.5 C5:0.5 B4:0.5 A4:2'
  },
  {
    id: 'moonlight', title: 'Moonlight Sonata', composer: 'Beethoven', bpm: 90,
    data:
      'C#3:24 C#4+E4+G#4:1 C#5:0.5 E5:0.5 G#5:0.5 C#5:0.5 E5:0.5 G#5:0.5 ' +
      'B3+D#4+F#4:1 B4:0.5 E5:0.5 G#5:0.5 B4:0.5 E5:0.5 G#5:0.5 ' +
      'A3+C#4+E4:1 A4:0.5 E5:0.5 C#5:0.5 A4:0.5 E5:0.5 C#5:0.5 ' +
      'G#3+B3+D#4:1 G#4:0.5 B4:0.5 E5:0.5 G#4:0.5 B4:0.5 E5:0.5'
  },
  {
    id: 'canon', title: 'Canon in D', composer: 'Pachelbel', bpm: 96,
    data:
      'D3:1 A3:1 B3:1 F#3:1 G3:1 D3:1 G3:1 A3:2 ' +
      'D4:2 F#4:1 D4:1 A4:1 D5:2 A3:1 F#4:1 D5:1 F#5:2 ' +
      'G3:2 B4:1 G4:1 D5:1 G5:2 D3:1 G3:1 B3:1 D4:1 ' +
      'A2+A3:4 E5:1 C#5:1 A4:1 E5:1 A5:2'
  },
  {
    id: 'comptine', title: "Comptine d'un autre été", composer: 'Yann Tiersen', bpm: 118,
    data:
      'A2:40 A3:40 E5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:0.5 C5:0.5 E5:0.5 B4:0.5 ' +
      'A4:0.5 E5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:0.5 C5:0.5 E5:0.5 B4:0.5 ' +
      'A4:0.5 E5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:0.5 C5:0.5 E5:0.5 C5:0.5 ' +
      'D5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:0.5 C5:0.5 B4:0.5 A4:0.5 ' +
      'A4:0.5 E5:0.5 C5:0.5 B4:0.5 A4:0.5 B4:0.5 C5:0.5 E5:0.5'
  },
  {
    id: 'interstellar', title: 'Interstellar (Main Theme)', composer: 'Hans Zimmer', bpm: 66,
    data:
      'D3:24 A3:0.5 C4:0.5 D4:2 A3:0.5 C4:0.5 D4:2 R:1 ' +
      'A3:0.5 C4:0.5 D4:2 F4:2 D4:1 F4:1 E4:1 D4:2 R:1 ' +
      'A3:0.5 C4:0.5 D4:2 R:1 D4:1 F4:1 E4:1 D4:3'
  },
  {
    id: 'clair-de-lune', title: 'Clair de Lune', composer: 'Debussy', bpm: 68,
    data:
      'D#4:2 A#4:1 D#5:1 F5:1 A#5:3 R:1 D#5:1 F5:1 A#5:1 D#6:3 R:1 ' +
      'C#5:2 F5:1 A#5:1 C#6:2 R:1 C5:2 G#5:1 C6:1 A#5:2 R:1 D#5:1 F5:1 A#5:1 D#6:4'
  },
  {
    id: 'river-flows', title: 'River Flows in You', composer: 'Yiruma', bpm: 100,
    data:
      'G#4:2 B4:1 C#5:1 D#5:1 C#5:1 B4:1 G#4:2 E4:1 C#4:1 D#4:2 B3:1 G#3:1 ' +
      'A3:1 B3:1 C#4:1 D#4:1 E4:1 G#4:1 B4:1 G#4:2 E4:1 C#4:1 D#4:3'
  },
  {
    id: 'nuvole-bianche', title: 'Nuvole Bianche', composer: 'Ludovico Einaudi', bpm: 96,
    data:
      'A3:2 E4:1 A4:1 C5:1 E5:1 C5:1 A4:1 A3:2 E4:1 A4:1 C5:1 E5:1 G5:1 E5:1 ' +
      'C5:1 B4:1 E4:1 G4:1 B4:1 D5:1 B4:1 G4:1 A4:2 E4:1 C#4:1 E4:1 A4:2'
  },
  {
    id: 'gymnopedie', title: 'Gymnopédie No. 1', composer: 'Erik Satie', bpm: 76,
    data:
      'G4:2 D5:1 D#5:1 E5:2 G5:1 F#5:1 D#5:1 E5:2 G4:2 D5:1 D#5:1 E5:2 G5:1 A5:1 G5:1 F#5:1 E5:2'
  },
  {
    id: 'hallelujah', title: 'Hallelujah', composer: 'Leonard Cohen', bpm: 72,
    data:
      'C5:2 G4:1 E4:1 C4:1 D4:1 F4:1 G4:1 A4:1 C5:1 B4:1 A4:1 G4:1 E4:1 D4:1 ' +
      'G4:2 F4:1 E4:1 D4:2 C4:1 D4:1 E4:1 F4:1 G4:2'
  },
  {
    id: 'all-of-me', title: 'All of Me', composer: 'John Legend', bpm: 76,
    data:
      'A4:1 B4:1 C5:1 D5:1 E5:2 C5:1 B4:1 A4:2 G#4:1 A4:1 B4:1 C5:1 D5:2 ' +
      'A4:1 B4:1 C5:1 D5:1 E5:2 C5:1 D5:1 E5:4'
  },
  {
    id: 'imagine', title: 'Imagine', composer: 'John Lennon', bpm: 76,
    data:
      'C5:2 E5:1 G5:1 E5:1 D5:1 C5:1 D5:1 E5:1 D5:2 C5:1 B4:1 A4:1 ' +
      'C5:2 G4:1 C5:1 E5:1 D5:1 C5:1 D5:1 E5:2'
  },
  {
    id: 'bohemian', title: 'Bohemian Rhapsody (Intro)', composer: 'Queen', bpm: 76,
    data:
      'D3:0.5 Eb3:0.5 F3:0.5 G3:0.5 A3:1 B3:1 C4:1 D4:0.5 Eb4:0.5 F4:1.5 Eb4:0.5 D4:1 C4:1 ' +
      'Bb3:1 C4:1 D4:1 Eb4:1 F4:1 G4:2 F4:1 Eb4:1 D4:1 C4:1'
  },
  {
    id: 'let-it-be', title: 'Let It Be', composer: 'The Beatles', bpm: 72,
    data:
      'E5:1 D5:1 C5:1 B4:1 C5:1 B4:1 A4:1 G4:2 A4:1 B4:1 C5:1 D5:1 E5:1 D5:1 C5:2 ' +
      'B4:1 C5:1 D5:1 E5:1 G5:1 E5:1 D5:2'
  },
  {
    id: 'someone-like-you', title: 'Someone Like You', composer: 'Adele', bpm: 72,
    data:
      'A4:1 C#5:1 D5:1 E5:2 C#5:1 A4:1 B4:2 C#5:1 D5:1 E5:1 G5:1 F#5:2 E5:1 D5:1 ' +
      'C#5:2 B4:1 C#5:1 D5:1 C#5:1 A4:2'
  },
  {
    id: 'perfect', title: 'Perfect', composer: 'Ed Sheeran', bpm: 80,
    data:
      'D5:1 A4:1 B4:1 C#5:1 D5:1 E5:1 F#5:1 E5:1 D5:2 C#5:1 B4:1 A4:1 F#4:1 ' +
      'G4:1 A4:1 B4:1 C#5:1 D5:2'
  },
  {
    id: 'marriage-damour', title: "Marriage d'Amour", composer: 'Paul de Senneville', bpm: 92,
    data:
      'E5:1 G#5:1 B5:1 C#6:1 B5:1 A5:1 G#5:1 A5:1 B5:2 G#5:1 E5:1 G#5:1 B5:2 A5:1 G#5:1 ' +
      'F#5:1 E5:1 D#5:1 E5:1 F#5:1 G#5:2'
  },
  {
    id: 'nocturne', title: 'Nocturne Op. 9 No. 2', composer: 'Frédéric Chopin', bpm: 80,
    data:
      'E5:1.5 D#5:0.5 E5:1 B4:0.5 D5:0.5 E5:1 G#5:0.5 C#6:0.5 D6:1 B5:0.5 A5:0.5 G#5:1 E5:0.5 G#5:0.5 ' +
      'B5:1 A5:0.5 F#5:0.5 G#5:2'
  },
  {
    id: 'clocks', title: 'Clocks', composer: 'Coldplay', bpm: 104,
    data:
      'G3:1.5 B3:0.5 C4:0.5 D4:0.5 C4:0.5 B3:0.5 G3:0.5 E3:2 R:1 ' +
      'G3:1.5 B3:0.5 C4:0.5 D4:0.5 C4:0.5 B3:0.5 G3:0.5 E3:2 R:1 ' +
      'G3:1.5 B3:0.5 C4:0.5 D4:0.5 C4:0.5 B3:0.5 E3:2'
  },
  {
    id: 'merry-go-round', title: "Merry-Go-Round of Life", composer: 'Joe Hisaishi', bpm: 96,
    data:
      'C5:1 E5:1 G5:1 C6:1 G5:1 E5:1 C5:2 G4:2 C5:1 E5:1 G5:1 D6:1 G5:1 D5:1 B4:2 G4:2 ' +
      'A4:1 C5:1 E5:1 A5:1 E5:1 C5:1 A4:2 F4:2'
  }
];

const player = { timers: [], current: null, start: 0, total: 0, fillTimer: null, card: null };

function nameToMidi(name) {
  const m = name.match(/^([A-G])([#b]?)(-?\d)$/);
  if (!m) return null;
  const steps = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let midi = (parseInt(m[3], 10) + 1) * 12 + steps[m[1]];
  if (m[2] === '#') midi++;
  if (m[2] === 'b') midi--;
  return midi;
}

function parseSong(data, bpm) {
  const beat = 60 / bpm;
  const events = [];
  let t = 0;
  for (const tok of data.trim().split(/\s+/)) {
    const [names, beatsStr] = tok.split(':');
    const beats = parseFloat(beatsStr) || 0.25;
    if (names !== 'R' && names !== '_') {
      for (const n of names.split('+')) {
        const midi = nameToMidi(n);
        if (midi != null) events.push({ midi, time: t, dur: beats * beat * 0.95 });
      }
    }
    t += beats * beat;
  }
  // harmonise lengths: a cover shorter than ~22s plays its phrase twice so
  // no cover feels cut short against the longer ones
  if (t < 22) {
    const first = events.slice();
    for (const ev of first) {
      events.push({ midi: ev.midi, time: ev.time + t, dur: ev.dur });
    }
    t *= 2;
  }
  return { events, total: t };
}

function renderSamples() {
  const list = document.getElementById('sampleList');
  list.innerHTML = '';
  SAMPLES.forEach((s, i) => {
    // show the true length straight from the note data
    const { total } = parseSong(s.data, s.bpm);
    const fmt =
      `${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')}`;
    const card = document.createElement('div');
    card.className = 'sample-card';
    card.innerHTML =
      `<span class="sample-fill"></span>` +
      `<span class="sample-num">${String(i + 1).padStart(2, '0')}</span>` +
      `<span class="sample-meta"><span class="sample-title"></span><span class="sample-composer"></span></span>` +
      `<span class="sample-dur">${fmt}</span>` +
      `<button class="btn ghost sample-play" data-sample="${s.id}">▶ Play</button>`;
    card.querySelector('.sample-title').textContent = s.title;
    card.querySelector('.sample-composer').textContent = s.composer;
    card.querySelector('.sample-play').addEventListener('click', () => {
      player.current === s.id ? stopSample() : playSample(s);
    });
    list.appendChild(card);
  });
}

function playSample(s) {
  stopSample();
  player.current = s.id;
  const { events, total } = parseSong(s.data, s.bpm);
  setStatus(`Now playing — ${s.title} (${s.composer})`);
  events.forEach(ev => {
    player.timers.push(setTimeout(() => {
      if (player.current !== s.id) return;
      engine.ensure();
      // token release: the cover only ever cuts its own voice, never the
      // note the user is playing along with
      const voiceId = engine.noteOn(ev.midi);
      pressVisual(ev.midi, true);
      spawnNoteAt(ev.midi);
      player.timers.push(setTimeout(() => {
        pressVisual(ev.midi, false);
        engine.noteOff(ev.midi, voiceId);
      }, ev.dur * 1000));
    }, ev.time * 1000));
  });
  // progress fill: grows left to right in the opposite theme colour
  const playBtn = document.querySelector(`.sample-play[data-sample="${s.id}"]`);
  const card = playBtn && playBtn.closest('.sample-card');
  if (card) {
    player.card = card;
    const fill = card.querySelector('.sample-fill');
    fill.style.transform = 'scaleX(0)';
    player.start = performance.now();
    player.total = total * 1000;
    player.fillTimer = setInterval(() => {
      if (!player.card) { clearInterval(player.fillTimer); player.fillTimer = null; return; }
      const pct = Math.min(1, (performance.now() - player.start) / player.total);
      player.card.querySelector('.sample-fill').style.transform = `scaleX(${pct})`;
      if (pct >= 1) { clearInterval(player.fillTimer); player.fillTimer = null; }
    }, 100);
  }
  player.timers.push(setTimeout(() => stopSample(), (total + 0.4) * 1000));
  updateSampleButtons();
}

function stopSample() {
  if (player.fillTimer) { clearInterval(player.fillTimer); player.fillTimer = null; }
  if (player.card) {
    const fill = player.card.querySelector('.sample-fill');
    if (fill) fill.style.transform = 'scaleX(0)';
    player.card = null;
  }
  player.current = null;
  player.timers.forEach(clearTimeout);
  player.timers = [];
  engine.panic();
  updateSampleButtons();
  setStatus('Ready.');
}

function updateSampleButtons() {
  document.querySelectorAll('.sample-play').forEach(btn => {
    const active = btn.dataset.sample === player.current;
    btn.textContent = active ? '■ Stop' : '▶ Play';
    btn.classList.toggle('playing', active);
    const card = btn.closest('.sample-card');
    if (card) card.classList.toggle('playing', active); // opposite-colour fill
  });
}

/* ============ Rotate-to-portrait prompt ============ */

const rotateOverlay = document.getElementById('rotateOverlay');

function updateRotatePrompt() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const landscape = matchMedia('(orientation: landscape)').matches;
  const small = window.innerWidth < 1000;
  rotateOverlay.classList.toggle('show', Boolean(coarse && landscape && small));
}

/* ============ Round cursor follower ============ */

function setupRoundCursor() {
  if (!window.matchMedia || !matchMedia('(pointer: fine)').matches) return;
  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  document.body.append(dot, ring);
  document.documentElement.classList.add('round-cursor');

  let tx = 0, ty = 0, rx = 0, ry = 0, raf = null;
  const frame = () => {
    raf = null;
    dot.style.transform = `translate(${tx}px, ${ty}px) translate(-50%, -50%)`;
    // the ring eases behind the pointer — the smooth "tusher" glide
    rx += (tx - rx) * 0.16;
    ry += (ty - ry) * 0.16;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
    if (Math.abs(tx - rx) > 0.1 || Math.abs(ty - ry) > 0.1) {
      raf = requestAnimationFrame(frame);
    }
  };
  const move = e => {
    tx = e.clientX; ty = e.clientY;
    if (!raf) raf = requestAnimationFrame(frame);
  };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerdown', () => ring.classList.add('down'));
  document.addEventListener('pointerup', () => ring.classList.remove('down'));
  document.addEventListener('pointercancel', () => ring.classList.remove('down'));
  document.documentElement.addEventListener('mouseleave', () => {
    dot.style.opacity = ring.style.opacity = '0';
  });
  document.documentElement.addEventListener('mouseenter', () => {
    dot.style.opacity = ring.style.opacity = '';
  });
}

/* ============ Piano "floats" — pointer is the light source ============ */

function setupPianoLight() {
  let px = 0, py = 0, raf = null;
  // vars live on the wrap so the piano, its keys and the shadow layer all inherit
  const host = pianoEl.closest('.piano-wrap') || pianoEl;
  const update = () => {
    raf = null;
    const r = pianoEl.getBoundingClientRect();
    if (r.width === 0) return;
    let vx = (px - (r.left + r.width / 2)) / (r.width / 2);
    let vy = (py - (r.top + r.height / 2)) / (r.height / 2);
    vx = Math.max(-1, Math.min(1, vx));
    vy = Math.max(-1, Math.min(1, vy));
    host.style.setProperty('--lsx', vx.toFixed(3));
    host.style.setProperty('--lsy', vy.toFixed(3));
  };
  window.addEventListener('pointermove', e => {
    px = e.clientX; py = e.clientY;
    if (!raf) raf = requestAnimationFrame(update);
  }, { passive: true });
  update();
}

/* ============ "i" info popover ============ */

const infoBtn = document.getElementById('infoBtn');
const infoPop = document.getElementById('infoPop');

infoBtn.addEventListener('click', e => {
  e.stopPropagation();
  infoPop.classList.toggle('hidden');
});

document.addEventListener('click', e => {
  if (!infoPop.classList.contains('hidden') && !infoPop.contains(e.target)) {
    infoPop.classList.add('hidden');
  }
});

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !infoPop.classList.contains('hidden')) {
    infoPop.classList.add('hidden');
  }
});

/* ============ Theme ============ */

const themeBtn = document.getElementById('themeBtn');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('keynote.theme', theme); } catch (e) { /* ignore */ }
  themeBtn.textContent = theme === 'light' ? '🌙 Dark' : '☀️ Light';
}

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
});

let savedTheme = 'dark';
try { savedTheme = localStorage.getItem('keynote.theme') || 'dark'; } catch (e) { /* ignore */ }
applyTheme(savedTheme);

/* ============ Init ============ */

loadLayout();
buildKeyMap();
buildPiano();
refreshAll();
renderSamples();
updateRotatePrompt();
window.addEventListener('resize', updateRotatePrompt);
window.addEventListener('orientationchange', updateRotatePrompt);
setupRoundCursor();
setupPianoLight();
// highlight the default octave
document.getElementById('octave').dispatchEvent(new Event('change'));
setStatus('Click a key or press a letter key to play.');
