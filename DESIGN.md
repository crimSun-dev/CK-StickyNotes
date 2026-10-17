---
name: Creative Episode
description: The brainstorm wall of KMK's Creative Episode lounge. Good Ideas Start Here.
colors:
  indigo: "#2E3A8C"
  periwinkle: "#5B63B8"
  spark: "#EFE52B"
  led: "#FFC24E"
  marble: "#9C9CA1"
  paper: "#F4F2EE"
  board: "#16161C"
  whiteboard: "#FDFDFC"
  whiteboard-shade: "#E9EAEA"
  note-blue: "#7EC8E3"
  note-pink: "#F4A7C3"
  note-green: "#C5E87A"
  note-yellow: "#FFE56B"
  note-none: "#FBFAF7"
  ink-soft: "#1A1C30"
  on-board-soft: "#C9C8D6"
  note-meta: "#3A3A4E"
  white: "#FFFFFF"
typography:
  headline:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "clamp(1.6rem, 1.35rem + 1.2vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "clamp(1.2rem, 1.1rem + 0.5vw, 1.5rem)"
    fontWeight: 600
  body:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "clamp(1rem, 0.96rem + 0.22vw, 1.125rem)"
    fontWeight: 400
    lineHeight: 1.62
    letterSpacing: "-0.005em"
  note:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 450
    lineHeight: 1.42
    letterSpacing: "-0.005em"
  note-input:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 450
    lineHeight: 1.45
  label:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "-0.005em"
  button:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1
  small:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "clamp(0.875rem, 0.84rem + 0.18vw, 0.95rem)"
    fontWeight: 400
  meta:
    fontFamily: "Rubik, ui-rounded, system-ui, sans-serif"
    fontSize: "clamp(0.75rem, 0.72rem + 0.15vw, 0.82rem)"
    fontWeight: 400
rounded:
  note: "4px"
  field: "6px"
  canvas: "18px"
  board: "30px"
  board-phone: "22px"
  bottle-end: "46px"
  pill: "999px"
  disc: "50%"
spacing:
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.5rem"
  "6": "2rem"
  "7": "3rem"
  sign-gap: "8px"
  tray-gap: "6px"
  stack-gap: "28px"
  tap: "44px"
  gutter: "clamp(1.25rem, 5vw, 5.5rem)"
components:
  sign-pill:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 18px 5px 5px"
    height: "44px"
  sign-pill-right:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "5px 5px 5px 18px"
  sign-pill-arrow:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.white}"
    rounded: "{rounded.disc}"
    size: "34px"
  sign-pill-arrow-current:
    backgroundColor: "{colors.spark}"
    textColor: "{colors.indigo}"
    rounded: "{rounded.disc}"
    size: "34px"
  sign-pill-current-hover:
    backgroundColor: "{colors.periwinkle}"
  felt-board:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paper}"
    rounded: "{rounded.board}"
    padding: "clamp(1.25rem, 2.6vw, 2.25rem)"
  felt-board-wide:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paper}"
    padding: "30px 32px 30px 36px"
  whiteboard:
    backgroundColor: "{colors.whiteboard}"
    textColor: "{colors.board}"
    rounded: "{rounded.board}"
    height: "clamp(340px, 46svh, 470px)"
  whiteboard-wide:
    backgroundColor: "{colors.whiteboard}"
    rounded: "{rounded.bottle-end}"
  whiteboard-tool:
    backgroundColor: "{colors.white}"
    textColor: "{colors.board}"
    typography: "{typography.small}"
    rounded: "{rounded.pill}"
    padding: "0 13px 0 9px"
    height: "44px"
  whiteboard-tool-pressed:
    backgroundColor: "{colors.white}"
    textColor: "{colors.board}"
    rounded: "{rounded.pill}"
  marker-ink-black:
    backgroundColor: "{colors.board}"
    rounded: "{rounded.disc}"
    size: "18px"
  marker-ink-blue:
    backgroundColor: "{colors.indigo}"
    rounded: "{rounded.disc}"
    size: "18px"
  paper-note:
    backgroundColor: "{colors.note-none}"
    textColor: "{colors.board}"
    typography: "{typography.note}"
    rounded: "{rounded.note}"
    padding: "18px 16px 8px 18px"
  paper-note-blue:
    backgroundColor: "{colors.note-blue}"
  paper-note-pink:
    backgroundColor: "{colors.note-pink}"
  paper-note-green:
    backgroundColor: "{colors.note-green}"
  paper-note-yellow:
    backgroundColor: "{colors.note-yellow}"
  paper-note-edit:
    textColor: "{colors.board}"
    rounded: "{rounded.note}"
    padding: "16px"
  note-tool:
    textColor: "{colors.note-meta}"
    rounded: "{rounded.disc}"
    size: "44px"
  sample-tag:
    textColor: "{colors.note-meta}"
    typography: "{typography.meta}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  composer-paper:
    backgroundColor: "{colors.note-none}"
    textColor: "{colors.board}"
    typography: "{typography.note-input}"
    rounded: "{rounded.note}"
    padding: "20px 22px"
  swatch:
    backgroundColor: "{colors.white}"
    textColor: "{colors.board}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px 0 8px"
    height: "44px"
  swatch-chip:
    rounded: "{rounded.disc}"
    size: "26px"
  button-primary:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.periwinkle}"
  button-primary-busy:
    backgroundColor: "{colors.periwinkle}"
  button-stick:
    backgroundColor: "{colors.indigo}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "0 28px"
    height: "52px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.board}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "44px"
  button-ghost-on-board:
    backgroundColor: "transparent"
    textColor: "{colors.paper}"
  empty-slot:
    textColor: "{colors.paper}"
    rounded: "{rounded.note}"
    size: "clamp(8.5rem, 16vw, 11rem)"
---

# Design System: Creative Episode

## Overview

**Creative North Star: "The Corridor Wall"**

The page is the room's actual wall, flattened. The ground is grey marble with thin pale veins. The headquarters' own painted wayfinding sits on it: a stack of indigo pills with white rounded type and periwinkle arrow discs, one of them lit with a yellow disc because that is the room you are standing in. Beside it is the wall as built. Across the top run the neon "Creative Episode" wordmark, the marker-written "Good Ideas Start Here" and a neon lightbulb. Below them is the bottle board: one shape, a long whiteboard on the left that flows into a felt-black bulb on the right, outlined by a single warm LED strip. Square paper notes in four pastels or plain paper sit on the felt, each tilted a degree or two as if pressed on by hand. Paper flowers sit on the frame. The whiteboard really draws. The page ends in a sheet of paper you can write on. Nothing on screen is a web convention dressed up; every surface is a material that exists in the room.

Density is low and the chrome is quiet so the wall can be loud. Color lives in the notes, the neon and the LED; the interface around them is indigo, marble, felt and white. Depth is physical and soft. Notes sit on the felt with a short contact shadow. The bottle is lit by its LED strip rather than lifted by a shadow. One moment of real motion (the flight) carries a new note from the field to its slot. Everything else is still.

Rejected outright, by brand commitment: glassmorphism, gradient text, emoji icons, section numbers, eyebrow labels, a theme toggle, and red. Glow is rejected everywhere except the LED strip, which is a real light in the room.

**Key Characteristics:**
- The materials are the room's: marble wall, indigo sign, neon lettering, the LED-lit bottle (whiteboard + felt), paper notes, paper flowers.
- One rounded geometric sans (Rubik) for every word the interface sets; wordmark, marker line and bulb are supplied images.
- Flat surfaces with soft, hue-tinted contact shadows; the LED strip is the only light source and the only glow.
- Pills, discs and near-square paper for controls and notes; one large organic bottle silhouette for the board.
- Exactly one engineered motion; the rest is a one-time reveal and state transitions.
- Light only, by design.

## Colors

The palette is sampled from the headquarters and the Creative Episode wall and is binding. Indigo and periwinkle are for the sign. There is one yellow spark in the interface and one warm LED. Marble, felt and whiteboard are the grounds, and there are four pastel note papers.

### Primary
- **Corridor Indigo** (#2E3A8C): The sign. Every corridor pill, the primary button, focus outlines, the selected swatch and pressed whiteboard-tool border, the composer's focused edge, and the Blue whiteboard marker. The color of action and of place.

### Secondary
- **Arrow Periwinkle** (#5B63B8): The arrow disc inside every non-current pill, and the hover and busy state of anything indigo. Never a ground for text larger than a button label.

### Tertiary
- **The Spark** (#EFE52B): One interface element per view: the arrow disc of the current pill ("Creative Episode"), with an indigo arrow on it. It is a marker of "you are here", not an accent to spread.
- **LED Amber** (#FFC24E): The warm LED strip that outlines the bottle board, and its amber glow. Nothing else uses it.

### Neutral
- **Marble** (#9C9CA1): The page ground. It is the mean tone of a generated grey marble tile (`assets/marble.webp`, repeated at 1200px) that carries thin pale veins. The flat value is the fallback and the theme-color.
- **Felt Board** (#16161C): The felt bulb of the bottle, and the ink for all text on marble, on whiteboard and on notes. The same value does both jobs, so the page reads as materials rather than a theme.
- **Corridor Paper** (#F4F2EE): Text and focus outlines on the felt board.
- **Whiteboard** (#FDFDFC → #E9EAEA): The whiteboard surface, a slight top-to-bottom sheen (172deg, through #F3F4F3) like a real gloss board catching the room light.
- **Plain Note Paper** (#FBFAF7): The note with no color, and the default composer sheet. Slightly warmer and lighter than the whiteboard so a plain note still reads as paper.
- **Marble Ink Soft** (#1A1C30): Secondary text on marble: the "(optional)" in the swatch legend and the composer hint and status. A blue-black that holds 4.8:1 on the marble's darkest patch.
- **Felt Soft** (#C9C8D6): Secondary text on the board: the sample line, board status and empty-wall copy. 10.9:1 on felt.
- **Note Meta** (#3A3A4E): Timestamps, the Sample tag, and the edit/delete tools on a note. Holds 5.9:1 on the palest pastel.
- **White** (#FFFFFF): Type on indigo, and the ground of unselected swatch and whiteboard-tool pills.

### Note papers
- **Note Blue** (#7EC8E3), **Note Pink** (#F4A7C3), **Note Green** (#C5E87A), **Note Yellow** (#FFE56B): Note and composer backgrounds only, plus the matching swatch chips. Felt Board ink sits on every one of them. They never color chrome, text, borders, or buttons.

### Named Rules
**The One Spark Rule.** Spark yellow (#EFE52B) appears on exactly one interface element per view: the current pill's arrow disc. The neon lightbulb and the yellow "Episode" in the neon wordmark are supplied images of what is mounted on the real wall. They are accepted as the spark's painted twins and are never extended into interface color. Note Yellow (#FFE56B) is paper, and LED Amber (#FFC24E) is light; neither is the spark.

**The No Red Rule.** Red belongs to the ON AIR lamp in another room. It never appears here, including in error states. Errors are carried by Felt Board ink at weight 600, a heavier 2px ink edge on the field, and an alert icon.

**The Quiet Chrome Rule.** Pastels are for paper and amber is for the LED. Chrome is indigo, periwinkle, marble, felt and white; if a control needs a new color to be understood, the control is wrong.

## Typography

**Display Font:** none (the "Creative Episode" neon wordmark, the "Good Ideas Start Here" marker lettering and the neon bulb are supplied images, never set in type)
**Body Font:** Rubik (variable 300–900, self-hosted latin + latin-ext, with ui-rounded, system-ui fallback)

**Character:** One rounded geometric sans, chosen because it is the nearest match to the painted corridor sign. Soft terminals keep it friendly; heavier weights (600) carry hierarchy instead of size jumps. Korean and other scripts fall back to the system face and must still render.

### Hierarchy
- **Headline** (600, clamp(1.6rem → 2.25rem), 1.15, -0.02em): The composer label "Your idea" and the empty-wall heading "Nothing on the wall yet." This is the top of the ramp. The page's h1 is the wordmark image, and the wall and whiteboard headings are visually hidden.
- **Title** (600, clamp(1.2rem → 1.5rem)): The note count at the head of the felt.
- **Body** (400, clamp(1rem → 1.125rem), 1.62): Empty-wall copy, held to 36ch.
- **Note** (450, 1rem, 1.42): The words on a paper note. `pre-wrap` and `overflow-wrap: anywhere`, direction auto.
- **Note Input** (450, 1.25rem, 1.45): The composer field. Bigger than a note so writing feels roomy.
- **Label** (500, 1rem, 1.1): Corridor pills and swatch names. Selected swatch goes to 650.
- **Button** (600, 1rem, 1): All buttons and the jump links. The felt's "Write a note" link uses Button weight at Small size.
- **Small** (400, clamp(0.875rem → 0.95rem)): The felt's sample line, status lines, the edit label (600), whiteboard tools (500; 650 when pressed) and the whiteboard hint.
- **Meta** (400, clamp(0.75rem → 0.82rem)): Note timestamps, the Sample tag (600) and the whiteboard save status.

### Named Rules
**The One Face Rule.** Rubik sets every word the interface writes. No second family, no display serif, no mono.

**The Weight Not Size Rule.** The ramp tops out at the headline. Emphasis comes from 600 weight and indigo, never from a giant hero size; the big type on this page is neon and marker, not typeset.

## Layout

A single scroll of two acts on the marble: the room (the corridor sign and the wall) and the close (the composer).

- **Sign.** A grid of pills, 8px apart and left-aligned. Pills pointing right (GM, The M-Lab) align to the right edge of the stack with their arrow at the end, as painted. At 1024px and wider the sign is `position: fixed` top-left at reading size. The room and composer are indented past it (gutter + 17.5rem sign width + clamp(2rem, 4vw, 4rem)), so the sign stays in view the whole way down like the real sign on the wall. Narrower than that, it sits at the top of the flow.
- **The bottle, 1280px and wider.** A two-column grid: whiteboard column `minmax(0, 1fr)` and felt column `minmax(23rem, 0.72fr)`, with no gap. The wall header occupies the left column above the whiteboard, and the felt spans both rows on the right. The header's right padding clears the neck (a `--neck` of 10% of the bottle width, held between 80px and 140px). The whiteboard's canvas and tray are inset by the neck so nothing draws under the felt's belly. Notes pack tighter: `minmax(8.75rem, 1fr)` columns and a 14px gap.
- **The bottle, below 1280px.** The panels stack in the order header, felt, whiteboard, 28px apart. Each is a separate rounded panel with its own LED ring. The whiteboard is clamp(340px, 46svh, 470px) tall.
- **Wall grid.** `repeat(auto-fill, minmax(12rem, 1fr))` with clamp(1rem, 2.2vw, 1.75rem) gaps and square notes. An editing note spans two columns.
- **Phone, 700px and narrower.** The room gutter narrows to 12px. The felt pads 18px/14px with a 22px radius, and the whiteboard is 22px radius and clamp(360px, 62svh, 520px) tall. The wall has two columns with a 14px gap, and notes lose the square ratio for a 10rem minimum height. The whiteboard status drops to its own line. At 380px and narrower the wall has one column.
- **Composer.** A two-area grid under a full-width label: paper 1.25fr and side 0.9fr (16rem minimum), max width 64rem. On phones it stacks label, paper, side.
- **Spacing.** The engine's 4px-based scale (0.5, 0.75, 1, 1.5, 2, 3rem) with a fluid page gutter of clamp(1.25rem, 5vw, 5.5rem). Every interactive target is at least 44px tall.

## Elevation & Depth

Depth is physical and quiet: soft, two-part shadows (a tight contact line plus a short diffuse fall) tinted toward the felt's blue-black (hsl 240 20% 6%), never colored halos and never blur effects. Three engine levels plus one note-specific shadow. The bottle board is the exception. It has no drop shadow; it is lit by its LED strip, which is the page's only light source.

### Shadow Vocabulary
- **Pressed** (`--sc-e1`: `0 1px 2px / .28, 0 2px 6px -1px / .20`): The current pill and the Stick it button: the two things you are meant to touch first.
- **Hung** (`--sc-e2`: `0 2px 4px / .24, 0 8px 18px -4px / .30`): The composer paper on the marble.
- **On the felt** (`0 1px 1px hsl(240 30% 2% / .4), 0 10px 18px -8px hsl(240 30% 2% / .7)`): Paper notes on the board. Darker than e2 because it falls on near-black felt.
- **In flight** (`--sc-e3`, three layers to 0 48px 90px -24px): Only the flying note clone, for the 680ms it is in the air.
- **LED ring** (`0 0 0 3px #FFC24E, 0 0 6px 3px rgb(255 196 84 / .75), 0 0 18px 4px rgb(247 178 52 / .4)`): Each stacked panel below 1280px. At 1280px and wider the same light is an SVG stroke: 3.5px LED Amber with `drop-shadow(0 0 5px rgb(255 196 84 / .95)) drop-shadow(0 0 14px rgb(247 178 52 / .55))`.

### Named Rules
**The Material Shadow Rule.** A shadow means an object is resting on something: paper on felt, the composer sheet on marble, a note in the air. Nothing gets a shadow for emphasis alone.

**The LED Exception Rule.** The only glow on the page is the LED strip around the bottle board, because it is a physical light on the real wall. It is a deliberate exception to the no-glow stance and stays even though automated detectors flag it. No other element may glow, and the LED never outlines anything but the board.

## Shapes

Two radius families for controls and paper, deliberately far apart. **Fully round** for the sign and controls: pills (999px), arrow discs, swatch chips, marker-ink dots and note tools (50%). **Nearly square** for paper: notes and the composer sheet (4px), the edit field (6px).

**The bottle** is the one large organic shape. At 1280px and wider it is drawn as a single SVG path measured from the live layout and redrawn on every resize. The whiteboard is a long rounded bar (46px ends). Its top edge rises in a concave shoulder (a cubic curve) into the taller felt bulb, whose outer corners round at 34px. The felt's lower edge sweeps back into the whiteboard in a convex belly. When the felt runs taller than the whiteboard, the outline steps down with 16px corners. The LED path traces the same silhouette. Below 1280px the bottle comes apart into two plain rounded panels (30px; 22px on phones), and the drawing canvas inside the whiteboard rounds at 18px.

Paper is tilted, chrome is not. Each note carries a deterministic tilt between -2deg and +2deg (never less than 0.8deg either way), derived from its id so it stays put across renders. The neon wordmark sits at -3deg and the empty slot at -2deg. A note being edited straightens to 0deg. Paper flowers are rotated individually (-12deg to +20deg). Borders are 1.5px ink lines at partial opacity on paper and white surfaces; the empty slot is a 2px dashed paper line.

## Components

### Corridor sign pills
The page's only navigation, drawn as the painted sign.
- **Shape:** full pill (999px), 44px min height, 34px arrow disc inset 5px from the end it points from.
- **Inert pill:** indigo ground, white Label type, periwinkle disc with a white arrow (up, left, or right as painted). These are a `span`, not links: the other rooms are the map, not destinations. Screen-reader text gives the direction ("straight ahead", "to the left"). The M-Lab carries "Money Lab" only in its title and hidden text.
- **Current pill:** a link to the wall, `aria-current="page"`, Spark disc with an indigo arrow, plus Pressed elevation. Hover (fine pointer only): ground shifts to periwinkle over 160ms. Active: 1px down.
- **Right-arrow pill:** padding mirrors (18px left, 5px right) and the disc moves to the end; the pill aligns to the stack's right edge.

### Wall header
The top of the real wall, made only of supplied images. It holds:
- the neon wordmark as the page's h1, clamp(78px, 9.5vw, 136px) tall and rotated -3deg from its bottom-left corner;
- the "Good Ideas Start Here" marker line, clamp(108px, 12vw, 176px);
- the neon lightbulb, clamp(62px, 7vw, 104px), decorative.

They sit in a bottom-aligned row. At 1280px and wider the row stands on the whiteboard, inside the bottle's shoulder.

### Bottle board
One object made of two working panels and one light.
- **Felt bulb:** Felt Board ground with Corridor Paper text. Padding is clamp(1.25rem, 2.6vw, 2.25rem), or 30px 32px 30px 36px when the bottle is drawn; it has no shadow of its own.
  - **Head:** the note count (Title), the sample line in Felt Soft ("All marked Sample. Edit or delete them like any other."), and an underlined "Write a note ↓" jump link in paper (Small, 600, 2px underline). Count and line stack left; the link wraps to the right.
  - **Foot:** the board status line and, after a delete, the on-board ghost Undo button.
  - **Focus:** focus outlines inside the felt switch to paper.
- **LED strip:** at 1280px and wider, a single SVG path behind the panels (felt fill plus amber stroke). In that state the felt's own background and ring are removed, so the path is the shape. Below 1280px each panel carries the CSS LED ring.
- **Paper flowers:** four supplied images (two gold, two white, 34–50px) pinned on the frame's edges: two at the felt's bottom-left, one on its top edge, one at its bottom-right. They are rotated, decorative (`alt=""`), never interactive, and sit above the LED.
- **Focus on marble:** elements in the room add a 5px white ring at 55% around the engine's indigo outline so focus reads on the veined marble.

### Whiteboard
A working drawing surface, not a picture of one.
- **Surface:** the Whiteboard sheen ground. Inside it a canvas inset 14px (10px on phones) with an 18px radius, a crosshair cursor, and a cell cursor while erasing.
  - **Hint:** a centered Small line in #565A6C until the first stroke: "Draw here with a mouse, pen, or finger.", or "Pick a marker, then draw." on touch screens.
  - **Accessible name:** the canvas is `role="img"` and its label counts the lines.
- **Strokes:** round-capped, smoothed quadratic curves at 94% opacity. Width is about 0.42% of the board's width, never under 1.6px. Strokes are stored in normalized coordinates, so a drawing rescales to stay fully visible when the board changes shape. They are saved on the device after each change.
- **Marker tray:** a labelled group of pills with a 6px gap. Each tool is a white 44px pill with a 1.5px border at 28% ink and Small 500 type. The order is:
  - **Black** and **Blue** (indigo) markers, each with an 18px ink dot ringed in white;
  - **Eraser**;
  - a 1px divider;
  - **Undo** and **Clear**, each with an icon;
  - a polite live status in Meta (#3E4152), right-aligned on wide screens and on its own line on phones.
- **States:**
  - **Pressed** (`aria-pressed="true"`, one tool at a time): 2px indigo border and 650 weight.
  - **Unavailable** (`aria-disabled="true"`: Undo with no history, Clear on an empty board): 50% opacity and default cursor. The click is ignored, but the tool stays focusable.
  - **Hover** (fine pointer): indigo border.
  - **Active:** 1px down.
- **Touch rule:** on coarse pointers no tool starts pressed and the canvas lets the page scroll (`touch-action: pan-y`). Nothing draws until a marker or the eraser is picked, which arms the surface. Tapping anywhere outside the whiteboard disarms it again.
- **Undo** reverses the last draw, erase or clear. Clear's status says Undo brings the drawing back until you leave.

### Paper note
- **Shape:** square (1:1), 4px corners, tilted per note; Plain Note Paper or one of the four note papers; Felt Board ink in Note type.
- **Meta row:** 44px tall and allowed to wrap. It holds a timestamp (time for today; day and month for earlier) or an outlined **Sample tag** (pill, 1px currentColor border, Meta 600). Two round 44px tools, edit and delete, are pushed to the right in Note Meta; on hover they darken to ink on a 9% ink wash.
- **Edit mode:** the note becomes a form in place, straightens to 0deg, drops the square ratio, and spans two grid columns. A small 600 "Edit note" label, a 6px-radius textarea on a 55% white wash with a 1.5px ink edge (indigo when focused), the swatch radiogroup at small size on a 70% white wash, then Save (primary) and Cancel (ghost). Escape cancels; Ctrl/⌘+Enter saves. An empty save shows an inline ink message, never red.

### Empty wall
A different composition, not an empty grid: a dashed, tilted, note-sized slot with a plus, beside the Headline "Nothing on the wall yet.", one line of Felt Soft body, and an underlined paper link to the composer. Single column on phones.

### Composer paper
- **Style:** a sheet of plain note paper (4px) with Hung elevation and a 1.5px inner ink edge at 60%; the textarea inside is borderless and transparent in Note Input type.
- **Color:** the sheet takes the selected note paper live, with a 180ms background fade.
- **Focus:** the inner edge becomes 2px indigo; the textarea's own outline is removed because the sheet carries it.
- **Error:** the inner edge becomes 2px Felt Board ink, and a 600-weight ink line with an alert icon appears below: "Write something first. One word is enough."

### Color swatch radios
A real radiogroup in a fieldset with a visible legend ("Paper color (optional)"). Five options, each a white 44px pill with a 26px chip and the color's name: No color (plain paper with a fine diagonal hatch), Blue, Pink, Green, Yellow. Unselected: 1.5px border at 22% ink. Selected: 2px indigo border, 650 weight, and a check mark appears inside the chip. Hover (fine pointer): border goes indigo. Keyboard focus: 2px indigo outline, 3px offset. The name is always visible; color is never the only signal.

### Buttons
- **Shape:** full pill (999px), 44px min height, 0 18px padding, Button type, 1.5px border slot.
- **Primary:** indigo ground, white text. Hover: periwinkle over 160ms. Active: 1px down. Busy (`aria-disabled`): periwinkle, default cursor.
- **Stick it:** the composer's primary, larger (52px tall, 28px side padding) with Pressed elevation.
- **Ghost:** transparent with a 1.5px border at 45% ink and ink text; hover makes the border full ink. On the felt board it inverts to paper text with a 50% paper border.

### Status lines
Polite live regions in Small type (Meta on the whiteboard), never toasts.
- **Composer:** Marble Ink Soft by default (the keyboard hint on fine pointers). Felt Board ink at 600 when saved ("Stuck. It is on the wall.") or when it failed.
- **Board:** Felt Soft text in the felt's foot: "Note saved.", "Note removed." (with Undo for 10 seconds), and failure messages.
- **Whiteboard:** "Saved on this device.", "Undone.", "Whiteboard cleared.", or the failure to save.

Each line states what actually happened.

### The flight (signature motion)
The only engineered motion on the page. On a successful save, the new note is first rendered into its slot invisibly. A fixed-position clone with In-flight elevation then makes the trip:
- it starts at the composer paper, fading in while rising 6px at 1.02 scale;
- it travels to the slot, rotating to the note's own tilt and peaking at 1.035 scale 4px above it;
- it settles at 1.0.

The trip takes 680ms on cubic-bezier(0.23, 1, 0.32, 1), and the real note is revealed when the clone is removed. If the slot is off-screen it is scrolled into view first. Under `prefers-reduced-motion` there is no travel: the note simply fades in over 220ms.

Supporting motion, not engineered: notes stagger in once (45ms apart, 14px rise, 620ms ease-out; opacity only under reduced motion), and hover/border/background transitions run at 160ms on the same ease-out, on fine pointers only. The bottle outline and LED are static.

## Do's and Don'ts

### Do:
- **Do** keep the corridor sign as the only navigation, with the six rooms in the painted order and arrow directions, and Creative Episode as the current pill.
- **Do** keep Spark yellow (#EFE52B) to the one current-pill disc per view; the neon bulb and wordmark carry the wall's other yellow as images.
- **Do** put color on paper only: notes, the composer sheet, and swatch chips.
- **Do** keep the bottle as one shape at wide sizes (whiteboard flowing into the felt bulb, one LED outline), and let it come apart into two LED-ringed panels when stacked.
- **Do** set every interface word in Rubik and take hierarchy from weight (600) before size.
- **Do** tilt paper (±0.8–2deg, deterministic per item) and keep chrome straight; straighten paper while it is being edited.
- **Do** give every control a 44px target, a visible focus ring (indigo with a white halo on marble, paper on the felt), and a visible name.
- **Do** expose tool state with `aria-pressed` and `aria-disabled`, and on touch screens draw nothing until a marker is picked.
- **Do** show errors in Felt Board ink at weight 600 with a heavier ink edge and an alert icon.
- **Do** use soft two-part shadows tinted to the felt hue, and only where an object rests on something.
- **Do** let a saved note fly to its slot, and only that.

### Don't:
- **Don't** use red (#E2231A or any red) anywhere, including errors.
- **Don't** add eyebrow labels, kickers, section numbers, or emoji icons.
- **Don't** add a theme toggle or a dark mode; the page is light by design and the felt is its only dark surface.
- **Don't** introduce a second palette, a second font family, or pastel or amber color on chrome.
- **Don't** add a second menu, sidebar, or footer that renames the rooms, or make the inert pills link to placeholder pages.
- **Don't** use glassmorphism, backdrop blur, gradient text, or glow on anything but the LED strip.
- **Don't** set the wordmark, the marker line or the bulb in type; use the supplied images.
- **Don't** add a second engineered motion (parallax, scroll-scrub, magnetic hover, animated LED) to the page.
