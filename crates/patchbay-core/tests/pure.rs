#![allow(clippy::unwrap_used, clippy::expect_used)]
use patchbay_core::*;
use serde_json::json;

fn machine(source: &str) -> MachineDef {
    let result = parse(source).unwrap();
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    result.machine.unwrap()
}

#[test]
fn a_large_initial_token_that_fits_the_file_budget_is_not_rejected_by_an_estimate() {
    let original = machine("type mealy\nstart A\nA 0 A 1");
    let initial = "ready".repeat(40_000);
    let converted = mealy_to_moore(&original, &initial).unwrap();
    assert!(serialize(&converted).unwrap().len() < MAX_PROJECT_BYTES);
    assert_eq!(simulate(&converted, "0", false).unwrap().output, "1");
}

#[test]
fn pure_simulation_preserves_the_completed_prefix_of_partial_data() {
    let mut definition = machine("type mealy\nstart A\nA 0 A 1\nA 1 B 0\nB 0 A 1\nB 1 B 1");
    definition.delta.get_mut("B").unwrap().remove("1");
    let trace = simulate(&definition, "011", true).unwrap();
    assert_eq!(trace.output, "10");
    assert_eq!(trace.steps.len(), 2);
    assert_eq!(
        trace.fault,
        Some(Fault {
            at: 2,
            state: "B".into(),
            sym: "1".into()
        })
    );
    if let Outputs::Mealy { lambda } = &mut definition.outputs {
        lambda.get_mut("A").unwrap().remove("0");
    }
    assert_eq!(
        simulate(&definition, "0", true).unwrap().fault.unwrap().at,
        0
    );
    definition
        .delta
        .get_mut("A")
        .unwrap()
        .insert("1".into(), "missing".into());
    assert_eq!(
        simulate(&definition, "1", true)
            .unwrap()
            .fault
            .unwrap()
            .state,
        "A"
    );
    let mut moore = machine("type moore\nstart A\nout A 0\nA 0 A");
    if let Outputs::Moore { lambda } = &mut moore.outputs {
        lambda.clear();
    }
    assert_eq!(
        simulate(&moore, "", true).unwrap().fault,
        Some(Fault {
            at: 0,
            state: "A".into(),
            sym: String::new()
        })
    );
}

#[test]
fn declaration_order_and_nonbinary_alphabet_order_survive_round_trips() {
    let source = "type mealy\nstart B\nA a B 0\nB a A 1\nstate B\nstate A\nalphabet a";
    let original = machine(source);
    assert_eq!(original.states, ["B", "A"]);
    assert_eq!(machine(&serialize(&original).unwrap()), original);
    assert_eq!(simulate(&original, "aaa", true).unwrap().output, "101");
}

#[test]
fn graph_edits_commit_positions_start_choice_and_transition_replacements_by_stable_id() {
    let original = machine("type mealy\nstart A\nA coin B unlock\nB coin A lock");
    let draft = draft_from_machine(&original, None).unwrap();
    let snapshot = draft.clone();
    let moved = edit_graph(
        &draft,
        &GraphEdit::MoveState {
            id: "s0".into(),
            x: 0.,
            y: 35.,
        },
    )
    .unwrap();
    assert_eq!(draft, snapshot);
    assert_eq!((moved.states[0].x, moved.states[0].y), (0., 35.));
    let renamed = edit_graph(
        &moved,
        &GraphEdit::UpdateState {
            id: "s0".into(),
            name: "Ω".into(),
            output: "inactive".into(),
            start: false,
        },
    )
    .unwrap();
    assert!(renamed.start.is_empty());
    let started = edit_graph(&renamed, &GraphEdit::SetStart { id: "s1".into() }).unwrap();
    assert_eq!(started.start, "s1");
    let edge = started.transitions[0].clone();
    let replaced = edit_graph(
        &started,
        &GraphEdit::UpsertTransition {
            id: Some(edge.id.clone()),
            from: edge.from.clone(),
            to: edge.from.clone(),
            input: edge.input.clone(),
            output: "refund".into(),
        },
    )
    .unwrap();
    assert_eq!(replaced.transitions.len(), 2);
    assert_eq!(replaced.transitions[0].id, edge.id);
    assert_eq!(replaced.next_id, started.next_id);
    assert!(
        edit_graph(
            &replaced,
            &GraphEdit::UpsertTransition {
                id: None,
                from: edge.from.clone(),
                to: edge.to.clone(),
                input: edge.input.clone(),
                output: "bad".into()
            }
        )
        .is_err()
    );
    assert_eq!(started.transitions[0], edge);
    let loaded = parse_draft(&serialize_draft(&replaced).unwrap()).unwrap();
    assert_eq!(loaded, replaced);
}

#[test]
fn fill_failure_after_allocating_a_safe_id_still_leaves_the_original_unchanged() {
    let mut draft =
        draft_from_machine(&machine("type mealy\nstart A\nA a A 0\nA b A 1"), None).unwrap();
    draft.transitions.clear();
    draft.next_id = MAX_SAFE_ID - 1;
    let before = draft.clone();
    assert!(edit_graph(&draft, &GraphEdit::FillMissing { output: "0".into() }).is_err());
    assert_eq!(draft, before);
}

#[test]
fn id_allocation_skips_collisions_and_never_reuses_removed_counters() {
    let draft:GraphDraft=serde_json::from_value(json!({"kind":"mealy","start":"s0","nextId":0,"alphabet":[],"states":[{"id":"s0","name":"q0","output":"","x":0,"y":0}],"transitions":[]})).unwrap();
    let next = edit_graph(
        &draft,
        &GraphEdit::AddState {
            x: 50.,
            y: 50.,
            name: None,
        },
    )
    .unwrap();
    assert_eq!(next.states[1].id, "s1");
    assert_eq!(next.states[1].name, "q1");
    assert_eq!(next.next_id, 2);
    let removed = edit_graph(&next, &GraphEdit::RemoveState { id: "s1".into() }).unwrap();
    assert_eq!(
        edit_graph(
            &removed,
            &GraphEdit::AddState {
                x: 80.,
                y: 80.,
                name: None
            }
        )
        .unwrap()
        .states[1]
            .id,
        "s2"
    );
}

#[test]
fn full_adder_outputs_all_four_bit_sums_with_the_final_carry() {
    let preset = presets()
        .unwrap()
        .into_iter()
        .find(|preset| preset.id == "binary-full-adder")
        .unwrap();
    let definition = machine(&preset.source);
    for a in 0..16 {
        for b in 0..16 {
            let mut pairs = (0..4)
                .map(|bit| format!("{}{}", (a >> bit) & 1, (b >> bit) & 1))
                .collect::<Vec<_>>();
            pairs.push("00".into());
            let expected = format!("{:05b}", a + b).chars().rev().collect::<String>();
            let trace = simulate(&definition, &pairs.join(" "), true).unwrap();
            assert_eq!(trace.output, expected, "{a}+{b}");
            assert!(trace.fault.is_none());
        }
    }
}

#[test]
fn overlapping_101_detector_matches_every_binary_input_through_eight_bits() {
    let preset = presets()
        .unwrap()
        .into_iter()
        .find(|preset| preset.id == "mealy-101-detector")
        .unwrap();
    let definition = machine(&preset.source);
    for len in 0..=8 {
        for value in 0..(1 << len) {
            let input = if len == 0 {
                String::new()
            } else {
                format!("{value:0len$b}")
            };
            let expected = (0..input.len())
                .map(|index| {
                    if input[index.saturating_sub(2)..=index] == *"101" {
                        '1'
                    } else {
                        '0'
                    }
                })
                .collect::<String>();
            assert_eq!(
                simulate(&definition, &input, true).unwrap().output,
                expected,
                "{input}"
            );
        }
    }
}

#[test]
fn conversion_and_fill_expansion_return_limits_without_mutating_inputs() {
    let output = "x".repeat(40_000);
    let mut source = format!("type moore\nstart A\nout A {output}\nalphabet");
    for i in 0..1000 {
        source.push_str(&format!(" a{i}"));
    }
    for i in 0..1000 {
        source.push_str(&format!("\nA a{i} A"));
    }
    let definition = machine(&source);
    let before = definition.clone();
    assert_eq!(
        moore_to_mealy(&definition).unwrap_err().code,
        ErrorCode::Limit
    );
    assert_eq!(definition, before);
    let mut draft = create_draft(MachineKind::Mealy);
    draft.states = (0..1000)
        .map(|i| GraphState {
            id: format!("s{i}"),
            name: format!("S{i}"),
            output: String::new(),
            x: 0.,
            y: 0.,
        })
        .collect();
    draft.alphabet = (0..1000).map(|i| format!("a{i}")).collect();
    draft.start = "s0".into();
    draft.next_id = 1000;
    let before = draft.clone();
    assert_eq!(
        edit_graph(&draft, &GraphEdit::FillMissing { output: "0".into() })
            .unwrap_err()
            .code,
        ErrorCode::Limit
    );
    assert_eq!(draft, before);
}
