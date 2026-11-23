# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Patchbay ships as a Windows desktop app (Tauri 2 + WebView2), but its interface is a React + TypeScript web UI, so the design language is web, not a native OS toolkit.

## Users

Two audiences, weighted equally:

- **Students** learning automata and the theory of computation, who use Patchbay on their own laptops to step through Mealy and Moore machines, practise, and build their own.
- **Instructors**, who project Patchbay in class to demonstrate machine runs live; students then practise with it afterwards.

## Product Purpose

Patchbay is an offline workbench for Mealy and Moore finite-state transducers. Users load a preset or draw a machine, feed it an input string, and watch it run symbol by symbol with an inspectable trace.

Success means a user can:

- follow a run step by step and predict each output symbol;
- draw their own Mealy or Moore machine and verify that it behaves as intended;
- understand how Mealy and Moore machines differ, including conversion between them;
- for instructors, demonstrate all of this live without setup or a network connection.

## Positioning

A small, visual, fully offline studio specifically for Mealy and Moore machines. The Rust core performs parsing, simulation, conversion and graph editing; the interface shows the run, rather than only the result.

## Operating Context

- Personal study on a Windows laptop, and classroom projection during lectures.
- Students' course conventions vary: for example, whether a Moore machine prints its initial output can be configured.
- Users work with input strings, `.patchbay` graph files and text definitions.

## Capabilities and Constraints

Confirmed constraints (must be kept):

- **Fully offline:** no network, accounts or servers; fonts and assets are bundled locally.
- **Windows desktop app:** Tauri/WebView2, installed per user; session data stays on the device (`%APPDATA%\io.patchbay.studio`). The installed app lives in `%LOCALAPPDATA%\Programs\Patchbay`.
- **Files and presets stay compatible:** the 11 presets, the text definition language and `.patchbay` graph files.

Existing behaviour not confirmed as binding for future work: keyboard shortcuts, reduced-motion and high-contrast settings, and screen-reader narration of playback.

Views: Bench, Machines, Editor, Learn, plus the Trace, Text definition and Settings panels. Limits: input up to 4,096 UTF-16 units, project files up to 1 MiB.

## Brand Commitments

- Name: Patchbay. Licence: MIT.
- The user's stated direction for the interface (2026-10-29): Apple-like design with Liquid Glass, glassy menu bars, slow and smooth animations and transitions, an interactive 3D background that responds to where the mouse hovers, a dark appearance with clearly visible text, and a React + TypeScript frontend.

## Evidence on Hand

- 11 presets in the Rust core, mirrored in `tests/fixtures/presets.json`.
- No testimonials, usage statistics or institutional endorsements exist. Do not invent them.

## Product Principles

1. Show the run, not just the result: every step of a machine must be visible and inspectable.
2. Offline and self-contained: nothing depends on a network or an account.
3. One tool for both the lecture hall and the laptop: legible when projected, comfortable up close.
4. Compatibility is a promise: presets, definitions and saved graphs keep working across redesigns.
