# patchbay-core

Independent Rust domain library. No browser, React, Electron or Tauri dependencies.
The serde DTOs mirror `src/domain/contracts.ts`; `execute(DomainRequest)` returns
`Result<DomainResponse, DomainError>`. Errors serialize as `{code,message,details}`,
with `ErrorCode` serialized to the contract's lowercase strings.

Public pure APIs include `parse`, `simulate`, `validate_machine`, `serialize`,
`convert`, `mealy_to_moore`, `moore_to_mealy`, `tokenize_input`,
`check_input_symbols`, `join_symbols`, `output_separator` and `presets`.
Graph APIs include `create_draft`, `validate_structure`, `validate_draft`,
`draft_from_machine`, `draft_to_machine`, `draft_to_source`, `inspect_graph`,
`edit_graph`, `serialize_draft` and `parse_draft`.

`GraphEdit::SetAlphabetText` accepts either a JSON array of strings or
whitespace-separated tokens. JSON is selected by a leading `[` after lexical
whitespace trimming. It shares the atomic alphabet validation and incident-edge
removal behavior of `SetAlphabet`; parsing remains in Rust.

`parse` preserves line numbers and declaration order. `execute` preserves the
original source on parse and supplies canonical source for simulation/conversion.
`simulate` faults safely on partial machines; IPC requests require complete,
validated machine DTOs. `edit_graph` accepts an immutable original and commits
only a fully validated copy. Empty graphs and unfinished outputs remain valid
editing data. Version 1 graph files preserve inactive outputs, IDs, order and
coordinates. Explicit layout positions are accepted; absent positions use a grid.

Input is bounded to 4096 UTF-16 units, project files and generated DSL to 1 MiB
UTF-8. Machine/draft DTOs and request/response JSON have a 16 MiB budget, allowing
JSON escaping to expand valid UTF-8 projects. Trace, conversion and fill operations check allocation growth
before cloning generated items. Diagnostics are bounded to 256 entries plus an
omission notice and 500 Unicode characters per message. There is no fixed state
or transition count cap. The graph ID counter uses JavaScript's safe integer range.

Run `cargo test -p patchbay-core`, `cargo fmt -p patchbay-core --check` and
`cargo clippy -p patchbay-core --all-targets -- -D warnings` from the workspace.

For the same 256-state, 512-transition, 4096-code-unit workload, 50 warmups and
500 samples used by the TypeScript baseline:

```text
cargo run -p patchbay-core --release --example domain_benchmark -- tests/fixtures/benchmark-input.json target/benchmark-results.json
```

These are pure Rust operation timings including byte-budget checks and destruction
of returned values. They do not measure IPC, worker scheduling or UI latency.
