---
name: Patchbay — Night & Pearl
description: One Liquid Glass-inspired workbench in two lights. Night is near-black with sage charcoal cards and a soft pistachio live signal; Pearl is a luminous off-white with PlayStation blue and black ink. Same layout, shapes, type and motion in both.
colors:
  # Night (dark, default). Sampled from .work/refs/dark-reference.png, then tuned for contrast.
  mask: '#0C0D0D'
  deep: '#1C1E1D'
  solid: '#242726'
  hover: '#2A2D2C'
  selected: '#303332'
  active: '#373B39'
  ink: '#FAFCFB'
  ink-2: '#B4BDBA'
  ink-3: '#9EA7A3'
  line: '#2B2E2D'
  strong-line: '#737B77'
  brand: '#DCF1CF'
  brand-hover: '#E8F7DE'
  brand-pressed: '#CFE6C0'
  on-brand: '#0E1A0A'
  accent-soft: '#29331F'
  accent-line: '#7F9A6C'
  select: '#FAFCFB'
  on-select: '#0C0D0D'
  fault: '#EFB0AA'
  fault-soft: '#2E1F1E'
  fault-line: '#C98B86'
  win-close: '#A3393C'
  selection: '#3E4D35'
  circle-top: '#D2D8D5'
  circle-bottom: '#B9C1BE'
  circle-ink: '#101211'
  panel: '#111312'
  panel-raised: '#1C1F1E'
  panel-line: '#313533'
  panel-ink: '#7F8884'
  panel-ring: '#8F9894'
  panel-text: '#FAFCFB'
  panel-muted: '#A3ACA8'
  panel-signal: '#DCF1CF'
  panel-signal-soft: '#2C3627'
  panel-on-signal: '#0E1A0A'
  panel-fault: '#EFB0AA'
  glass-bar: 'rgba(21, 23, 22, 0.62)'
  glass-sidebar: 'rgba(21, 23, 22, 0.72)'
  glass-sheet: 'rgba(21, 23, 22, 0.86)'
  glass-solid-bar: '#161817'
  glass-solid-panel: '#141615'
  glass-solid-sheet: '#151716'
  field-0: '#0C0D0D'
  field-1: '#121413'
  # Pearl (light).
  light-mask: '#ECEEF2'
  light-deep: '#FBFBFD'
  light-solid: '#F1F3F6'
  light-hover: '#EAEDF1'
  light-selected: '#E2E6EC'
  light-active: '#DADFE6'
  light-ink: '#0B0C10'
  light-ink-2: '#383E49'
  light-ink-3: '#575E6B'
  light-line: '#DADEE5'
  light-strong-line: '#7A8290'
  light-brand: '#0062BB'
  light-brand-hover: '#0058A8'
  light-brand-pressed: '#00439C'
  light-on-brand: '#FFFFFF'
  light-accent-soft: '#E3EEFA'
  light-accent-line: '#5F93CF'
  light-select: '#0B0C10'
  light-on-select: '#FBFBFD'
  light-fault: '#A7302B'
  light-fault-soft: '#FBEBE9'
  light-fault-line: '#BD6A64'
  light-win-close: '#C42B1C'
  light-selection: '#CFE1F7'
  light-circle-top: '#30343C'
  light-circle-bottom: '#0B0C10'
  light-circle-ink: '#FBFBFD'
  light-panel: '#F5F6F9'
  light-panel-raised: '#FFFFFF'
  light-panel-line: '#D9DDE4'
  light-panel-ink: '#1F2228'
  light-panel-ring: '#2C3038'
  light-panel-text: '#0B0C10'
  light-panel-muted: '#565D6A'
  light-panel-signal: '#0070D1'
  light-panel-signal-soft: '#DCE9F8'
  light-panel-on-signal: '#FFFFFF'
  light-panel-fault: '#A7302B'
  light-glass-bar: 'rgba(250, 250, 252, 0.66)'
  light-glass-sidebar: 'rgba(250, 250, 252, 0.76)'
  light-glass-sheet: 'rgba(250, 250, 252, 0.92)'
  light-glass-solid-bar: '#F1F3F6'
  light-glass-solid-panel: '#F3F4F7'
  light-glass-solid-sheet: '#FBFBFD'
  light-field-0: '#DFE3EA'
  light-field-1: '#F3F4F7'
  # Launch only (never in the workbench).
  launch-mealy: '#FF5C7A'
  launch-mealy-2: '#FFB547'
  launch-moore: '#5B8CFF'
  launch-moore-2: '#A07CFF'
typography:
  display-serif:
    fontFamily: 'Newsreader, Iowan Old Style, Georgia, serif'
    fontSize: '36px'
    fontWeight: 400
    lineHeight: '40px'
    letterSpacing: '-0.02em'
  title-2:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '24px'
    fontWeight: 600
    lineHeight: '30px'
    letterSpacing: '-0.019em'
  title-3:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '20px'
    fontWeight: 600
    lineHeight: '26px'
    letterSpacing: '-0.017em'
  headline:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '17px'
    fontWeight: 600
    lineHeight: '22px'
    letterSpacing: '-0.013em'
  body:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: '22px'
    letterSpacing: '-0.009em'
    fontFeature: "'liga' 1, 'calt' 1, 'ss02' 1"
  footnote:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '13px'
    fontWeight: 500
    lineHeight: '18px'
    letterSpacing: '-0.003em'
  caption:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '12px'
    fontWeight: 600
    lineHeight: '16px'
  tape-symbol:
    fontFamily: 'IBM Plex Mono, Consolas, ui-monospace, monospace'
    fontSize: '28px'
    fontWeight: 500
    lineHeight: '1'
  transition-label:
    fontFamily: 'IBM Plex Mono, Consolas, ui-monospace, monospace'
    fontSize: '20px'
    fontWeight: 500
    lineHeight: '1.2'
  state-label:
    fontFamily: 'Inter Variable, Segoe UI Variable, Segoe UI, system-ui, sans-serif'
    fontSize: '24px'
    fontWeight: 600
    lineHeight: '1.1'
rounded:
  sheet: '28px'
  sidebar: '24px'
  toast: '24px'
  tape-track: '22px'
  plate: '20px'
  card: '20px'
  tape-cell: '18px'
  well: '16px'
  nav-row: '14px'
  input: '12px'
  capsule: '999px'
spacing:
  inset: '12px'
  gutter: '20px'
  gutter-phone: '12px'
  card-gap: '16px'
  card-padding: '24px'
  plate-inset: '8px'
  titlebar: '52px'
  sidebar: '224px'
  icon-rail: '72px'
  tab-bar: '64px'
  drawer: '400px'
  drawer-wide: '440px'
  control: '36px'
  control-touch: '44px'
components:
  button-primary:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.on-brand}'
    rounded: '{rounded.capsule}'
    height: '{spacing.control}'
    padding: '0 16px'
    shadow: 'var(--pill-glow)'
  button-primary-hover:
    backgroundColor: '{colors.brand-hover}'
  button-primary-pressed:
    backgroundColor: '{colors.brand-pressed}'
  button-secondary:
    backgroundColor: '{colors.solid}'
    textColor: '{colors.ink}'
    border: '1px solid {colors.line}'
    rounded: '{rounded.capsule}'
    height: '{spacing.control}'
  button-ghost:
    textColor: '{colors.ink-2}'
    rounded: '{rounded.capsule}'
    height: '{spacing.control}'
    padding: '0 14px'
  icon-circle:
    background: 'linear-gradient(180deg, {colors.circle-top}, {colors.circle-bottom})'
    textColor: '{colors.circle-ink}'
    rounded: '{rounded.capsule}'
    size: '36px'
  play:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.on-brand}'
    rounded: '{rounded.capsule}'
    height: '48px'
    width: '132px'
    shadow: 'var(--pill-glow); playing: var(--pill-glow-live)'
  transport-circle:
    background: 'linear-gradient(180deg, {colors.circle-top}, {colors.circle-bottom})'
    textColor: '{colors.circle-ink}'
    rounded: '{rounded.capsule}'
    size: '44px'
  segmented-thumb:
    backgroundColor: '{colors.select}'
    textColor: '{colors.on-select}'
    rounded: '{rounded.capsule}'
  switch-on:
    backgroundColor: '{colors.select}'
    knob: '{colors.on-select}'
  input-tape:
    backgroundColor: '{colors.solid}'
    textColor: '{colors.ink}'
    typography: '{typography.transition-label}'
    rounded: '{rounded.capsule}'
    height: '44px'
  sheet:
    backgroundColor: '{colors.deep}'
    rounded: '{rounded.sheet}'
    padding: '{spacing.card-padding}'
  instrument-plate:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.panel-text}'
    rounded: '{rounded.plate}'
  tape-cell:
    backgroundColor: '{colors.panel-raised}'
    textColor: '{colors.panel-text}'
    typography: '{typography.tape-symbol}'
    rounded: '{rounded.tape-cell}'
    size: '56px'
  tape-cell-current:
    backgroundColor: '{colors.panel-signal}'
    textColor: '{colors.panel-on-signal}'
  state-chip:
    backgroundColor: '{colors.brand}'
    textColor: '{colors.on-brand}'
    rounded: '{rounded.capsule}'
    height: '34px'
  preset-card:
    backgroundColor: '{colors.deep}'
    textColor: '{colors.ink}'
    rounded: '{rounded.card}'
    padding: '16px 20px'
  kind-badge:
    backgroundColor: '{colors.solid}'
    textColor: '{colors.ink-2}'
    typography: '{typography.footnote}'
    rounded: '{rounded.capsule}'
    height: '26px'
  title-bar:
    backgroundColor: '{colors.glass-bar}'
    textColor: '{colors.ink}'
    height: '{spacing.titlebar}'
  sidebar:
    backgroundColor: '{colors.glass-sidebar}'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.sidebar}'
    width: '{spacing.sidebar}'
  docked-drawer:
    backgroundColor: '{colors.glass-sheet}'
    textColor: '{colors.ink}'
    rounded: '{rounded.sheet}'
    width: '{spacing.drawer}'
  tooltip:
    backgroundColor: '{colors.ink}'
    textColor: '{colors.mask}'
    typography: '{typography.footnote}'
    rounded: '10px'
---

# Patchbay — Night & Pearl

Night & Pearl is the two-theme successor to Lumen. It keeps Lumen's structure (glass chrome over a cursor-lit 3D patch field, opaque content plates, capsules, concentric radii, Apple-style springs) and replaces its monochrome palette with two complete colour worlds chosen by the user (2026-10-30):

- **Night** (dark, the default) follows the user's reference image (`.work/refs/dark-reference.png`, a Framer "Refined" template): a near-black page, sage-tinted charcoal cards, crisp white type, a pale circular icon key, and **one** soft pistachio accent with a green glow under it.
- **Pearl** (light) is a soft, slightly luminous off-white with **PlayStation blue** as the one accent and **black** for type and strong elements.

It approximates the language of macOS Tahoe and iOS 26; it is not Apple's material, does not use SF Pro, and is never presented as Apple's or Sony's. Tokens live in `src/reference.css`; surfaces in `src/style.css`, `src/diagram/diagram.css`, `src/editor/editor.css`; springs in `src/motion/springs.css`; the theme wave in `src/motion/theme-wave.ts`; the launch in `index.html` and `src/launch/`; the field in `src/rendering/field/` (palette in `palette.ts`).

## Overview

**Creative north star: one instrument, two lights.** In Night the workbench is a dark studio where the live signal glows pistachio; in Pearl it is a bright console where the signal is PlayStation blue on pearl, drawn with black ink. Switching between them is a slow wave that rolls out of the theme button. The app opens with a short burst of colour that condenses into the active theme's signal.

Principles:

1. **Same product, two palettes.** Layout, radii, type, component shapes, spacing and motion are identical in both themes. Only colour, glows and the field's tint change. Nothing may exist in one theme only.
2. **One hue per theme, and it means something.** Pistachio (Night) and PlayStation blue (Pearl) are used only for: the primary action (Play, primary buttons), the live signal (active jack, fired cable and its label pill, current tape cell, write head, current trace row, current-state chip) and its glow. Selection (segmented thumbs, switches, the nav indicator) and focus are neutral: white on Night, black on Pearl. The only other hues are the muted fault rose and the window-close red.
3. **Glass is the navigation layer, never the content.** Bars, the sidebar or tab bar, the docked drawer and the toast are glass. The sheet, dock, preset cards, Learn cards, the editor, the trace well and the text editor are opaque. Glass never contains glass.
4. **Projector first.** Tapes and the diagram use 20–28px symbols, primary text clears 14:1 in both themes, and nothing depends on a hairline or a glass tint to be understood.
5. **The 2D instrument is authoritative.** The diagram, tapes and trace are the interface; the 3D field is atmosphere. It never takes input, never carries information missing from the plate, and freezes or disappears when the user asks for less motion or transparency.
6. **Big moments settle slowly; keys are instant.** Route, sheet and machine changes arrive on springs. Keyboard actions, playback steps and typing land within a frame. The theme wave and the launch are the only deliberate, rare exceptions (see Motion).
7. **Native frame rate.** Every animation is paced by the display (`requestAnimationFrame` through the shared frame clock, or compositor-driven CSS/WAAPI). There are no frame caps; quality trades resolution, never frames.

Surface mode is **Operate** (a tool people work in); the atmosphere (field, glass, launch, wave) is Experience-grade by explicit request, and it stays behind the work.

## Colors

Strategy: **restrained, one accent per theme.** Night neutrals carry a faint sage tint (OKLCH hue ≈ 168, chroma ≤ 0.012) taken from the reference's cards; Pearl neutrals carry a faint cool tint (hue ≈ 260). Token names are unchanged from Lumen so canvases (`diagram-ink.ts`, `editor/ink.ts`, `GraphCanvas.tsx`) read the same variables; they now read them again on every theme change.

`:root` and `html[data-theme='dark']` hold Night; `html[data-theme='light']` holds Pearl. The persisted theme is written to `html[data-theme]` by the Rust initialization script before the first paint, and the native window background is the active theme's `--mask`, so no frame ever shows the other theme.

All ratios are WCAG 2.x, measured by `.work/palette/audit.mjs` and `extras.mjs` (0 failures over 216 audited pairs, re-run 2026-10-30) with the same composite maths as `scripts/check-bundle.mjs`.

### Night (dark, default)

| Role                      | Token                                       | Value                       | Contrast                                         |
| ------------------------- | ------------------------------------------- | --------------------------- | ------------------------------------------------ |
| Frame / page              | `--mask`                                    | #0C0D0D                     | ink 18.89 · ink-2 10.13 · ink-3 7.89             |
| Content plate (cards)     | `--deep`                                    | #1C1E1D                     | ink 16.27 · ink-2 8.72 · ink-3 6.79              |
| Inputs, chips, wells      | `--solid`                                   | #242726                     | ink 14.63 · ink-2 7.84 · ink-3 6.11              |
| Hover / selected / active | `--hover` `--selected` `--active`           | #2A2D2C · #303332 · #373B39 | ink ≥ 11.03 · ink-3 ≥ 4.61                       |
| Ink                       | `--silk`                                    | #FAFCFB                     | primary text                                     |
| Ink 2                     | `--muted`                                   | #B4BDBA                     | secondary text                                   |
| Ink 3                     | `--faint`                                   | #9EA7A3                     | meta only (13px+, 500); never on `--active`      |
| Decorative line           | `--line`                                    | #2B2E2D                     | never carries meaning (1.22 on deep)             |
| Control edge              | `--strong-line`                             | #737B77                     | 3.85 deep · 3.47 solid · 3.20 hover              |
| Primary / accent          | `--brand` `--accent`                        | #DCF1CF (pistachio)         | as text ≥ 9.49 on every surface                  |
| Primary hover / pressed   | `--brand-hover` / `--brand-pressed`         | #E8F7DE / #CFE6C0           | on-brand 16.05 / 13.44                           |
| On primary                | `--on-brand` `--on-accent`                  | #0E1A0A                     | 14.97 on brand                                   |
| Accent soft / line        | `--accent-soft` / `--accent-line`           | #29331F / #7F9A6C           | accent on soft 10.51 · line 5.38 on deep         |
| Selection control         | `--select` / `--on-select`                  | #FAFCFB / #0C0D0D           | 18.89                                            |
| Fault                     | `--fault` on `--fault-soft`                 | #EFB0AA on #2E1F1E          | 8.61 (9.15 on deep)                              |
| Close hover               | `--win-close` / `--on-win-close`            | #A3393C / #FFFFFF           | ≥ 6.4                                            |
| Focus                     | `--focus` / `--focus-halo`                  | #FAFCFB / #0C0D0D           | ≥ 12.39 on every surface                         |
| Text selection            | `--selection` / `--on-selection`            | #3E4D35 / #FAFCFB           | 8.79                                             |
| Round icon keys           | `--circle-fill` / `--circle-ink`            | #D2D8D5→#B9C1BE / #101211   | glyph ≥ 10.24                                    |

The reference's body grey (#7B827F, 4.2:1) is lifted to `--faint` #9EA7A3. The reference's pill (#D1E7C2–#D6ECC8) is lifted to #DCF1CF so the live signal clears 3:1 against idle cables on the plate.

### Pearl (light)

| Role                      | Token                               | Value                       | Contrast                                        |
| ------------------------- | ----------------------------------- | --------------------------- | ----------------------------------------------- |
| Frame / page              | `--mask`                            | #ECEEF2                     | ink 16.83 · ink-2 9.25 · ink-3 5.62             |
| Content plate (cards)     | `--deep`                            | #FBFBFD                     | ink 18.91 · ink-2 10.40 · ink-3 6.31            |
| Inputs, chips, wells      | `--solid`                           | #F1F3F6                     | ink ≥ 17                                        |
| Hover / selected / active | `--hover` `--selected` `--active`   | #EAEDF1 · #E2E6EC · #DADFE6 | ink-3 ≥ 5.21 on selected                        |
| Ink / 2 / 3               | `--silk` `--muted` `--faint`        | #0B0C10 · #383E49 · #575E6B | black type                                      |
| Decorative line           | `--line`                            | #DADEE5                     | 1.31 on deep, decorative                        |
| Control edge              | `--strong-line`                     | #7A8290                     | 3.75 deep · 3.48 solid · 3.30 hover             |
| Primary / accent          | `--brand` `--accent`                | #0062BB (PS blue, text step)| as text 5.76 deep · 5.22 mask · ≥ 4.53 active   |
| Primary hover / pressed   | `--brand-hover` / `--brand-pressed` | #0058A8 / #00439C           | white 7.09 / 9.20 (PlayStation-style darkening) |
| On primary                | `--on-brand`                        | #FFFFFF                     | 6.06 on brand                                   |
| Accent soft / line        | `--accent-soft` / `--accent-line`   | #E3EEFA / #5F93CF           | accent on soft 5.07 · line 3.10 on deep         |
| Selection control         | `--select` / `--on-select`          | #0B0C10 / #FBFBFD           | 18.91                                           |
| Fault                     | `--fault` on `--fault-soft`         | #A7302B on #FBEBE9          | 5.86 (6.55 on deep)                             |
| Close hover               | `--win-close`                       | #C42B1C (Windows red)       | white 5.66                                      |
| Focus                     | `--focus` / `--focus-halo`          | #0B0C10 / #FBFBFD           | ≥ 15 on every surface                           |
| Text selection            | `--selection` / `--on-selection`    | #CFE1F7 / #0B0C10           | 14.68                                           |
| Round icon keys           | `--circle-fill` / `--circle-ink`    | #30343C→#0B0C10 / #FBFBFD   | glyph ≥ 12.08 (the "black" of the brief)        |

#0070D1 (the PlayStation blue itself) is **not** a text colour on pearl surfaces (4.27 on mask, 4.43 on solid): it is the live signal on the plate, the glow and the wave foam. Text and the primary capsule use #0062BB, the text-grade step of the same hue (OKLCH 50% 0.16 254).

### Instrument plate (themed)

The diagram plate, tape tracks and editor stage follow the theme. The signal grammar is the same in both: idle ink thin, live signal thick, glowing and inverted.

| Token                  | Night                     | Pearl                     | Use / contrast                                                     |
| ---------------------- | ------------------------- | ------------------------- | ------------------------------------------------------------------ |
| `--panel`              | #111312                   | #F5F6F9                   | recessed plate, tape track                                         |
| `--panel-raised`       | #1C1F1E                   | #FFFFFF                   | idle tape cell, edge-label pill, idle jack fill                    |
| `--panel-line`         | #313533                   | #D9DDE4                   | socket ring, pill edge (decorative)                                |
| `--panel-ink`          | #7F8884                   | #1F2228                   | idle cable and arrowhead, 2.5px: 5.11 / 14.75 on panel             |
| `--panel-ring`         | #8F9894                   | #2C3038                   | idle jack ring, start arrow                                        |
| `--panel-text`         | #FAFCFB                   | #0B0C10                   | labels, written output; also the plate focus ring (18.1)           |
| `--panel-muted`        | #A3ACA8                   | #565D6A                   | read input, Mealy input symbol: ≥ 6.1                              |
| `--panel-signal`       | #DCF1CF                   | #0070D1                   | live signal, 4px: 14.83 / 4.58 on panel; vs idle ink 3.04 / 3.22   |
| `--panel-signal-soft`  | #2C3627                   | #DCE9F8                   | connect target fill                                                |
| `--panel-on-signal`    | #0E1A0A                   | #FFFFFF                   | text on the signal: 14.97 / 4.95                                   |
| `--panel-fault`        | #EFB0AA                   | #A7302B                   | fault ring and label: 10.18 / 6.27                                 |
| `--signal-glow`        | `0 0 0 3px rgba(220,241,207,.16), 0 0 28px 6px rgba(198,232,178,.30)` | `0 0 0 3px rgba(0,112,209,.16), 0 0 26px 4px rgba(0,112,209,.30)` | live elements |
| `--signal-halo`        | rgba(220,241,207,.20)     | rgba(0,112,209,.20)       | editor selection and connect rings                                 |
| `--sweep`              | rgba(220,241,207,.22)     | rgba(0,112,209,.14)       | output-complete sweep                                              |
| `--plate-inset`        | inset 0 2px 10px rgba(0,0,0,.45) | inset 0 2px 8px rgba(16,24,40,.10) | plate recess                                       |
| `--tape-inset`         | inset 0 2px 6px rgba(0,0,0,.40)  | inset 0 2px 6px rgba(16,24,40,.10) | tape recess                                        |
| `--panel-scroll`       | #7F8884                   | #7A8290                   | plate scrollbar thumb (5.11 / 3.58 on panel; high contrast follows the text colour) |
| `--panel-frost`        | rgba(17,19,18,.62)        | rgba(245,246,249,.62)     | overflow frost fill                                                |

Hard limits that keep the light plate legible: idle ink must stay at luminance ≤ 0.0207 (#1F2228) and the plate no darker than #F5F6F9, or the signal-vs-ink 3:1 rule or the signal-on-plate 4.5:1 rule breaks. Live state is also carried by width (4 vs 2.5px), glow and inverted fill, never by hue alone. Inside `.patch-panel`, `.tape-window` and `.graph-canvas-panel`, `--focus` is re-scoped to `--panel-text`, so a focus ring never looks like the signal.

### Glass fills

| Surface                                | Night              | Pearl                  | Solid twin (Night / Pearl) |
| -------------------------------------- | ------------------ | ---------------------- | -------------------------- |
| Title bar                              | rgba(21,23,22,.62) | rgba(250,250,252,.66)  | #161817 / #F1F3F6          |
| Sidebar, tab bar                       | rgba(21,23,22,.72) | rgba(250,250,252,.76)  | #141615 / #F3F4F7          |
| Docked drawer, toast                   | rgba(21,23,22,.86) | rgba(250,250,252,.92)  | #151716 / #FBFBFD          |
| Scrolled heading                       | rgba(28,30,29,.86) | rgba(251,251,253,.92)  | —                          |
| Mica frame tint (`--frame-tint`)       | rgba(12,13,13,.72) | rgba(236,238,242,.72)  | —                          |

Rims: Night `--rim-edge` rgba(250,252,251,.05) (the reference's hairline on dark pills) and a whisper of pistachio in `--rim-mid` (.10); Pearl `--rim-top` rgba(255,255,255,.92) and a blue-pearl `--rim-mid` rgba(214,228,250,.45). Blur and filter tokens are unchanged from Lumen.

Audited worst composites (glass over the field's luminance clamp, dark ≤ #464646, light ≥ #C3C3C3, and over the Mica fallback): Night faint on bar 5.62, on sidebar + hover 4.77, on the .86 sheet over white 4.84; Pearl faint on bar 4.90, on sidebar + hover 4.67, on the .92 sheet over black 5.23. Every text colour clears 4.5:1 on every glass. Toast text uses ink only.

### Glows and shadows

| Token              | Night                                                                 | Pearl                                                                |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `--pill-glow`      | `0 12px 30px -8px rgba(198,232,178,.42), inset 0 1px 0 rgba(255,255,255,.35)` | `0 12px 28px -8px rgba(0,112,209,.50), inset 0 1px 0 rgba(255,255,255,.22)` |
| `--pill-glow-live` | `0 0 0 3px rgba(220,241,207,.18), 0 12px 32px -6px rgba(198,232,178,.50)`     | `0 0 0 3px rgba(0,112,209,.18), 0 12px 30px -6px rgba(0,112,209,.55)`      |
| `--card-shadow`    | `0 24px 64px -24px rgba(0,0,0,.6), inset 0 1px 0 rgba(250,252,251,.04)`       | `0 18px 48px -16px rgba(18,28,48,.16), inset 0 1px 0 #FFFFFF`              |
| `--thumb-shadow`   | `0 1px 3px rgba(0,0,0,.45)`                                            | `0 2px 8px -2px rgba(0,98,187,.45)`                                   |
| `--circle-shadow`  | `inset 0 1px 0 rgba(255,255,255,.55), 0 6px 14px -6px rgba(0,0,0,.6)` | `inset 0 1px 0 rgba(255,255,255,.14), 0 6px 14px -6px rgba(11,12,16,.45)` |
| `--glass-drop`     | `0 1px 2px rgba(0,0,0,.3)`                                             | `0 1px 2px rgba(18,28,48,.12)`                                        |

The pill glow is the reference's soft green bloom under "See work": it fades over about 30px. No `rgba()` colour is written outside `reference.css`; every former hard-coded value in `style.css`, `editor.css` and `diagram.css` goes through these tokens.

### High contrast and forced colours

`.high-contrast` (app setting or `prefers-contrast: more`): Night surfaces #000 with #FAFCFB edges, ink-2 and ink-3 collapse into ink, the signal stays #DCF1CF (17.53 on black) with `0 0 0 2px #000, 0 0 0 5px #FAFCFB`; Pearl surfaces #FFF with #000 edges, brand and signal #004F9E (8.04 with white) with `0 0 0 2px #FFF, 0 0 0 5px #000`. Glows, rims and sheens are removed. In high contrast the plate's idle ink equals the text colour, so live state is carried by width, the ring and the inverted fill (not by colour difference); this is deliberate. `forced-colors: active` maps everything to system colours and hides the field and the launch.

## Typography

- **Display serif: Newsreader 400** (`src/fonts/newsreader-latin-400-normal.woff2`, 22,480 B, OFL, `public/licenses/Newsreader-OFL.txt`; from `@fontsource/newsreader@5.3.0`). It is the closest local match to the reference's "Bold thinking, Better design." headline (`.work/fontprobe/cmp.png`). Used only for large titles and the launch wordmark, identically in both themes. `--serif: 'Newsreader', 'Iowan Old Style', Georgia, serif`; `font-display: block`.
- **Sans: Inter Variable** for all UI (`--display` keeps Inter first; check-bundle requires it). `font-synthesis: none`, `'liga' 1, 'calt' 1, 'ss02' 1`, antialiased.
- **Mono: IBM Plex Mono 500** for tape symbols, the input field, transition labels, Moore outputs, examples, formulas, the text definition and code. It keeps 0/O and 1/l/I apart on a projector.
- Never a network font. Glyphs outside Latin in a machine name fall back to Georgia (serif) or Segoe UI.

| Role          | Face        | Size / line                                      | Weight    | Tracking | Used for                                         |
| ------------- | ----------- | ------------------------------------------------ | --------- | -------- | ------------------------------------------------ |
| Display title | Newsreader  | 36/40 (≥1200) · 32/36 (720–1199) · 28/32 (≤719)  | 400       | −0.02em  | `#machine-title`, every view `h1`                |
| Launch mark   | Newsreader  | `7cqw` of the launch stage (≈ 56–112px)           | 400       | −0.02em  | the launch wordmark only                         |
| Title 2       | Inter       | 24/30                                            | 600       | −0.019em | drawer titles                                    |
| Title 3       | Inter       | 20/26                                            | 600       | −0.017em | card headings                                    |
| Headline      | Inter       | 17/22                                            | 600       | −0.013em | active nav label, preset names, group headings   |
| Body          | Inter       | 15/22                                            | 400 / 500 | −0.009em | descriptions, controls, inactive nav             |
| Footnote      | Inter       | 13/18                                            | 500       | −0.003em | meta, group labels, hints                        |
| Caption       | Inter       | 12/16                                            | 600       | 0        | kbd chips, phone tab labels; nothing smaller     |

"Big type" comes from the serif's scale against small Inter subtitles (15/22 ink-2), as in the reference. No two-tone headline is required; where one is used, the quiet part is `--title-quiet` (#8A918E Night, 5.21 on deep; #646B78 Pearl, 5.19 on deep and 4.62 on mask; DESIGN's earlier #6B7280 measured 4.16 on mask and was replaced) and must be real content.

Instrument sizes are unchanged: state labels Inter 600 `clamp(16px, 0.35 × node, 24px)`; transition labels Plex Mono 20 (17 at ≤959, 15 at ≤719); tape symbols Plex Mono 28 in 56px cells (24 in 48px on short windows and phones); input field Plex Mono 20; trace Inter 15/500 tabular. Tabular figures on every counter, the progress label, the trace, Speed and the diagnostics.

Rules: no weight below 400; text on glass under 15px is 500+ in ink or ink-2; sentence case; no tracked uppercase labels and no eyebrows; headings left-aligned and balanced.

## Layout

Shell order: `.launch` (fixed, z 2147483000, only while launching), `canvas#field` (fixed, z 0), then `.react-app` (z 1) holding the title bar, `#rail`, `main > .page-host` (the scroller), `#drawer` and `#toast`.

- **Title bar:** 52px, full width. Brand mark and "Patchbay", a divider aligned with the sidebar's edge, the caption ("Route · machine"), the theme/focus capsule (`#theme-toggle`, `#focus`), window controls 46×52.
- **≥1200:** sidebar inset 12px (x 12, y 64, width 224, radius 24, padding 10), rows 44px on a 48px pitch, the offline status at the foot. Content from x 256 to W − 20, capped at 1280px and centred beyond 1600. The drawer docks at the right (400px, 440px from 1600).
- **720–1199:** a 72px floating icon rail (radius 22) with opaque inverted tooltips; content from x 104. The drawer floats as a solid sheet, `min(400px, 100vw − 104px)`, with no scrim.
- **≤719:** a 64px glass tab bar (inset 12, radius 32) with five items (Bench, Machines, Editor, Learn, Settings). The drawer rises as a bottom sheet. Gutters drop to 12px.
- **Bench:** two cards 16px apart: the sheet (header, notation row, instrument plate inset 8px, height `clamp(280px, 100dvh − 584px, 900px)`, status row) and the dock (input row, the two tapes, transport). Short windows (≥720 wide, ≤820 tall) tighten so the whole dock fits 1366×768.
- **Diagram geometry rule:** the start arrow (47px) and its "start" label sit left of the start state and must never be clipped. The layout reserves `horizontalMargin = max(r + 72, min(100, width × 0.13))`, so at every width the arrow tail (x − r − 52) is ≥ 20px and the label (x − r − 60) is ≥ 12px inside the plate.
- **Editor:** one card; tools in fill capsules by job (file, edit, history) with Run pushed right; the stage on the instrument plate; a 300px inspector (below the stage at ≤959). The stage opens **fitted and centred** on the machine's content bounds (states, the start arrow and its label, the "+" handles, loops and their labels, plus 32 units of padding, zoom ≤ 1.2). It refits when a different machine is loaded and on Fit, never after an ordinary edit. The "start" label sits under the start arrow's tail, as on the Bench, never above the node where the first self-loop is drawn. Selects in the "New arrows" row size to their content (`field-sizing: content`, min 12ch) so "Auto · next unused" never truncates.
- **Overflow:** no horizontal overflow from 360 to 2560px, launch included.

## Elevation & Depth

1. **The field** (`#field`): an opaque WebGL2 canvas tinted by the theme (Night: sage-graphite jacks #222524, cables #2B2F2D, key light #F1F6EE, live #DCF1CF, glow #CBEABA; Pearl: pearl jacks #E9ECF1, cables #9BA3B0, black plug sleeves #2C3038, live #0070D1, glow #2E8BEA, floor #F3F4F7). `html[data-bg=webgl|static|off]`; `static` paints `--field-static` (Night: radial #141615 → #0C0D0D; Pearl: a luminous pearl stack of white, faint blue and faint rose radials over #F3F4F7 → #DFE3EA); `off` hides it; `html[data-capture]` hides it.
2. **Content plates**: opaque `--deep` cards (radius 28 sheet / 20 cards) with `--card-shadow`. The instrument plate is recessed (`--plate-inset`).
3. **Glass chrome** (`[data-glass]`): fill + top sheen + inset rim + 1px edge + `--glass-shadow`, a `::before` specular rim aimed at the cursor (`--la`), an `::after` recede overlay; the title bar's rim is a 1px bottom line lit at `--lx`.

### Backdrop-filter allow-list (unchanged)

Exactly six selectors may set `backdrop-filter`, each through a token with one `blur()` of 20px or less: `.titlebar`, `#rail`, `#drawer[data-mode=docked]`, `#toast`, `.library .view-heading[data-scrolled]`, `.tape-overflow::after`. The launch, the wave and its foam add none. While `html[data-bg=webgl]` the shader draws frost under the bar, sidebar and docked drawer, so they drop their CSS blur. Every allow-listed surface resets to `none` under `.reduced-transparency`, `[data-quality=low]`, `.high-contrast`, `[data-capture]`, `prefers-reduced-transparency: reduce` and `forced-colors: active`, swapping to its solid twin with a 1px `--line` edge. Blur radius, `backdrop-filter` and `box-shadow` are never animated.

## Shapes

Generous, concentric, rounded; no sharp corners. Sheet and drawer 28; plate inside a sheet 20; sidebar 24 / rows 14; icon rail 22 / rows 12; tab bar 32 / items 26; tape track 22 / cells 18; cards and headings 20; wells 16; inputs 12. Buttons, chips, selects, the input field, segmented controls and the toast are capsules; icon buttons and transport keys are circles. Jacks are circles with an inner socket ring; edge labels are pills.

## Components

- **Primary button and Play.** `--brand` capsule, `--on-brand` label 600, `--pill-glow` beneath (the reference's green bloom in Night, a blue bloom in Pearl). Hover `--brand-hover`; pressed `--brand-pressed` plus `scale(.97)` over 100ms. Play is 132×48 with a 17/600 label and a Space chip; while `#play[data-playing]` it uses `--pill-glow-live`. The kbd chip on Play stays ≥ 4.78:1 at rest and on hover.
- **Secondary pills.** `--solid` fill, 1px `--line` hairline, ink label (the reference's "Shop products").
- **Ghost buttons** (`.quiet-button`, `.text-button`): ink-2 label, `--hover` fill on hover.
- **Round icon keys and transport circles** (Reset, Back, Step, drawer close, icon buttons): `--circle-fill` gradient with `--circle-ink` glyph and `--circle-shadow`: pale grey circles with dark glyphs in Night (the reference's heart/bookmark keys), black circles with pearl glyphs in Pearl. Hover uses `--circle-fill-hover` (Night `linear-gradient(180deg,#dde2df,#c6cdca)`, Pearl `linear-gradient(180deg,#3b4049,#17191f)`; high contrast #ffffff / #0b0c10). Title-bar icon buttons stay quiet (transparent, `--frame-hover` on hover) so the bar does not shout.
- **Chips and tags** (kind badges, filters): `--solid` capsules, ink-2 13/500 (the reference's "Branding" tags).
- **Segmented control** (`.kind-switch`, `.graph-mode-switch`): 40px capsule track; the selected segment is a sliding `--select` thumb with `--on-select` label and `--thumb-shadow`, on the glass spring.
- **Switches** (Settings): 46×28 capsules; on = `--select` track with an `--on-select` knob; off = `--solid` with a `--strong-line` edge.
- **Instrument plate.** Idle jack: `--panel-raised` fill, 2px `--panel-ring`, Inter 600 label. Active jack: `--panel-signal` fill, `--panel-on-signal` label, `--signal-glow`. Reading/arriving: a 2px `--panel-signal` halo at 55%. Fault: `--panel-fault` ring. The cable that fired: label pill inverts to the signal with a glow; the canvas draws it 4px signal against 2.5px idle ink.
- **Tapes.** Recessed `--panel` track (`--tape-inset`); 56px cells (radius 18) on `--panel-raised`. Current input cell in the signal colour with its glow; read cells `--panel-muted`. Output: written cells in `--panel-text`; the write head is a hollow ring in the signal colour; the newest output's glow decays over 350ms; `.output-tape[data-complete]` runs one 600ms `--sweep`. Overflow sits under a 4px frost.
- **Status row.** Counts in ink-2 with tabular ink figures; "Current state" in a `--brand` capsule.
- **Sidebar.** One `.nav-indicator` (radius 14, `--frame-indicator`, top rim) placed by JS; 20px line icons at 1.5 stroke.
- **Tooltips** (icon rail only): opaque, inverted (`--tooltip` / `--on-tooltip`), 13/500, after 300ms on hover, at once on keyboard focus or while warm.
- **Drawer.** Title 24/600, a 36px round close key, a scrolling `.drawer-panel`; the trace table lives in an opaque `--solid` well with the current row in a `--brand` fill, 600.
- **Toast.** A .86/.92 glass capsule at the top of the content column; enters on the snappy spring from 8px below at .96 scale, leaves in 160ms.
- **Preset cards.** Opaque `--deep`, radius 20, name 17/600, description ink-2, kind badge, example in Plex Mono 17.
- **Inputs and selects.** `--solid` fill, 1px `--strong-line` edge, focus ring 2px `--focus` at 2px offset with a `--focus-halo`. Selects are capsules with a drawn chevron and size to their content (`field-sizing: content`; Settings selects have a 116px minimum and a 70% cap, so "Match display · 144 Hz" never truncates).
- **Settings › Appearance** rows, in order: Theme (button `#theme-setting`; plays the wave from itself), Window material, Reduced motion, High contrast, **Launch animation** (`#launch-animation`, default on, "Play the colour intro when Patchbay opens."), Rendering quality (`#quality`), **Frame rate** (`#frame-rate`: "Match display · {N} Hz" default, "60 fps · power saver", "30 fps · battery saver"). Local diagnostics show detected display Hz, measured fps, frame p50/p95, long frames, background mode · render scale · fps and the reason for any dynamic-resolution step.
- **Theme toggle** (`#theme-toggle`): a 36px title-bar icon button holding one morphing sun/moon glyph (see The theme wave). It shows the current theme (moon in Night, sun in Pearl); its label names the theme it will switch to ("Switch to light theme"). It is an action button, so it carries no `aria-pressed` (a flipping label plus a pressed state would read as a contradiction); the Settings theme button follows the same intent-driven label.
- **Browser surfaces.** `::selection` uses `--selection` / `--on-selection`; thin scrollbars in `--strong-line` on `--mask` (4.47 Night / 3.33 Pearl); the caret is ink.

## Motion

Springs are Apple duration/bounce springs baked into `src/motion/springs.css` as `--spring-<name>` (`linear()`) and `--spring-<name>-ms`, generated from `src/motion/spring.ts`:

| Token     | Duration / bounce | Use                                                  |
| --------- | ----------------- | ---------------------------------------------------- |
| snappy    | .4 / .15          | tooltips, rim materialise, switches, toast enter     |
| smooth    | .5 / 0            | stagger                                              |
| fade      | .35 / 0           | opacity partner                                      |
| glass     | .55 / .12         | nav indicator, segmented thumbs                      |
| sheet     | .6 / .05          | drawer, focus-mode sidebar slide                     |
| cinematic | .7 / 0            | page content, machine plate                          |
| bounce    | .6 / .40          | the theme toggle glyph only (9.5% overshoot, settles in 971ms) |

Launch and wave curves (CSS): `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`; `--ease-move: cubic-bezier(0.77, 0, 0.175, 1)`. Never ease-in.

**Always instant (≤ 1 frame):** Space, arrows, R, B, E, F, Q and Escape; every per-step playback update; typing, focus moves, editor drags and the speed select. Jack and label colours have no transitions; only the build animates.

**Deliberate exceptions** (rare actions, never blocking input):

1. **The theme wave** plays for the theme toggle and the Settings theme button, including keyboard activation (Enter/Space on the focused button). A theme change is a rare, deliberate act; the wave is its feedback. Every other key or click during the wave ends it at once and still lands.
2. **The launch** plays once per app start and is skipped by the first key, click, wheel or touch, which still reaches its target.

**Reduced motion** (OS or app setting): CSS transitions and animations drop to 0.001ms, route and sheet changes become short cross-fades, the field freezes to a still frame, the launch becomes a still frame with a 180ms fade, the wave becomes a 160ms cross-fade, and the toggle glyph only fades (120ms).

Only `transform`, `opacity` and the wave's `clip-path` on the view-transition snapshot animate (plus discrete `display` for the toast exit and the SVG glyph's `r`/`cx`/`cy`). Theme colours never tween on surfaces: the wave or the cross-fade carries the change, and `--motion-theme` is 0ms.

### Frame rate

- **Native refresh, automatically.** Rust detects the refresh rate of the monitor the window is on (Win32 `MonitorFromWindow` → `GetMonitorInfoW` → `EnumDisplaySettingsW(ENUM_CURRENT_SETTINGS).dmDisplayFrequency`; for variable refresh this is the mode's maximum) and reports it in the Startup payload and in a `display-refresh` event when the window moves to another monitor, its scale factor changes, or it regains focus after a mode change. The shared `FrameClock` (`src/rendering/frame-clock.ts`) is the only `requestAnimationFrame` loop; it is vsync-paced, cross-checks measured rAF intervals against the detected Hz, and exposes both.
- **No frame caps.** The field, the canvases (diagram, editor ink, the wave foam) and playback signal travel draw on every clock frame while anything moves. A motionless scene unsubscribes and draws 0 frames. Compositor animations (launch, wave edge, springs, WAAPI) are paced by Chromium at the display rate. No `setTimeout`/`setInterval` drives animation.
- **Quality trades pixels, not frames.** High / Medium / Low set render scale, refraction, glow passes and DPR; Low shows the static field. If the GPU cannot hold the refresh rate, the field lowers its render scale step by step (dynamic resolution, floor 0.5× of the tier's base) before it ever drops frames, and the step and its reason appear in Local diagnostics. Only at the floor does it fall back a tier.
- **Settings › Frame rate**: "Match display · {N} Hz" (default, `frameRate: 'match'`), plus 60 and 30 fps power savers that decimate clock frames on vsync boundaries. Fixed rates pace the clock-driven renderers only; compositor animations always run at the display rate.
- **Visibility:** rendering pauses only when `document.hidden` (minimised or hidden). A visible window runs at the native rate whether focused or not.

## The launch

A short burst of colour plays when Patchbay starts and condenses into the active theme's live signal; the workbench appears underneath. Vivid colour lives **only** on the launch stage. The shapes borrow the workbench's vocabulary (a state ring, a transition arc with an arrowhead, a travelling signal, a jack) as decoration; the launch teaches nothing and makes no claims.

**Delivery.** Rust reads a lenient hint from `session.json` before the window exists (`theme`, `launchAnimation`, `launchSeen`, `reducedMotion`, `highContrast`, `quality`) and injects an initialization script that sets `html[data-theme]` and `html[data-launch]` before the document parses. The stage (`<div class="launch" aria-hidden="true">`) and its CSS (`<style id="launch-css">`) are inline in `index.html`, before `#app`; only `transform` and `opacity` animate, so it runs on the compositor while the bundle parses. The window background is the theme's `--mask`, and frame 0 of the launch is the same colour, so nothing flashes.

**Variants** (chosen in Rust, in order): debug-only `PATCHBAY_LAUNCH=off|full|short|still` override; debug builds with `PATCHBAY_TEST_DATA_DIR` and no override → off; `launchAnimation: false` → off; reduced motion, high contrast or quality Low → still; first start of this version (`launchSeen ≠ version`) → full; otherwise → short. In CSS, `prefers-reduced-motion: reduce` turns full/short into still; `forced-colors: active` and `html[data-capture]` hide the stage.

**Stage** (16:9 box, `width: min(100vw, 177.78vh)`, centred; coordinates in a 1600×900 design space; fonts in `cqw`):

- Ground: the theme's `--mask` (#0C0D0D Night / #ECEEF2 Pearl), opaque.
- Colour fields (static radial gradients, faded to alpha ≤ .15 below y 600 by a ground-coloured veil, `.launch-veil`, inside `.launch-fields` and extending past the stage, so the wordmark band stays legible; a mask-image was rejected because it clipped the Moore field flat at the stage top): Mealy-side `rgba(255,92,122,.85) → rgba(255,181,71,.35) → transparent` (1100 units, centred 520,560); Moore-side `rgba(91,140,255,.85) → rgba(160,124,255,.35) → transparent` (1000 units, centred 1020,300). Pearl uses the same hues at 0.8× alpha. No blend modes, no blur.
- Ring: an SVG circle at C (800,380), r 132, 14-unit stroke, gradient #5B8CFF → #A07CFF, over a core disc of the theme's `--deep`.
- Arc: a 424-unit-radius arc about O (800,780) ending at the ring's left edge with a tangent arrowhead, 14-unit stroke, gradient #FF5C7A → #FFB547.
- Comet: an 18-unit white-core disc on a wrapper rotated about O, so it rides the arc on the compositor.
- Jack (the condensed signal): r 40 at C in `--panel-signal` (#DCF1CF / #0070D1) with the signal glow at launch scale.
- Wordmark "Patchbay": Newsreader 400, 7cqw, −0.02em, `--silk`, centred at y 640. Subline "Mealy & Moore machines": Inter 500, 1.9cqw, `--muted`, y 716. Measured worst case over the masked fields: wordmark 14.36 (Night) / 14.50 (Pearl), subline 7.70 / 7.97.

**Full** (first start of a version, 2,240ms; t = first paint):

| t (ms)      | Beat                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| 0–80        | ground only                                                                                    |
| 80–620      | fields bloom (scale .6→1, opacity 0→1, out); ring arrives (scale .86→1, out)                    |
| 200–900     | arc swings in (rotate −28°→0 about O, opacity, out)                                            |
| 280–900     | comet rides the arc (rotate 0→40.7°, move); fades in 280–360, out 900–960                      |
| 620–1180    | wordmark rises (translateY 14u→0, scale 1.04→1, opacity, out); subline 760–1240                |
| 900–1120    | impact: the jack appears (scale .4→1, out); ring pulses 1→1.05→1 (900–1020)                    |
| 900–1500    | fields swirl (rotate 0→24°, scale 1→1.08, move)                                                |
| 1180–1640   | condense: fields scale to .12 toward C and fade; ring and arc scale to .3 and fade (move)      |
| 1500–1800   | wordmark and subline fade (scale 1→.98)                                                        |
| 1640        | hand-off: `patchbay:launch-handoff`; the Bench build replays if the Bench is showing at step 0 |
| 1640–2240   | ground fades 1→0 (600ms, out); the jack flies (WAAPI, move) to the Bench's active jack and lands at its size, or scales to .6 and fades in place |
| 2240        | done: the stage is removed, `launchSeen` is recorded                                           |

**Short** (later starts, 900ms): 0–60 ground; 60–420 ring and arc fade in (scale .92→1), fields to .7; 360–520 jack appears; 420–640 condense; 600 hand-off; 600–900 ground fades (300ms) and the jack fades in place.

**Still** (reduced motion, high contrast, quality Low; 480ms): the composed impact frame from frame 0 (fields .85, ring, arc, jack, wordmark), held to 300ms, then the whole stage fades over 180ms. High contrast drops the fields and strokes the ring and arc in `--silk`.

**Input.** The stage is `pointer-events: none` and never consumes an event. The first `keydown`, `pointerdown`, `wheel` or `touchstart` (capture, passive, installed by the initialization script) sets `data-launch="skip"`, which hides the stage in the same frame; the event still reaches its target (Space plays, a click on Step steps). Pointer movement alone does not skip; becoming hidden skips. A skipped launch counts as seen. The app mounts underneath at its normal time and is operable as soon as it would be without the launch. While the stage shows, the root scrollbar is hidden (`scrollbar-width: none`), because the app's first layout overflows by about 12px for ~35ms and its scrollbar would otherwise paint over the stage.

## The theme wave

Clicking the theme toggle (or the Settings theme button) sends a slow wave out of the button: an organic, softly undulating front with a light foam rim that rolls across the window and reveals the new theme as it spreads.

- **Technique:** a View Transition. `::view-transition-new(root)` is clipped by a WAAPI `clip-path: path()` animation of 49 keyframes that share one command list (144 points), so the compositor interpolates the edge at the display rate even while the main thread is busy. The foam is a small 2D canvas in its own view-transition group, drawn on the shared frame clock, attached only during a wave (no element remains at rest).
- **Timing:** 1,600ms, linear timing over a two-surge progress curve `u = t − (0.42 / 4π)·sin(4πt)` (speed 0.58×–1.42× of average, never backwards). Radius `R = (farthest corner + 1.38·amp + 34px)·u`.
- **Geometry:** amplitude 2% of the window diagonal, growing from a round blob until R reaches 30% of the diagonal; 11 primary ripples (peak-sharpened, drifting +1.6 rad) plus 19 secondary ripples at .38 height drifting −2.3 rad.
- **Foam:** three spray strokes (34/20/10px at 3.5/6/11%), a 7px dashed bubble line at 50% drifting along the edge, and a 3px lip at 92%; fades in over the first 3% and out over the last 10%. Into Pearl: white #FFFFFF lip with #4DA3FF spray just ahead of the edge. Into Night: #DCF1CF lip with rgba(250,252,251,.35) spray just inside the edge. Canvas ≤ 1.3 MP; a late frame halves its resolution, a second at the floor removes the foam for the rest of the wave. No foam at quality Low or in high contrast.
- **Every frame is correct:** the theme is committed synchronously inside the transition's update callback (`flushSync`), the field snaps to the new palette and draws one frame, and canvases redraw before the snapshot. During the wave `--motion-theme` is 0ms and a Mica frame paints solid `--mask`; the native window theme is pinned only after the transition finishes, then the frame returns to Mica.
- **Interruption:** another press on the toggle reverses the wave back to the button at 1.6× speed and lands on the original theme; a third rolls it forward again; two presses before the first frame collapse to the final theme. Any other click, key or wheel ends the wave at once on the new theme and is delivered (Chromium routes pointer events to `<html>` during a view transition, so the click is re-dispatched to the element under the pointer). A hidden window or `html[data-capture]` ends it.
- **Instant paths:** `html[data-capture]`, `html[data-theme-instant]` (used by tests), forced colours, or no View Transition support switch synchronously with no transition. Reduced motion: a 160ms cross-fade.

**Toggle glyph.** One SVG morphs between sun and moon: a centre circle (r 4.6 ↔ 8.2), a masked "bite" circle (cx/cy 31,−7 ↔ 17.4,17.2), and eight rays (scale 1 ↔ .35, fading over 140ms); the whole glyph rotates 0° ↔ −90°. All on the `bounce` spring (visible overshoot: rotation passes +8.5° before settling). It is keyed on `html[data-theme-intent]`, which flips on the press, so the icon answers immediately while the wave travels.

## The field

- Atmosphere only: never receives input (`pointer-events: none`, `tabindex=-1`, `aria-hidden`), never inside `.page-host`, never carries information missing from the plate.
- Calm and softly lit; the cursor is the key light and also lights the glass rims (`--la`, `--lx`, written at most once per frame on at most three elements, only when the angle moves more than 2° or the highlight more than 4px).
- `quality: low` or no WebGL2 → static gradient; reduced transparency, high contrast or forced colours → off; `document.hidden` pauses it; screenshots hide it. Auto quality sampling waits until 2s after start and 500ms after the launch has ended, and ignores frames during a theme wave.
- No crash zooms, whip pans, continuous orbits or handheld shake; parallax ≤ 2.5°, camera arcs ≤ 9°, dollies ≤ 5%.

## Do's and Don'ts

**Do**

- Keep both themes structurally identical; change only tokens.
- Put every word a student reads on an opaque plate or on audited glass.
- Express "live" with the theme's signal colour, a soft glow and an inverted fill, always backed by width.
- Keep selection and focus neutral (white on Night, black on Pearl).
- Measure contrast against the real composite (glass over the worst field pixel), in both themes.
- Gate hover effects behind `(hover: hover) and (pointer: fine)`; give every control a visible focus ring.
- Pace every animation by the display; trade resolution, never frames.

**Don't**

- Don't add a second accent hue in either theme. The launch's coral, amber, azure and violet never appear outside `.launch`.
- Don't use #0070D1 as text on pearl surfaces; use #0062BB.
- Don't put glass inside glass, or glass over the diagram, tapes, trace or editor stage.
- Don't add a `backdrop-filter` outside the six allow-listed selectors, animate a blur, or exceed 20px.
- Don't animate keyboard actions or per-step playback, and don't make anything wait for a transition (the wave and the launch never block input).
- Don't cap frame rates, use timers for animation, or run a private `requestAnimationFrame` loop outside the frame clock.
- Don't write raw `rgba()` colours outside `reference.css`.
- Don't use type below 12px, weights below 400, uppercase tracked labels or eyebrows; don't use the serif below 28px.
- Don't present the result as Apple's Liquid Glass or Sony's PlayStation, ship SF Pro, or use their logos.
