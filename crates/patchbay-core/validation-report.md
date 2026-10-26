# Core and desktop validation, 2026-10-23

The crate and Cargo lock entry use version 2.0.0. The graph project format remains
`patchbay-graph` version 1. Rust now implements the frontend's `setAlphabetText`
request, including JSON string arrays, Unicode whitespace, duplicate rejection,
and removal of transitions outside the resulting alphabet. The existing test
first failed because serde did not recognize `setAlphabetText`, then passed after
the enum and edit implementation were added.

## Verification

Executed from `K:\Automata` with
`CARGO_TARGET_DIR=K:\Automata\target\session-validation` and cargo at
`C:\Users\HP OMEN 16\.cargo\bin\cargo.exe`:

| Command | Result |
| --- | --- |
| `cargo check --workspace --all-targets` | Passed |
| `cargo fmt --all -- --check` | Passed |
| `cargo clippy --workspace --all-targets -- -D warnings` | Passed |
| `cargo test --workspace --all-targets` | 52 passed: 27 core, 25 desktop; 0 failed, 0 ignored |

The 27 core tests comprise 7 graph, 11 parity and 9 pure API tests. A separate
`cargo test -p patchbay-core` run also passed, including doc tests.

The tests exercise 26 captured TypeScript machines and 180 original input runs,
their conversions, 14 invalid definitions with exact diagnostics, all 11 presets,
graph-v1 round trips, draft edits and rollback, Unicode tokens and whitespace,
Moore initial-output spacing, partial-machine simulation, and growth limits.
They include 300-state/1500-edge graph coverage, all pairs of four-bit full-adder
inputs, and overlapping `101` detection through eight input bits. These are core
tests. Desktop filesystem/session tests are described below; UI integration and
installation require separate verification.

## Desktop persistence verification

The 25 desktop tests use real temporary files and LevelDB databases. They cover
atomic overwrite, UTF-8/BOM and byte limits, native Windows file locks, complete
concurrent file/session snapshots, session preferences, unfinished graph data,
inactive outputs, pending invalid editor text, and source/input/aggregate limits.
The two concurrent-save tests additionally passed 25 repetitions each, for 50
test executions after the full workspace run.

Corrupt, invalid and future session files are backed up before default autosave
can replace them. Identical recovery copies are reused; existing copies are never
overwritten. Tests exercise all 32 occupied recovery slots and confirm that an
unreadable or oversized original blocks replacement without losing its bytes.
Session storage is limited to 8 MiB, each source/pending text to 1 MiB, and input
to 4096 UTF-16 code units.

Legacy Electron recovery reads a private LevelDB copy and checks the bytes
actually copied against its 64 MiB snapshot budget. Its original profile is
compared byte-for-byte before and after migration. Tests cover Latin-1/UTF-16,
the fallback navigation key, invalid navigation, and damaged graph records while
retaining valid navigation with a warning.

Session validation parses machine source and checks graph structure without
generating simulation traces or export text. Recovery likewise parses a graph
directly. A new legacy graph regression first failed with a generated-text limit,
then passed after recovery stopped generating derived text: a valid graph below
the 1 MiB project limit survives even when its generated machine text exceeds
that limit. Separate tests cover trace growth and the same graph limit during
ordinary save/reload.

Atomic save closes its exclusively created temporary file before replacement.
On Windows, transient access/sharing/lock errors retry the same complete file
with 127 ms total requested delay; a persistent exclusive lock leaves the prior
file intact and cleans the temporary file. These checks establish tested file
and session behavior on this host, not power-loss durability, installation, or
end-to-end UI behavior.

## Latest operation timings

The fresh release run on 2026-10-23 used the unchanged benchmark example and
fixture described below: 256 states, 512 transitions, 4096 UTF-16 input units,
50 warmups and 500 samples per operation. Rust 1.99.0 and the Windows/CPU details
below were rechecked. Raw results are in `benchmark-verification.json`.

| Operation | Rust p50 / p95, ms | Captured TypeScript p50 / p95, ms |
| --- | --- | --- |
| Parse | 0.8263 / 1.0354 | 0.4433 / 0.6287 |
| Simulate | 2.6455 / 4.0920 | 0.5752 / 0.7372 |
| Convert | 1.2988 / 1.7706 | 0.4709 / 0.5675 |

This is one run on a shared host with concurrent project work. It establishes no
speedup and is slower than both the earlier Rust run and captured TypeScript
timings. Only pure operations, their byte-budget checks and destruction of
returned Rust values are timed. IPC, scheduling, rendering, WebView2, file I/O
and application latency are excluded. The TypeScript baseline was not rerun.

```powershell
$env:CARGO_TARGET_DIR = 'K:\Automata\target\session-validation'
& 'C:\Users\HP OMEN 16\.cargo\bin\cargo.exe' run -p patchbay-core --release --example domain_benchmark -- tests/fixtures/benchmark-input.json crates/patchbay-core/benchmark-verification.json
```

## Earlier optimization record, 2026-10-14

- Parser state rows are allocated only on first discovery of a state.
- Conversion deduplicates and looks up destination/output pairs using borrowed
  strings, avoiding temporary owned keys and duplicate output strings.
- Simulation reserves the bounded step vectors, borrows output tokens until
  producing the trace, and computes output spacing once.
- Domain evaluation tokenizes the input once and shares those tokens with input
  validation and simulation.

Public validation and JSON byte-budget checks remain in place, and all captured
parity cases pass. The operation benchmark below does not time `execute`, so it
does not measure the evaluation tokenization change separately.

### Earlier recorded timings

The unchanged `examples/domain_benchmark.rs` used the existing
`tests/fixtures/benchmark-input.json`: 256 states, 512 transitions, and 4096 UTF-16
input units. Its SHA-256 is
`4D1D687850A57F18A6454006DB74CDB0EF0F489E276AB5E1917F5E531CD5BBB9`.
Each operation used 50 warmups followed by 500 samples. Timings are milliseconds;
the existing percentile method sorts the samples and selects indexes 250 and 475.

The measured release build used Rust 1.99.0
(`b940084d7`, `x86_64-pc-windows-msvc`) on Windows x86-64 with an Intel Core
i7-13620H (10 cores, 16 logical processors). The before run already includes the
2.0.0 version and alphabet-text request change, preceding the optimizations above.

| Operation | Rust before p50 / p95 | Rust after p50 / p95 | Captured TypeScript p50 / p95 |
| --- | --- | --- | --- |
| Parse | 0.5683 / 0.6434 | 0.4649 / 0.5861 | 0.4433 / 0.6287 |
| Simulate | 1.8986 / 2.1183 | 1.6919 / 1.9293 | 0.5752 / 0.7372 |
| Convert | 0.8796 / 1.0211 | 0.7751 / 0.9764 | 0.4709 / 0.5675 |

Raw measurements: `benchmark-before-optimization.json`, `benchmark-results.json`,
and `../../artifacts/migration/baseline-domain.json` (Node 24.19.0 TypeScript
baseline). These are single runs on a shared host whose load was not isolated;
they do not establish a repeatable speedup. Rust remains slower at p50 than the
captured TypeScript run for all three operations. The Rust measurements include
domain size checks and destruction of returned values; TypeScript uses managed
allocation and its garbage collection timing is not controlled. Neither measures
IPC, worker scheduling, rendering, WebView2, native file I/O, or application latency.

Reproduction from the workspace root:

```powershell
$env:CARGO_TARGET_DIR = 'K:\Automata\target\core-validation'
& 'C:\Users\HP OMEN 16\.cargo\bin\cargo.exe' run -p patchbay-core --release --example domain_benchmark -- tests/fixtures/benchmark-input.json crates/patchbay-core/benchmark-results.json
```
