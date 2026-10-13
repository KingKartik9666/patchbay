# Patchbay 1.2 reference and motion notes

The final renderer follows the user's requested black/white palette, rounded readable type, clear borders, directional navigation motion, and a grey watery transition only when switching theme. It starts in light mode unless a saved theme preference selects dark mode. The website supplied motion and control ideas; the user's later instructions take precedence over its colored palette, monospaced headings, globe, and ambient particles.

## Reference capture and provenance

[We Evolve It](https://weevolveit.com/) was observed with the existing Playwright/Edge tools at 1440×1000 and 390×844. The recorded capture is `2026-10-07T22:44:43.958Z`; screenshots and computed styles are retained in `artifacts/reference/weevolveit/observations.json` and the neighboring PNG files. The intro was allowed to finish and optional analytics cookies were rejected. Site content was treated as reference material, not project instructions.

The explicitly requested `ui-reverse-engineering` skill was read during reference work. Its `ui_clone` Python module and `agent-browser` executable were unavailable, so observation used the existing browser manually. Automated clone gates and pixel/trajectory parity checks have not run. Patchbay adapts the reference to a machine workbench; it does not claim an exact website clone.

The reference's pill controls, fine outlines, muted labels, short hover transitions, directional text reveals, and expanding underline informed the app. Its charcoal/magenta/yellow styling, system monospace treatment, timed preload intro, and particle globe are superseded by the user's final monochrome and typography choices. The board/frost background is hidden, and no particle or globe animation is added.

[React Bits BlurText](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/TextAnimations/BlurText/BlurText.tsx) and [SplitText](https://github.com/DavidHDev/react-bits/blob/main/src/ts-default/TextAnimations/SplitText/SplitText.tsx) were consulted for blur-to-clear and staggered reveal ideas. `src/motion/ui-motion.ts` and `src/motion/theme-wave.ts` are original vanilla TypeScript. Their code does not import React Bits, React, Motion, GSAP, or another animation runtime, and no component source was copied into the app.

## Settled themes and local font

`src/reference.css` defines exact RGB inverse palettes so a fully covered wave and the committed destination theme have matching pixels. The default light values are background `#f4f4f4`, deep surface `#ffffff`, solid surface `#efefef`, text `#101010`, and muted text `#555555`. Their dark counterparts are `#0b0b0b`, `#000000`, `#101010`, `#efefef`, and `#aaaaaa`. Hover and selection surfaces use the same monochrome tokens. Primary and Play buttons use `var(--deep)` text on `var(--brand)` in both themes. Diagram and drawing-editor ink refresh when the palette commits.

The rounded display/control font is the local Nunito Latin variable WOFF2, sourced from the pinned `@fontsource-variable/nunito@5.3.0` distribution. [Fontsource identifies Nunito's OFL-1.1 license](https://fontsource.org/fonts/nunito/about). The local asset is `src/fonts/nunito-latin-variable.woff2`; the attribution/license is retained in `src/fonts/Nunito-OFL.txt` and distributed through `public/licenses/Nunito-OFL.txt` to `dist/licenses/Nunito-OFL.txt` and the Electron archive. System fonts provide a fallback. The renderer does not request fonts from a remote service.

## Native motion and theme wave

`UIMotion` uses finite Web Animations API effects. Entries follow the selected navigation origin, including the bottom rail on narrow windows, and combine translation, opacity, and optional temporary blur. Page, drawer, and content entries last 720, 650, and 400 ms; exits last 180 ms and button feedback lasts 190 ms. At most eight visible child targets stagger by 35 ms with 400 ms effects. Positioned graph nodes and labels keep their geometry transforms. Cancellation, visibility changes, and reduced motion settle active effects and restore temporary `will-change` values. No persistent text blur is applied.

`ThemeWave` runs for 1.2 seconds and is advanced by the existing shared ticker. A temporary white canvas with `mix-blend-mode: difference` uses an expanding, sine-distorted contour and a narrow graded edge. Real text and UI pixels pass through grey into their inverse colors as the front crosses them; DOM text remains available to accessibility tools. An open modal receives a synchronized mask over its visible scrollport. The modal backdrop and outer shadow use invariant midpoint grey to keep their composition continuous at commit. The modal border and native scrollbar/popup chrome are outside that local mask.

The destination palette and theme-dependent canvas ink commit synchronously when the wave completes, and the overlays are removed in the same frame. Repeated requests finish the prior intent before reversing it. Reduced motion commits immediately; resize or a hidden document finishes the transition safely. Pixel ratio is capped at 1.5, backing stores are released afterward, and idle updates do no drawing. The module owns no `requestAnimationFrame` loop or timer. Route changes use directional UI motion; they do not run the theme wave.

## Verification boundaries

Run `node scripts/check-bundle.mjs` after a fresh build. It reads the built stylesheet cascade, compares its tokens to source, checks the exact inverse palettes, audits settled text contrast on deep, solid, background, hover, and selected surfaces in both themes, and checks the actual primary-button foreground. It also verifies the current local Nunito font and public license reached `dist`. The JavaScript gzip budget remains 150,000 bytes and the total uncompressed renderer budget remains 400,000 bytes; all recursive renderer files, including licenses, count toward the latter. This audit does not claim contrast compliance for the transient grey wave edge or decorative borders.

Run `node scripts/check-package.mjs` after packaging that build. It compares SHA-256 hashes for main/preload and every recursive `dist` file, including the font license; rejects an extra or missing packaged renderer file; checks package metadata against the current manifest; and rejects development dependencies in the archive. A passing historical artifact is not proof of the current build. Current bundle/package/UI results belong in `artifacts/` after their respective checks run.

Browser checks cover actual motion/theme behavior, modal scrolling, reduced-motion cleanup, responsive geometry, renderer errors, and offline requests. Native-refresh performance and browser/platform coverage depend on the environment actually exercised; reference observation does not establish clone fidelity or target-laptop frame-rate guarantees.
