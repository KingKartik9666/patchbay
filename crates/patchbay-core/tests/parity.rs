#![allow(clippy::unwrap_used, clippy::expect_used)]
use patchbay_core::*;
use serde_json::{Value, json};

fn oracle() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/domain-parity.json")).unwrap()
}
fn call(request: Value) -> DomainResponse {
    execute(serde_json::from_value(request).unwrap()).unwrap()
}
fn evaluation(request: Value) -> Evaluation {
    match call(request) {
        DomainResponse::Evaluation(value) => value,
        other => panic!("Expected evaluation, got {other:?}"),
    }
}
fn old_trace(trace: Trace) -> Value {
    let mut value = serde_json::to_value(trace).unwrap();
    value.as_object_mut().unwrap().remove("outputSeparator");
    value
}

#[test]
fn all_captured_parser_simulation_and_conversion_cases_match_typescript() {
    let data = oracle();
    for case in data["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let expected_machine = &case["result"]["machine"];
        for run in case["runs"].as_array().unwrap() {
            let parsed = evaluation(
                json!({"type":"parse", "source":case["source"], "input":run["input"], "mooreInitial":run["mooreInitial"]}),
            );
            assert_eq!(
                serde_json::to_value(&parsed.machine).unwrap(),
                *expected_machine,
                "{id}: machine"
            );
            assert!(parsed.errors.is_empty(), "{id}: {:?}", parsed.errors);
            assert_eq!(
                parsed.source,
                case["source"].as_str().unwrap(),
                "{id}: original source"
            );
            assert_eq!(
                serde_json::to_value(&parsed.input_symbols).unwrap(),
                run["symbols"],
                "{id}: symbols"
            );
            assert_eq!(
                serde_json::to_value(&parsed.input_issues).unwrap(),
                run["issues"],
                "{id}: input issues"
            );
            assert_eq!(
                old_trace(parsed.trace.unwrap()),
                run["trace"],
                "{id}: original trace"
            );
            let target = if expected_machine["outputs"]["kind"] == "mealy" {
                "moore"
            } else {
                "mealy"
            };
            let converted = evaluation(
                json!({"type":"convert", "machine":expected_machine, "target":target, "input":run["input"], "mooreInitial":false}),
            );
            assert_eq!(
                serde_json::to_value(&converted.machine).unwrap(),
                case["converted"],
                "{id}: converted machine"
            );
            assert_eq!(
                converted.source,
                case["convertedSource"].as_str().unwrap(),
                "{id}: canonical source"
            );
            assert_eq!(
                old_trace(converted.trace.unwrap()),
                run["convertedTrace"],
                "{id}: converted trace"
            );
            let word = evaluation(
                json!({"type":"simulate", "machine":case["wordInitial"], "input":run["input"], "mooreInitial":run["mooreInitial"]}),
            );
            assert_eq!(
                old_trace(word.trace.unwrap()),
                run["wordTrace"],
                "{id}: word initial trace"
            );
        }
    }
}

#[test]
fn captured_invalid_definitions_keep_exact_errors_and_line_order() {
    let data = oracle();
    for case in data["invalid"].as_array().unwrap() {
        let parsed = evaluation(
            json!({"type":"parse", "source":case["source"], "input":"", "mooreInitial":true}),
        );
        assert!(parsed.machine.is_none());
        assert!(parsed.trace.is_none());
        assert_eq!(
            serde_json::to_value(parsed.errors).unwrap(),
            case["result"]["errors"],
            "{}",
            case["source"]
        );
    }
}

#[test]
fn all_eleven_presets_keep_metadata_and_expected_outputs() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/presets.json")).unwrap();
    let DomainResponse::Presets(presets) = call(json!({"type":"presets"})) else {
        panic!("Wrong response")
    };
    assert_eq!(serde_json::to_value(&presets).unwrap(), fixture);
    assert_eq!(presets.len(), 11);
    for preset in presets {
        let parsed = evaluation(
            json!({"type":"parse", "source":preset.source, "input":preset.input, "mooreInitial":true}),
        );
        assert_eq!(
            parsed.trace.unwrap().output,
            preset.expected,
            "{}",
            preset.id
        );
    }
}

#[test]
fn omitted_initial_word_keeps_binary_prefixes_compact() {
    let parsed = evaluation(
        json!({"type":"parse", "source":"type mealy\nstart A\nA 0 A 1\nA 1 A 0", "input":"", "mooreInitial":true}),
    );
    let machine = parsed.machine.unwrap();
    for initial in [true, false] {
        let converted = evaluation(
            json!({"type":"convert", "machine":machine, "target":"moore", "initialOutput":"ready", "input":"01", "mooreInitial":initial}),
        );
        let trace = converted.trace.unwrap();
        assert_eq!(trace.output, if initial { "ready 1 0" } else { "10" });
        assert_eq!(trace.output_separator, if initial { " " } else { "" });
    }
}

#[test]
fn unicode_whitespace_including_feff_is_lexical_but_single_codepoint_input_is_literal() {
    let parsed = evaluation(
        json!({"type":"parse", "source":"\u{feff}type\u{85}mealy\nstart A\nA coin A ✨\nA é A β", "input":"\u{feff}coin\u{85}é\u{2028}coin", "mooreInitial":true}),
    );
    assert!(parsed.errors.is_empty());
    assert_eq!(parsed.input_symbols, ["coin", "é", "coin"]);
    assert_eq!(parsed.trace.unwrap().output, "✨β✨");
    let literal = evaluation(
        json!({"type":"parse", "source":"type mealy\nstart A\nA 🙂 A ✨", "input":"🙂 🙂", "mooreInitial":true}),
    );
    assert_eq!(
        literal.input_issues,
        [InputIssue {
            index: 1,
            sym: " ".into()
        }]
    );
    assert_eq!(literal.trace.unwrap().fault.unwrap().at, 1);
}

#[test]
fn input_limit_counts_utf16_units_and_project_limit_counts_utf8_bytes() {
    let source = "type mealy\nstart A\nA 🙂 A ✨";
    assert_eq!(
        evaluation(
            json!({"type":"parse","source":source,"input":"🙂".repeat(2048),"mooreInitial":true})
        )
        .trace
        .unwrap()
        .steps
        .len(),
        2048
    );
    let oversized: DomainRequest = serde_json::from_value(
        json!({"type":"parse","source":source,"input":"🙂".repeat(2049),"mooreInitial":true}),
    )
    .unwrap();
    assert_eq!(execute(oversized).unwrap_err().code, ErrorCode::Limit);
    let oversized_file: DomainRequest = serde_json::from_value(
        json!({"type":"openProject","source":"#".to_owned()+&"🙂".repeat(262_144)}),
    )
    .unwrap();
    assert_eq!(execute(oversized_file).unwrap_err().code, ErrorCode::Limit);
}

#[test]
fn ipc_rejects_corrupt_machine_instead_of_treating_it_as_a_valid_machine() {
    let source = oracle()["cases"][0]["result"]["machine"].clone();
    for mutation in [
        "unknown-target",
        "missing-output",
        "duplicate-state",
        "extra-symbol",
    ] {
        let mut machine = source.clone();
        match mutation {
            "unknown-target" => machine["delta"]["A"]["0"] = json!("missing"),
            "missing-output" => {
                machine["outputs"]["lambda"]["A"]
                    .as_object_mut()
                    .unwrap()
                    .remove("0");
            }
            "duplicate-state" => machine["states"].as_array_mut().unwrap().push(json!("A")),
            _ => machine["delta"]["A"]["extra"] = json!("A"),
        }
        let request = serde_json::from_value(
            json!({"type":"simulate","machine":machine,"input":"01","mooreInitial":true}),
        )
        .unwrap();
        assert_eq!(
            execute(request).unwrap_err().code,
            ErrorCode::Validation,
            "{mutation}"
        );
    }
}

#[test]
fn oversized_trace_expansion_is_a_structured_limit_error() {
    let source = format!("type mealy\nstart A\nA 0 A {}", "x".repeat(20_000));
    let request = serde_json::from_value(
        json!({"type":"parse","source":source,"input":"0".repeat(4096),"mooreInitial":true}),
    )
    .unwrap();
    assert_eq!(execute(request).unwrap_err().code, ErrorCode::Limit);
}

#[test]
fn malformed_utf16_cannot_enter_a_rust_string_through_json() {
    assert!(
        serde_json::from_str::<DomainRequest>(
            r#"{"type":"parse","source":"\ud800","input":"","mooreInitial":true}"#
        )
        .is_err()
    );
}

#[test]
fn incomplete_cross_product_reports_bounded_diagnostics() {
    let mut source = String::from("type mealy\nstart S0\nalphabet");
    for i in 0..3000 {
        source.push_str(&format!(" a{i}"));
    }
    for i in 0..3000 {
        source.push_str(&format!("\nstate S{i}"));
    }
    let result = evaluation(json!({"type":"parse","source":source,"input":"","mooreInitial":true}));
    assert!(result.machine.is_none());
    assert!(!result.errors.is_empty());
    assert!(result.errors.len() <= 257);
    assert!(serde_json::to_vec(&result.errors).unwrap().len() < 100_000);
}

#[test]
fn a_valid_utf8_project_keeps_unicode_tokens_whose_json_encoding_expands() {
    let output = "\0".repeat(250_000);
    let source = format!("type mealy\nstart A\nA 0 A {output}");
    assert!(source.len() < MAX_PROJECT_BYTES);
    let parsed =
        evaluation(json!({"type":"parse","source":source,"input":"","mooreInitial":false}));
    assert!(parsed.errors.is_empty());
    let machine = parsed.machine.unwrap();
    assert!(serde_json::to_vec(&machine).unwrap().len() > MAX_PROJECT_BYTES);
    assert_eq!(serialize(&machine).unwrap().matches('\0').count(), 250_000);
}
