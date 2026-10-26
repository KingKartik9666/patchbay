#![allow(clippy::unwrap_used, clippy::expect_used)]
use patchbay_core::*;
use serde_json::{Value, json};

fn call(request: Value) -> Result<DomainResponse, DomainError> {
    execute(serde_json::from_value(request).unwrap())
}
fn graph(request: Value) -> GraphResult {
    match call(request).unwrap() {
        DomainResponse::Graph(value) => value,
        other => panic!("Expected graph, got {other:?}"),
    }
}
fn fixtures() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/graph-compatibility.json"
    ))
    .unwrap()
}
fn empty() -> Value {
    json!({"kind":"mealy","states":[],"transitions":[],"alphabet":[],"start":"","nextId":0})
}

#[test]
fn v1_preserves_unfinished_and_inactive_outputs_positions_order_and_ids() {
    for fixture in fixtures().as_array().unwrap() {
        let inspected = graph(json!({"type":"inspectGraph","draft":fixture["draft"]}));
        assert_eq!(
            serde_json::to_value(&inspected.draft).unwrap(),
            fixture["draft"]
        );
        assert_eq!(inspected.source, fixture["source"].as_str().unwrap());
        assert_eq!(
            serde_json::to_value(&inspected.errors).unwrap(),
            fixture["errors"]
        );
        assert_eq!(inspected.machine.is_some(), inspected.errors.is_empty());
        let DomainResponse::Text(exported) =
            call(json!({"type":"exportGraph","draft":fixture["draft"]})).unwrap()
        else {
            panic!("Wrong response")
        };
        assert_eq!(exported, fixture["file"].as_str().unwrap());
        let loaded = graph(json!({"type":"openProject","source":exported}));
        assert_eq!(loaded.draft, inspected.draft);
        assert_eq!(loaded.source, inspected.source);
    }
}

#[test]
fn text_open_and_positions_share_graph_response() {
    let source = "type mealy\nstart B\nstate B\nstate A\nalphabet λ\nA λ B ✨\nB λ A β";
    let opened = graph(json!({"type":"openProject","source":source}));
    assert!(opened.errors.is_empty());
    assert_eq!(
        opened
            .draft
            .states
            .iter()
            .map(|state| state.name.as_str())
            .collect::<Vec<_>>(),
        ["B", "A"]
    );
    let positioned = graph(
        json!({"type":"fromMachine","machine":opened.machine.unwrap(),"positions":{"B":{"x":0,"y":35}}}),
    );
    assert_eq!(
        (positioned.draft.states[0].x, positioned.draft.states[0].y),
        (0., 35.)
    );
    assert!(positioned.draft.states[1].x > 0. && positioned.draft.states[1].y > 0.);
}

#[test]
fn atomic_edits_enforce_names_coordinates_pairs_and_safe_id_counter() {
    let first =
        graph(json!({"type":"editGraph","draft":empty(),"edit":{"type":"addState","x":0,"y":0}}));
    assert_eq!(first.draft.start, "s0");
    let mut draft = serde_json::to_value(first.draft).unwrap();
    draft=serde_json::to_value(graph(json!({"type":"editGraph","draft":draft,"edit":{"type":"addState","x":200,"y":120,"name":"q1"}})).draft).unwrap();
    let before = draft.clone();
    for edit in [
        json!({"type":"addState","x":-1,"y":0}),
        json!({"type":"updateState","id":"s0","name":"q1","output":"ready","start":false}),
        json!({"type":"updateState","id":"s0","name":"Renamed","output":"bad output","start":true}),
        json!({"type":"upsertTransition","from":"s0","to":"missing","input":"coin","output":"0"}),
    ] {
        assert_eq!(
            call(json!({"type":"editGraph","draft":draft,"edit":edit}))
                .unwrap_err()
                .code,
            ErrorCode::Validation
        );
        assert_eq!(draft, before);
    }
    let mut exhausted = before;
    exhausted["nextId"] = json!(9_007_199_254_740_991_u64);
    assert!(
        call(json!({"type":"editGraph","draft":exhausted,"edit":{"type":"addState","x":0,"y":0}}))
            .is_err()
    );
}

#[test]
fn semantic_edit_flow_retains_inactive_outputs_and_removes_incident_edges() {
    let fixture = fixtures()[1]["draft"].clone();
    let filled = graph(
        json!({"type":"editGraph","draft":fixture,"edit":{"type":"fillMissing","output":"wait"}}),
    );
    assert!(filled.errors.is_empty());
    assert_eq!(filled.draft.transitions.len(), 4);
    let moore = graph(
        json!({"type":"editGraph","draft":filled.draft,"edit":{"type":"setKind","kind":"moore"}}),
    );
    let mealy = graph(
        json!({"type":"editGraph","draft":moore.draft,"edit":{"type":"setKind","kind":"mealy"}}),
    );
    assert_eq!(mealy.draft.transitions[0].output, "unlock");
    let subset = graph(
        json!({"type":"editGraph","draft":mealy.draft,"edit":{"type":"setAlphabet","symbols":["coin"]}}),
    );
    assert_eq!(subset.draft.transitions.len(), 2);
    let removed = graph(
        json!({"type":"editGraph","draft":subset.draft,"edit":{"type":"removeState","id":"s0"}}),
    );
    assert_eq!(removed.draft.start, "s1");
    assert_eq!(removed.draft.transitions.len(), 1);
    let without_edge = graph(
        json!({"type":"editGraph","draft":removed.draft.clone(),"edit":{"type":"removeTransition","id":removed.draft.transitions[0].id}}),
    );
    assert!(without_edge.draft.transitions.is_empty());
}

#[test]
fn unknown_fields_bad_counters_and_dangling_ids_are_rejected_on_import() {
    let fixture = fixtures()[0]["draft"].clone();
    for mutation in [
        "extra",
        "dangling",
        "fraction",
        "unsafe",
        "duplicate",
        "reserved",
        "negative",
        "outside",
    ] {
        let mut draft = fixture.clone();
        match mutation {
            "extra" => draft["states"][0]["extra"] = json!(true),
            "dangling" => draft["transitions"][0]["to"] = json!("missing"),
            "fraction" => draft["nextId"] = json!(1.5),
            "unsafe" => draft["nextId"] = json!(9_007_199_254_740_992_u64),
            "duplicate" => draft["states"][1]["id"] = draft["states"][0]["id"].clone(),
            "reserved" => draft["states"][0]["name"] = json!("alphabet"),
            "negative" => draft["states"][0]["x"] = json!(-1),
            _ => draft["transitions"][0]["input"] = json!("coin"),
        }
        let source = json!({"format":"patchbay-graph","version":1,"draft":draft}).to_string();
        assert!(
            call(json!({"type":"openProject","source":source})).is_err(),
            "{mutation}"
        );
    }
    for source in [
        "[]",
        "{}",
        "{broken",
        "{\"format\":\"patchbay-graph\",\"version\":2,\"draft\":{}}",
        "{\"format\":\"patchbay-graph\",\"version\":1,\"draft\":{},\"extra\":1}",
    ] {
        assert!(call(json!({"type":"openProject","source":source})).is_err());
    }
}

#[test]
fn large_unicode_graph_has_no_256_state_or_1000_edge_cap() {
    let states = (0..300)
        .map(|i| json!({"id":format!("s{i}"),"name":format!("q{i}"),"output":"0","x":i*60,"y":120}))
        .collect::<Vec<_>>();
    let symbols = ["a", "b", "c", "λ", "🙂"];
    let outputs = ["α", "β", "γ", "δ", "ε"];
    let transitions=(0..300).flat_map(|i|(0..5).map(move|j|json!({"id":format!("t{}",300+i*5+j),"from":format!("s{i}"),"to":format!("s{}",(i+1)%300),"input":symbols[j],"output":outputs[j]}))).collect::<Vec<_>>();
    let draft = json!({"kind":"mealy","states":states,"transitions":transitions,"alphabet":symbols,"start":"s0","nextId":1800});
    let inspected = graph(json!({"type":"inspectGraph","draft":draft}));
    assert!(inspected.errors.is_empty());
    let DomainResponse::Text(file) =
        call(json!({"type":"exportGraph","draft":inspected.draft.clone()})).unwrap()
    else {
        panic!("Wrong response")
    };
    assert_eq!(
        graph(json!({"type":"openProject","source":file})).draft,
        inspected.draft
    );
    let machine = inspected.machine.unwrap();
    let DomainResponse::Evaluation(evaluation)=call(json!({"type":"simulate","machine":machine,"input":"abcλ🙂".repeat(10),"mooreInitial":true})).unwrap() else{panic!("Wrong response")};
    assert_eq!(evaluation.trace.unwrap().output, "αβγδε".repeat(10));
}

#[test]
fn alphabet_text_accepts_json_arrays_and_js_unicode_whitespace_in_rust() {
    let fixture = fixtures()[1]["draft"].clone();
    for text in [
        "[\"push\",\"coin\",\"🙂\",\"é\"]",
        "\u{feff}push\u{85}coin\u{2028}🙂 é",
    ] {
        let edited = graph(
            json!({"type":"editGraph","draft":fixture,"edit":{"type":"setAlphabetText","text":text}}),
        );
        assert_eq!(edited.draft.alphabet, ["push", "coin", "🙂", "é"]);
        assert_eq!(edited.draft.transitions.len(), 1);
        assert_eq!(edited.draft.transitions[0].output, "unlock");
    }
    let edited = graph(
        json!({"type":"editGraph","draft":fixture,"edit":{"type":"setAlphabetText","text":"[\"push\"]"}}),
    );
    assert_eq!(edited.draft.alphabet, ["push"]);
    assert!(edited.draft.transitions.is_empty());
    for text in [
        "[broken",
        "[1]",
        "[\"coin\",null]",
        "[\"coin\",\"coin\"]",
        "[\"bad output\"]",
        "coin coin",
    ] {
        let error=call(json!({"type":"editGraph","draft":fixture,"edit":{"type":"setAlphabetText","text":text}})).unwrap_err();
        assert_eq!(error.code, ErrorCode::Validation, "{text}");
    }
}
