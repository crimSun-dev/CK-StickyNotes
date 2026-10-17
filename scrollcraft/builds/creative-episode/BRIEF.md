# Interview answered by Draven, 2026-10-15. Do not re-ask.

## The eight answers (verbatim)

1. **Vibe.** Indigo corridor, neon script, paper notes, one yellow spark, calm and a little playful. References: the Creative Episode lounge wall, a subway wayfinding map, a music-player frame. Not other websites.
2. **Journey.** I arrive at the corridor sign. I am already in Creative Episode. I see the wall of notes. The last thing I do is write one and watch it stick.
3. **Energy.** Quiet in the chrome. A lift when the wall is full of color. The loudest moment is small: one new note landing. Then it is quiet again.
4. **Feeling.** First I know where I am. Then I feel that an idea does not need a form. The moment I should remember: my sentence is now a note on the shared wall, in my words, with or without a color.
5. **One thing no other site does.** The only navigation is the building's own wayfinding pills, and the scroll ends in a working note field, not a button that promises a product.
6. **Distance from premium-minimal.** Playful, held inside a premium corridor. Not brutalist, not maximalist, not retro, not a dense dashboard, not a fashion editorial.
7. **World or scenes.** Distinct rooms, not one unbroken camera flight. This page is a single room. Do not build worldflight.
8. **Assets.** Use the PNG library already in the repo under `Concept Art/PNG Asset Library/` when a file is clean enough. Generate or place only the assets listed in the asset brief. Do not redraw the Hongsam tiger, the Persija crest, or any person.

## Feeling curve

- Arrival: oriented. Cause: the six pills, Creative Episode marked current.
- Wall: pleasure. Cause: real notes in four paper colors on a dark board.
- Peak: relief. Cause: I commit a sentence and it becomes a note without a required category.
- After: quiet. Cause: the field clears and the new note sits with the others.

## Peak

"It's the site where the hallway sign is the menu, and my idea just sticks to the wall."
Lives in the close (the composer), and lands on the wall directly above it.

## Tell-someone sentence

It's the site where the KMK corridor is the interface and a brainstorm is a sticky note that actually saves.

## Authored silence

None. If a scroll range does nothing, that is a defect.

## Build notes (added during build)

- Grammar: 2.3 Live surface (chosen by Draven).
- Asset source: the `Concept Art/PNG Asset Library/` folder was not in the project folder on this machine. The same files arrived as the supplied ZIPs (`KMK-CK-Transparent-PNG-Assets.zip`, `Creative-Episode-Still-Assets.zip`). Used: `creative-episode.png` (neon wordmark), `good-ideas-start-here.png` (painted line). Both trimmed and converted to WebP; nothing generated, nothing redrawn.
- 2026-10-15 23:16: Draven supplied updated, more accurate transparent PNGs for the neon wordmark, the "Good Ideas Start Here" lettering and the neon lightbulb. The first two replace the earlier files (trimmed, WebP). `lightbulb.webp` is stored in assets but not placed, because the current pill's arrow is this page's one spark.
- The wayfinding sign is live markup, not the `wayfinding.png` image, because it is the navigation.

## Score (device per beat)

| Beat | Device | Why this one |
|---|---|---|
| Arrival (oriented) | `flow`, fixed corridor sign | The sign is real chrome. Nothing animates: you read where you are |
| Wall (pleasure) | `flow` + `in` stagger | Notes arrive once, 45ms apart, then stay put |
| Peak and close (relief, then quiet) | Bespoke landing (the flight) in a working `<form>` | The one engineered motion: the note leaves the field and sticks in its slot |

Product rule over skill default: the brief says the landing is the only engineered motion. That rules out pin choreography, reveal wipes and parallax, so the four-family variety rule is waived on purpose. Page length is about 2 viewport-heights. A tool should not pad to the 8 to 14vh budget.

## Feel check (cold scroll, then diff)

- Felt: oriented / pleasant / relief / quiet. Intended: oriented / pleasure / relief / quiet.
- Diff: with only three sample notes, the wall gives pleasure but not yet a "lift". The lift arrives as the real wall fills, and three samples cannot fake it. No page change was made for this.
- Peak check: the flight is the largest visual change on the page, and the end resolves to an empty field with the new note sitting directly above it.

## Revision, 2026-10-16: the real wall, plus a whiteboard (Draven's request)

- Page ground is now the room's grey marble (generated seamless tile, `assets/marble.webp`), not paper.
- The board is the real bottle shape: whiteboard on the left flowing into the felt bulb, one warm LED outline (SVG drawn from the measured layout at 1280px and wider; stacked panels with CSS LED rings below that). Paper flowers on the frame, as on the wall.
- Wall header matches the room: neon wordmark, marker line, neon lightbulb. The bulb and the pill arrow are two yellows on screen, accepted because the wall has both.
- New whiteboard: Black and Blue markers, stroke eraser, Undo, Clear, saved under `creative-episode.whiteboard.v1` (Neon replaces it later; done, see below). Strokes scale to stay fully visible when the board changes shape. On touch screens nothing draws until a marker is picked.
- Audit: re-audit OPEN (two P1s and two P2s, all whiteboard) → all fixed. The verdict after that was one P1 partial; it was fixed and verified locally (right-edge strokes stay visible at 1440, 1024 and 390), with the auditor's note that this change makes it PASS. The detector's only finding, `dark-glow`, is the LED strip, kept on purpose.
- Feel check: the arrival now lands straight on the wall, so "oriented" and "pleasure" merge into one first screen. The peak (the note landing) is unchanged.

## Revision, 2026-10-16: notes and whiteboard on Neon

- Both the notes and the whiteboard now persist in Neon Postgres through the wall server, shared by the office. Opened as a file, the page still runs on this device's `localStorage` (notes with labeled samples, the drawing under `creative-episode.whiteboard.v1`).
- The data layer moved out of `index.html` into `ce-store.js`, loaded after `ce-config.js`. A design pass on this page changes presentation only; it must keep both script tags, and `npm test` in `server/` must pass afterwards.
- Whiteboard copy: "Saving…", "Saved.", "Couldn't save N lines. They're still on your screen." with Retry, "Whiteboard cleared for everyone. Undo brings it back.", "The whiteboard is full. Clear it to keep drawing." Undo follows stroke ids, so it still works after the board refreshes.
- No visual change: same marble, bottle board, tray and tokens. Two Retry buttons appear only in their failure states.