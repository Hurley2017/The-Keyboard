# The-Keyboard

> Can't afford a Yamaha? Your keyboard is now a grand piano.

A web app that turns your computer keyboard into a **61-key piano** — glossy black,
gold-trimmed, sounding like a real instrument. Press keys, hold them to sustain,
remap any key to any note, and play.

No audio files — the sound is synthesized live in your browser with the Web Audio API.

## Run it locally

```sh
pip install -r requirements.txt
python api/index.py
# then open http://127.0.0.1:5000
```

The app is sub-path aware: it works at the root **and** at
`http://127.0.0.1:5000/The-Keyboard/` (that's how it can live at `tusher.in/The-Keyboard`).

## Playing

A **61-key piano (C2 → C7)**. Every row of your keyboard is a contiguous ascending
scale, so melodies fall right under your fingers:

| Row         | Keys                              | Notes                                        |
|-------------|-----------------------------------|----------------------------------------------|
| Number row  | `1 2 3 4 5 6 7 8 9 0 -`           | C6 D6 E6 F6 G6 A6 B6 C7 + F#6 G#6 A#6       |
| Q row       | `Q W E R T Y U I O P [ ]`         | Black keys C#4–D#6                            |
| Home row    | `A S D F G H J K L ; '`           | F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5             |
| Bottom row  | `Z X C V B N M , . /`             | C3 D3 E3 F3 G3 A3 B3 C4 D4 E4                |

The mapped key is printed on each piano key. This covers every white key C3–C7 and
every black key C#4–A#6 (44 of 61 notes). The deep-bass octave (C2–B2) and the
octave-3 sharps have no default key — a keyboard has fewer keys than a piano — but
they're fully remappable (and clickable with the mouse).

- **Hold** a key to sustain the note (release fades it out).
- **Click / touch** piano keys to play with the mouse or finger.
- **Volume** slider at the top.

## Remapping

1. Click **Remap** (or click any row in the "Current mapping" list).
2. Click a piano key — it lights up, and you'll hear it.
3. Press the keyboard key you want to assign to it. Done — saved automatically.
4. Repeat as much as you like. `Esc` cancels.

Click the **×** on a mapping row to unassign it, or **Reset** to restore defaults.
Everything persists in your browser's `localStorage`.

## How it sounds

- **Additive synthesis**: a fundamental plus a few slightly detuned harmonics.
- Fast attack, natural piano-like decay, quick release on key-up.
- A procedurally-generated **reverb** and a gentle compressor add space and warmth —
  no sample files needed.

## Deploy to Vercel

Already configured via [`vercel.json`](vercel.json) (Python + Flask runtime):

```sh
vercel          # preview
vercel --prod   # production
```

Or push to GitHub and import the repo at vercel.com/new — it auto-detects the Python
project. You'll get a URL like `the-keyboard-xxxx.vercel.app`.

### Serving it at tusher.in/The-Keyboard

**Option A — reverse proxy (URL stays `tusher.in/The-Keyboard/`):** point the
`/The-Keyboard` path on your portfolio host at the Vercel deployment.

```nginx
location /The-Keyboard/ {
    proxy_pass https://the-keyboard-xxxx.vercel.app/;
    proxy_set_header Host $host;
}
```

**Option B — redirect (simplest):**

```nginx
rewrite ^/The-Keyboard/?$ https://the-keyboard-xxxx.vercel.app/ permanent;
```

> Tip: prefer the trailing-slash form — `tusher.in/The-Keyboard/` — so the page's
> relative asset links (`static/style.css`, `static/app.js`) resolve correctly.

## Project layout

```
api/index.py         — Flask app (serves page + static, sub-path aware)
templates/index.html — page structure
static/style.css     — glossy grand-piano theme
static/app.js        — audio engine, note math, mapping, remap UI
requirements.txt     — Python deps (flask)
vercel.json          — Vercel build + routing config
README.md            — you are here
```

## Ideas for next steps

- Octave shift buttons (map once, play anywhere)
- Sustain pedal / hold toggle
- Recording & playback
- Export/import custom mappings
- MIDI keyboard support
