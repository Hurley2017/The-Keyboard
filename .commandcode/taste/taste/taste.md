- Wants elements to look "floating" with shadows that treat the pointer as a light source (pointer position drives shadow direction/offset) — emphasized further: the piano should float into empty space and cast a shadow across the entire page (not just a fitted div), with black keys also behaving this way. Confidence: 0.8# Taste
- Prefers deliverables as web apps rather than native/desktop apps (explicitly: "make sure its a web app"). Confidence: 0.8
- Cares about visual design quality — explicitly requests "beautiful design" and expects polished, attractive UIs, not just functional ones. Confidence: 0.8
- Expects the assistant to actually run/serve the finished web app and open it in the browser ("run it please"), rather than just handing over run instructions. Confidence: 0.6
- Prefers Python/Flask as the backend framework for web apps when applicable (explicitly: "it should be a flask application"). Confidence: 0.7
- Prefers layouts that utilize the full screen / viewport ("utilize the whole screen for the piano"), not content capped at a fixed width. Confidence: 0.6
- Wants the app architecture to anticipate future extension (e.g. "in future I will add more instruments") — builds should be structured so new items are easy to add without rework. Confidence: 0.6
- Wants theming support in the UI — explicitly requested a light mode to pair with the existing dark theme, with a persisted toggle (light/dark). Confidence: 0.6
- Prefers a monochrome black-and-white "boxy" design aesthetic in the style of Command Code's UI — pure B&W palette (no color accents), square/sharply-angled corners, sharp 1px borders, uppercase mono text for buttons/labels with invert-on-hover. Referenced this as the design they like ("you know how command code website ui looks like"). Confidence: 0.8
- Expects pervasive micro-interactions/animation on essentially every UI action — button presses, theme/mode toggles, and key presses should animate, not just flip states ("add animation on everything"). Confidence: 0.7
- Dislikes default/system fonts and wants a curated modern pairing — e.g. a distinct display face combined with a mono face (chose Space Grotesk + JetBrains Mono), with letterspaced uppercase styling. Confidence: 0.6
- Values rich tactile/3D visual depth on interactive elements (bevels, gloss highlights, press-down drops), not flat or purely minimal surfaces. Confidence: 0.6
- Tests delivered features and reports problems with brief, direct functional-correctness feedback (e.g. "is not playing correctly, check them"), expecting the agent to investigate and fix rather than ask questions. Confidence: 0.5

## From later feedback session
- Avoids mixed side-by-side layouts — wants each major section to own its own full line, with content stacked vertically below (e.g. the piano on its own full-width row, covers below it, not beside it). Confidence: 0.8
- Wants instructional/helper text hidden behind an "i" info button that opens a popover, instead of visible sentences on the page. Confidence: 0.8
- Prefers a round custom cursor follower (a small dot + ring that responds/shrinks on click, matching tusher.in) over the native or custom-shaped cursor. Confidence: 0.7
- Wants elements to look "floating" with shadows that treat the pointer as a light source (pointer position drives shadow direction/offset). Confidence: 0.7
- Cares about frame-rate/performance under rapid input (e.g. fast repeated key presses / tremolo); visible lag is reported as a bug to diagnose and fix, and larger/complex effects should be throttled or cleaned up. Confidence: 0.6
- Prefers bounded lists over stacking everything — caps visible rows (e.g. 5) with its own scrollbar, and sets explicit caps on item counts (e.g. max 20 covers). Confidence: 0.6
- Explicitly wants animations GPU-accelerated with transform/opacity (plus `will-change`), avoiding per-frame repaints like re-painting box-shadow — lag is reported as a critical bug ("why everything's laggy, make sure it uses GPU acceleration"). Confidence: 0.7
- Prefers a crafted inline SVG brandmark/logo (black-and-white, theme-aware via CSS variables) over emoji placeholders for branding. Confidence: 0.6
- Wants notable content facts (e.g. transcribed song notes) double-checked against 2-3 authoritative sources before shipping, not just taken on trust. Confidence: 0.6
- Shows an element's active/in-progress state by inverting it to the opposite theme color fill (fits the monochrome invert aesthetic). Confidence: 0.6
- Prefers playback/progress state shown as a growing left→right fill bar in the OPPOSITE theme color (black in light mode, white in dark mode) that animates with the playhead across the row (this replaced the earlier whole-card invert approach). Confidence: 0.8
- Prefers fuller/more complete renditions of songs over brief excerpts (e.g. turning complex covers into full-length pieces). Confidence: 0.5
oice-token isolation). Confidence: 0.7

## From latest feedback session
- Prefers a curated list of genuinely famous/well-known covers over a custom or arbitrary selection — explicitly requested to "remove all the covers, add the famous ones." Confidence: 0.8
- Prefers the cover list laid out as a table-style row: `Cover Name : Artist | Duration | Play/Stop` in aligned columns (name/artist, duration, action button). Confidence: 0.7
- Explicitly wants the playback progress fill to animate SMOOTHLY/continuously (rAF-driven), not stepped or quantized to per-second cells — called out the second-by-second color cell approach as not smooth enough. Confidence: 0.8
- Wants the "floating" shadow on an element to be a plain clean box-shadow directly on that element — explicitly disliked a separate background shadow-box layer/div behind it ("what is the background thingy behind the piano, just add shadows, it should look like the piano is floating") and had it removed. Confidence: 0.7
- For identifying a specific song/track they reference, prefers providing a direct source link (YouTube/Music URL) and expects the assistant to look the song up from that link rather than guess from a mis-transcribed title. Confidence: 0.6
- Wants work progress pushed to git ("push the progress to git") — expects the assistant to commit and push completed milestones rather than leaving work uncommitted. Confidence: 0.6
- Wants a memory/handoff file created to continue work in future sessions, explicitly requesting one ("make a memory file please, to continue further") as a durable record of ongoing state. Confidence: 0.6
