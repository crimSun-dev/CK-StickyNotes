# Product

<!-- impeccable:product-schema 1 -->

Written from Draven's confirmed product truth, 2026-10-15. No interview round was run: the brief states these facts are confirmed and asks not to be interviewed again.

## Platform

web

## Stack

One semantic HTML page, themed on the Scrollcraft engine tokens (engine files copied, never edited), served by a small Node server on the private office network. Notes and whiteboard strokes persist in Neon Postgres, connected only from the server, and are shared by everyone at the company. The page's data layer is its own file, `ce-store.js`; `index.html` only presents. Opened directly as a file (no server), the page falls back to this device's `localStorage`, with labeled sample notes. Note shape: `id`, `body` (required text), `color` (`blue` | `pink` | `green` | `yellow` | null), `createdAt`. No category field. Stroke shape: `id`, `ink` (`black` | `blue`), `width`, `points` (up to 1000 `[x, y]` pairs), `createdAt`; the board holds up to 1500 lines.

## Users

People who work inside KMK Group and, later, sister companies under CCG. They are standing in the real headquarters in Indonesia, or opening a laptop in the lounge called Creative Episode. Their job on this first version: put an idea on a shared wall in a few seconds, in whatever language comes out.

## Product Purpose

One private hub on one SQL database (Neon Postgres, server-side only). This version is the brainstorm board. Money Lab (the room on the sign called The M-Lab) is a later room on the same database, where Excel workbooks become rows. It is not built on this page.

Success: a stranger can add a note with no color, see it on the wall, edit it, and delete it, from a phone and from a keyboard, and the only place names on screen are the ones painted in the building.

## Positioning

The navigation is the painted wayfinding already on the corridor wall. A note is a row. A missing color does not block the save.

## Operating Context

- A private collaboration tool, not a marketing page.
- Used standing in the headquarters or seated in the Creative Episode lounge, on phones and laptops.
- Ideas arrive in mixed languages (Indonesian, English, Korean).
- Rooms on the corridor sign, with arrow directions: Founder & Story Producer (up), Black Box (up), CK Hall (left), Creative Episode (left), GM (right), The M-Lab (right). Creative Episode is the open room. The others appear as the map and do not navigate to fake pages. The M-Lab may carry "Money Lab" in a title attribute or a quiet status, and opens no finance tool. Energy Corner exists in the building but is not on the sign and stays off this page.

## Capabilities and Constraints

Does:
- Shows one board.
- Lets a person type a note, optionally choose one of four colors, and see the note appear on the board.
- Edits and deletes a note.
- A shared whiteboard (added 2026-10-16 at Draven's request): freehand drawing with black and blue markers, a stroke eraser, undo and clear. Ink appears at once and saves to Neon in the background; if a save fails the lines stay on screen and the status says how many are not saved yet, with Retry. Clear is one tap and clears the board for everyone; Undo brings it back. On touch screens nothing draws until a marker is picked, so the page still scrolls.
- Saves a note with no color.
- Real empty, saving, saved, and failed states.
- Sample notes (only when the page is opened without the server) are labeled "Sample" in the interface; the board logic still runs (add, edit, delete). Served by the server, the wall never shows samples: if it cannot load, it says so and offers Retry.
- Changes from colleagues appear when you come back to the tab (no live push in this version).

Does not:
- No second menu, sidebar, or footer that renames the rooms.
- No tags, votes, comments, assignees, due dates, or AI sorting. (The whiteboard is the one addition beyond notes, requested by Draven.)
- No theme toggle, no dark-mode switch.
- No public marketing claims, prices, invented customer counts, ERP screens, or charts.
- No likeness of CK Song, Shin Tae-yong, or any employee. No Persija crest, no Adidas mark, no jersey.
- The Neon connection string never appears in the browser, the HTML, or a comment shipped to the client.

## Brand Commitments

- Name on the page: **Creative Episode**. The line painted in the room: **"Good Ideas Start Here"**.
- Never rename the product, never add a startup name, never say "portal", "workspace", or "AI".
- The page reproduces the real Creative Episode wall: grey marble, the neon wordmark, the marker line with the neon bulb, and the bottle-shaped whiteboard and felt board inside a warm LED strip (requested 2026-10-16).
- Binding colors sampled from the headquarters: indigo `#2E3A8C`, periwinkle `#5B63B8`, yellow `#EFE52B` (one spark per view), paper `#F4F2EE`, board `#16161C`, note blue `#7EC8E3`, note pink `#F4A7C3`, note green `#C5E87A`, note yellow `#FFE56B`. Red `#E2231A` belongs to the ON AIR lamp in another room and never appears here.
- Type: one rounded geometric sans for pills, notes, and the form, close to the painted corridor sign. Not Inter, DM Sans, Outfit, Plus Jakarta Sans, Space Grotesk, Space Mono, IBM Plex, or a display serif.
- Materials: paper notes with slight rotation, dark felt board, indigo pills with white type. Flat. No glassmorphism, gradient text, emoji icons, section numbers, or eyebrow labels.

## Evidence on Hand

- `Creative Episode Still Assets` (supplied): neon wordmark, "Good Ideas Start Here" lettering, lightbulb, four blank notes, empty felt board, two paper flowers, empty-wall mark.
- `KMK-CK Transparent PNG Assets` (supplied): reference library including `creative-episode.png`, `good-ideas-start-here.png`, `wayfinding.png`. Person, crest, and third-party marks in that library are off-limits for this page.
- No real notes, user counts, or usage figures exist yet. None may be invented.

## Product Principles

1. An idea does not need a form: a sentence is enough to save.
2. The building is the interface: the painted sign is the only navigation.
3. Every state is real: what the screen says happened, happened.
4. Quiet chrome, colorful wall.

## Accessibility & Inclusion

WCAG 2.1 AA. Color choice is a radiogroup with visible names, never color alone. Visible focus rings. The composer is a real form with a label. Hit targets at least 44px. Honor `prefers-reduced-motion`. Body contrast at least 4.5:1, including note text on pastel paper. Mixed-language input (Latin, Korean) must render.
