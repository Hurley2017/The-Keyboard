# The-Keyboard

Cant afford a Yamaha, so Have to map my "WASD" into some tunes... Lets see how it turns out

## What is this?

A tiny web app that turns your computer keyboard into a piano. Press keys, hear piano
sounds, and remap any key to any note you like. No installs, no audio files — the sound
is synthesized live in your browser with the Web Audio API.

## Run it locally (Flask)

```sh
pip install -r requirements.txt
python api/index.py
# then open http://127.0.0.1:5000
```

The app is sub-path aware: it works at the root **and** at
`http://127.0.0.1:5000/The-Keyboard/` (that's how it can live at `tusher.in/The-Keyboard`).

## Playing

- **A 61-key piano (C2 → C7)**, like a real keyboard. Every row is a
  contiguous ascending scale, so melodies fall right under your fingers:

  | Row         | Keys                                | Notes                                        |
  |-------------|-------------------------------------|----------------------------------------------|
  | Number row  | `1 2 3 4 5 6 7 8 9 0 -`             | C6 D6 E6 F6 G6 A6 B6 C7 F#6 G#6 A#6         |
  | Q row       | `Q W E R T Y U I O P [ ]`           | C#4 D#4 F#4 G#4 A#4 C#5 D#5 F#5 G#5 A#5 C#6 D#6 |
  | Home row    | `A S D F G H J K L ; '`             | F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 B5            |
  | Bottom row  | `Z X C V B N M , . /`               | C3 D3 E3 F3 G3 A3 B3 C4 D4 E4               |

  The mapped key is printed on each piano key, so it's always easy to read.
  This covers every white key C3–C7 and every black key C#4–A#6 (44 of 61).
  The only notes without a default key are the deep-bass octave (C2–B2) and
  the octave-3 sharps — a keyboard simply has fewer keys than a piano, so
  those are left free for you to remap (they still work with the mouse).

- **Hold** a key to sustain the note (release fades it out).
- **Click / touch** piano keys to play with the mouse or finger.
- A **volume** slider is available at the top.

## Remapping

1. Click **Remap keys** (or click any row in the "Current mapping" list).
2. Click a piano key — it lights up, and you'll hear it.
3. Press the keyboard key you want to assign to it. Done — it saves automatically.
4. Keep clicking keys and pressing keys to remap as many as you like. Press `Esc` to cancel.

Click the **×** on any row in the mapping list to unassign that key, or **Reset mapping**
to restore the defaults. Everything is persisted in your browser's `localStorage`.

## How it sounds

- Each note is **additive synthesis**: a fundamental plus a few slightly detuned harmonics.
- Fast attack, natural piano-like decay, quick release on key-up.
- A procedurally-generated **reverb** and a gentle compressor give it some space without
  needing any sample files.

## Deploy to Vercel

The project is already set up for Vercel with [`vercel.json`](vercel.json) (Python + Flask runtime):

1. Install the Vercel CLI and log in:
   ```sh
   npm i -g vercel
   vercel login
   ```
2. From this folder:
   ```sh
   vercel
   ```
   It will give you a URL like `the-keyboard-xxxx.vercel.app`. The page is live there immediately.
3. Deploy to production with `vercel --prod`, or just push to a GitHub repo and
   [import it into Vercel](https://vercel.com/new) (it auto-detects the Python project).

> **Vercel notes** — the `vercel.json` routes let the app also be reached at
> `<your-deployment>/The-Keyboard/` directly. Static assets are served by Flask from the
> `static/` folder so everything keeps working under the sub-path.

## Serving it at tusher.in/The-Keyboard

Two easy options, pick whichever fits how `tusher.in` is currently hosted:

**Option A — reverse proxy (URL stays `tusher.in/The-Keyboard/`).**
On whatever serves your portfolio, proxy the `/The-Keyboard` path to your Vercel deployment:

- **nginx** (typical):
  ```nginx
  location /The-Keyboard/ {
      proxy_pass https://the-keyboard-xxxx.vercel.app/;
      proxy_set_header Host $host;
  }
  ```
  (If your proxy keeps the path instead of stripping it, that works too — Flask handles both.)
- **Cloudflare Page Rule / Worker**, **Netlify redirects**, or any host that supports
  path-based proxying can do the same.

**Option B — redirect (simplest).**
Point `tusher.in/The-Keyboard` at the Vercel URL with a 302. The address bar changes to
`the-keyboard-xxxx.vercel.app`, but it's zero-config:

```nginx
rewrite ^/The-Keyboard/?$ https://the-keyboard-xxxx.vercel.app/ permanent;
```

> **Tip:** prefer a trailing slash — `tusher.in/The-Keyboard/` — so the page's relative
> asset links (`static/style.css`, `static/app.js`) resolve correctly.

## Project layout

```
api/index.py        — Flask app (serves the page + static files, sub-path aware)
templates/index.html— page structure
static/style.css    — all styling (dark theme, glowing keys)
static/app.js       — audio engine, note math, mapping, remap UI
requirements.txt    — Python deps (flask)
vercel.json         — Vercel build + routing config
README.md           — you are here
```

## Ideas for next steps

- Octave shift buttons (map once, play anywhere)
- Sustain pedal / hold toggle
- Recording & playback of what you play
- Export/import custom mappings
- MIDI keyboard support
