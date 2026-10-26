use crate::limits::{Diagnostics, MAX_RESPONSE_BYTES, bound_serialized, charge, check_source};
use crate::symbols::{is_lexical_whitespace, is_reserved, is_symbol};
use crate::{
    DomainError, ErrorCode, GraphDraft, GraphEdit, GraphResult, GraphState, GraphTransition,
    MachineDef, MachineKind, Outputs, Position, SymbolMap, TransitionMap,
};
use crate::{parse, serialize, validate_machine};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

pub const MAX_SAFE_ID: u64 = 9_007_199_254_740_991;

pub fn create_draft(kind: MachineKind) -> GraphDraft {
    GraphDraft {
        kind,
        start: String::new(),
        next_id: 0,
        alphabet: Vec::new(),
        states: Vec::new(),
        transitions: Vec::new(),
    }
}
fn coordinate(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}
fn assert_name(name: &str) -> Result<(), DomainError> {
    if is_reserved(name) {
        Err(DomainError::validation(format!(
            "\"{name}\" is a reserved keyword. Choose another state name."
        )))
    } else if !is_symbol(name) {
        Err(DomainError::validation(
            "Choose a nonempty state name without whitespace or #.",
        ))
    } else {
        Ok(())
    }
}
fn assert_symbol(value: &str, label: &str, allow_empty: bool) -> Result<(), DomainError> {
    if (allow_empty && value.is_empty()) || is_symbol(value) {
        Ok(())
    } else {
        Err(DomainError::validation(format!(
            "{label} must be one nonempty Unicode token without whitespace or #."
        )))
    }
}
fn assert_coordinates(x: f64, y: f64) -> Result<(), DomainError> {
    if coordinate(x) && coordinate(y) {
        Ok(())
    } else {
        Err(DomainError::validation(
            "State coordinates must be finite and nonnegative.",
        ))
    }
}
fn set_alphabet(draft: &mut GraphDraft, symbols: &[String]) -> Result<(), DomainError> {
    let mut seen = HashSet::new();
    for symbol in symbols {
        assert_symbol(symbol, "Input", false)?;
        if !seen.insert(symbol.as_str()) {
            return Err(DomainError::validation(format!(
                "Input \"{symbol}\" is already in the alphabet. Keep each symbol once."
            )));
        }
    }
    draft
        .transitions
        .retain(|edge| seen.contains(edge.input.as_str()));
    draft.alphabet = symbols.to_vec();
    Ok(())
}
fn state_index(draft: &GraphDraft, id: &str) -> Result<usize, DomainError> {
    draft
        .states
        .iter()
        .position(|state| state.id == id)
        .ok_or_else(|| {
            DomainError::validation(
                "That state does not exist in this draft. Select an existing state.",
            )
        })
}
fn allocate_id(
    draft: &mut GraphDraft,
    prefix: char,
    used: &mut HashSet<String>,
) -> Result<String, DomainError> {
    if draft.next_id > MAX_SAFE_ID {
        return Err(DomainError::validation("The draft id counter is invalid."));
    }
    loop {
        if draft.next_id >= MAX_SAFE_ID {
            return Err(DomainError::validation(
                "The draft id counter has no safe ids remaining.",
            ));
        }
        let id = format!("{prefix}{}", draft.next_id);
        draft.next_id += 1;
        if used.insert(id.clone()) {
            return Ok(id);
        }
    }
}

/// Structural validation permits unfinished behavior, but never corrupt references.
pub fn validate_structure(draft: &GraphDraft) -> Result<(), DomainError> {
    bound_serialized(draft, MAX_RESPONSE_BYTES, "Graph draft")?;
    let mut errors = Diagnostics::default();
    if draft.next_id > MAX_SAFE_ID {
        errors.push("The draft nextId must be a nonnegative safe integer.");
    }
    let mut ids = HashSet::new();
    let mut state_ids = HashSet::new();
    let mut names = HashSet::new();
    let mut alphabet = HashSet::new();
    for (index, state) in draft.states.iter().enumerate() {
        let path = format!("State {}", index + 1);
        if state.id.is_empty() {
            errors.push(format!("{path} needs a nonempty id."));
        } else {
            if !ids.insert(state.id.as_str()) {
                errors.push(format!("{path} has a duplicate id \"{}\".", state.id));
            }
            state_ids.insert(state.id.as_str());
        }
        if !is_symbol(&state.name) || is_reserved(&state.name) {
            errors.push(format!(
                "{path} needs a nonempty, unreserved name without whitespace or #."
            ));
        } else if !names.insert(state.name.as_str()) {
            errors.push(format!("State name {} is duplicated.", state.name));
        }
        if !(state.output.is_empty() || is_symbol(&state.output)) {
            errors.push(format!(
                "{path} output must be empty or one nonempty Unicode token without whitespace or #."
            ));
        }
        if !coordinate(state.x) || !coordinate(state.y) {
            errors.push(format!(
                "{path} coordinates must be finite and nonnegative."
            ));
        }
    }
    for symbol in &draft.alphabet {
        if !is_symbol(symbol) {
            errors.push("Each input alphabet entry must be one nonempty Unicode token without whitespace or #.");
        } else if !alphabet.insert(symbol.as_str()) {
            errors.push(format!("Input \"{symbol}\" is duplicated in the alphabet."));
        }
    }
    if !draft.start.is_empty() && !state_ids.contains(draft.start.as_str()) {
        errors.push("The start state references an unknown state.");
    }
    let mut pairs = HashSet::new();
    for (index, edge) in draft.transitions.iter().enumerate() {
        let path = format!("Transition {}", index + 1);
        if edge.id.is_empty() {
            errors.push(format!("{path} needs a nonempty id."));
        } else if !ids.insert(edge.id.as_str()) {
            errors.push(format!("{path} has a duplicate id \"{}\".", edge.id));
        }
        if !state_ids.contains(edge.from.as_str()) {
            errors.push(format!("{path} references an unknown source state."));
        }
        if !state_ids.contains(edge.to.as_str()) {
            errors.push(format!("{path} references an unknown destination state."));
        }
        if !is_symbol(&edge.input) {
            errors.push(format!(
                "{path} input must be one nonempty Unicode token without whitespace or #."
            ));
        } else if !alphabet.contains(edge.input.as_str()) {
            errors.push(format!(
                "{path} input \"{}\" is not in the alphabet.",
                edge.input
            ));
        }
        if !(edge.output.is_empty() || is_symbol(&edge.output)) {
            errors.push(format!(
                "{path} output must be empty or one nonempty Unicode token without whitespace or #."
            ));
        }
        if !pairs.insert((edge.from.as_str(), edge.input.as_str())) {
            errors.push(format!(
                "{path} duplicates a state/input pair. Keep one transition per state/input."
            ));
        }
    }
    let details = errors.finish();
    if details.is_empty() {
        Ok(())
    } else {
        Err(DomainError {
            code: ErrorCode::Validation,
            message: "The graph draft has invalid editing data.".into(),
            details,
        })
    }
}

pub fn validate_draft(draft: &GraphDraft) -> Result<Vec<String>, DomainError> {
    validate_structure(draft)?;
    let mut errors = Diagnostics::default();
    if draft.states.is_empty() {
        errors.push("Add at least one state.");
    }
    if draft.alphabet.is_empty() {
        errors.push("Add at least one input symbol to the alphabet.");
    }
    if draft.start.is_empty() {
        errors.push("Choose a start state.");
    }
    let pairs = draft
        .transitions
        .iter()
        .map(|edge| (edge.from.as_str(), edge.input.as_str()))
        .collect::<HashSet<_>>();
    'states: for state in &draft.states {
        for input in &draft.alphabet {
            if errors.full() {
                break 'states;
            }
            if !pairs.contains(&(state.id.as_str(), input.as_str())) {
                errors.push(format!("State {} has no transition for \"{input}\". Connect a target or fill missing self-loops.",state.name));
            }
        }
        if draft.kind == MachineKind::Moore && !is_symbol(&state.output) {
            errors.push(format!("State {} needs one output token.", state.name));
        }
    }
    if draft.kind == MachineKind::Mealy {
        let names = draft
            .states
            .iter()
            .map(|state| (state.id.as_str(), state.name.as_str()))
            .collect::<HashMap<_, _>>();
        for edge in &draft.transitions {
            if errors.full() {
                break;
            }
            if !is_symbol(&edge.output) {
                errors.push(format!(
                    "The transition from {} for \"{}\" needs one output token.",
                    names.get(edge.from.as_str()).copied().unwrap_or_default(),
                    edge.input
                ));
            }
        }
    }
    Ok(errors.finish())
}

fn machine_from_draft(draft: &GraphDraft) -> MachineDef {
    let names = draft
        .states
        .iter()
        .map(|state| (state.id.as_str(), state.name.as_str()))
        .collect::<HashMap<_, _>>();
    let mut delta = TransitionMap::new();
    let mut mealy = TransitionMap::new();
    let mut moore = SymbolMap::new();
    for state in &draft.states {
        delta.insert(state.name.clone(), SymbolMap::new());
        mealy.insert(state.name.clone(), SymbolMap::new());
        if !state.output.is_empty() {
            moore.insert(state.name.clone(), state.output.clone());
        }
    }
    for edge in &draft.transitions {
        if let (Some(from), Some(to)) = (names.get(edge.from.as_str()), names.get(edge.to.as_str()))
        {
            delta
                .entry((*from).into())
                .or_default()
                .insert(edge.input.clone(), (*to).into());
            if !edge.output.is_empty() {
                mealy
                    .entry((*from).into())
                    .or_default()
                    .insert(edge.input.clone(), edge.output.clone());
            }
        }
    }
    MachineDef {
        states: draft
            .states
            .iter()
            .map(|state| state.name.clone())
            .collect(),
        alphabet: draft.alphabet.clone(),
        start: names
            .get(draft.start.as_str())
            .copied()
            .unwrap_or_default()
            .into(),
        delta,
        outputs: if draft.kind == MachineKind::Mealy {
            Outputs::Mealy { lambda: mealy }
        } else {
            Outputs::Moore { lambda: moore }
        },
    }
}

pub fn draft_to_machine(draft: &GraphDraft) -> Result<MachineDef, DomainError> {
    let details = validate_draft(draft)?;
    if !details.is_empty() {
        return Err(DomainError {
            code: ErrorCode::Validation,
            message: "Complete the graph before running it.".into(),
            details,
        });
    }
    Ok(machine_from_draft(draft))
}
pub fn draft_to_source(draft: &GraphDraft) -> Result<String, DomainError> {
    validate_structure(draft)?;
    serialize(&machine_from_draft(draft))
}
pub fn inspect_graph(draft: GraphDraft) -> Result<GraphResult, DomainError> {
    let errors = validate_draft(&draft)?;
    let machine = machine_from_draft(&draft);
    let source = serialize(&machine)?;
    Ok(GraphResult {
        draft,
        source,
        machine: errors.is_empty().then_some(machine),
        errors,
    })
}

/// Frontend layout may provide positions; the domain's fallback is a deterministic grid.
pub fn draft_from_machine(
    machine: &MachineDef,
    positions: Option<&BTreeMap<String, Position>>,
) -> Result<GraphDraft, DomainError> {
    validate_machine(machine)?;
    let mut draft = create_draft(machine.outputs.kind());
    draft.alphabet = machine.alphabet.clone();
    let mut names = HashMap::new();
    let mut ids = HashSet::new();
    for (index, name) in machine.states.iter().enumerate() {
        let position = positions
            .and_then(|positions| positions.get(name))
            .filter(|position| coordinate(position.x) && coordinate(position.y));
        let x = position.map_or(140.0 + (index % 5) as f64 * 170.0, |position| position.x);
        let y = position.map_or(140.0 + (index / 5) as f64 * 140.0, |position| position.y);
        let id = allocate_id(&mut draft, 's', &mut ids)?;
        let output = match &machine.outputs {
            Outputs::Moore { lambda } => lambda.get(name).cloned().unwrap_or_default(),
            Outputs::Mealy { .. } => "0".into(),
        };
        names.insert(name.as_str(), id.clone());
        draft.states.push(GraphState {
            id,
            name: name.clone(),
            output,
            x,
            y,
        });
    }
    draft.start = names
        .get(machine.start.as_str())
        .cloned()
        .ok_or_else(|| DomainError::validation("The machine start state does not exist."))?;
    for from in &machine.states {
        for input in &machine.alphabet {
            let Some(to) = machine.delta.get(from).and_then(|row| row.get(input)) else {
                continue;
            };
            let output = match &machine.outputs {
                Outputs::Mealy { lambda } => lambda
                    .get(from)
                    .and_then(|row| row.get(input))
                    .cloned()
                    .unwrap_or_default(),
                Outputs::Moore { .. } => "0".into(),
            };
            let id = allocate_id(&mut draft, 't', &mut ids)?;
            let from_id = names.get(from.as_str()).cloned().ok_or_else(|| {
                DomainError::validation("A transition source state does not exist.")
            })?;
            let to_id = names.get(to.as_str()).cloned().ok_or_else(|| {
                DomainError::validation("A transition destination state does not exist.")
            })?;
            draft.transitions.push(GraphTransition {
                id,
                from: from_id,
                to: to_id,
                input: input.clone(),
                output,
            });
        }
    }
    validate_structure(&draft)?;
    Ok(draft)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct GraphFile {
    format: String,
    version: u64,
    draft: GraphDraft,
}

pub fn serialize_draft(draft: &GraphDraft) -> Result<String, DomainError> {
    validate_structure(draft)?;
    let wrapper = GraphFile {
        format: "patchbay-graph".into(),
        version: 1,
        draft: draft.clone(),
    };
    // This is the user-facing file limit, including pretty printing and its newline.
    let mut source = serde_json::to_string_pretty(&wrapper).map_err(|_| {
        DomainError::new(ErrorCode::Internal, "Unable to serialize the graph file.")
    })?;
    source.push('\n');
    check_source(&source)?;
    Ok(source)
}
pub fn parse_draft(source: &str) -> Result<GraphDraft, DomainError> {
    check_source(source)?;
    let significant = source.trim_start_matches(is_lexical_whitespace);
    if significant.starts_with(['{', '[']) {
        let wrapper: GraphFile = serde_json::from_str(significant).map_err(|error| {
            DomainError::format(format!(
                "The graph file is not valid versioned graph JSON: {error}"
            ))
        })?;
        if wrapper.format != "patchbay-graph" || wrapper.version != 1 {
            return Err(DomainError::format(
                "Use a patchbay-graph file with version 1.",
            ));
        }
        validate_structure(&wrapper.draft)?;
        Ok(wrapper.draft)
    } else {
        let result = parse(source)?;
        let machine = result.machine.ok_or_else(|| DomainError {
            code: ErrorCode::Validation,
            message: "The machine text is not valid.".into(),
            details: result
                .errors
                .into_iter()
                .map(|error| format!("Line {}: {}", error.line, error.msg))
                .collect(),
        })?;
        draft_from_machine(&machine, None)
    }
}

/// Edits always run on a copy. A failure cannot return partially changed editing data.
pub fn edit_graph(original: &GraphDraft, edit: &GraphEdit) -> Result<GraphDraft, DomainError> {
    validate_structure(original)?;
    let mut draft = original.clone();
    let mut ids = draft
        .states
        .iter()
        .map(|state| state.id.clone())
        .chain(draft.transitions.iter().map(|edge| edge.id.clone()))
        .collect::<HashSet<_>>();
    match edit {
        GraphEdit::AddState { x, y, name } => {
            assert_coordinates(*x, *y)?;
            let names = draft
                .states
                .iter()
                .map(|state| state.name.as_str())
                .collect::<HashSet<_>>();
            let chosen = if let Some(name) = name {
                name.clone()
            } else {
                let mut index = 0;
                while names.contains(format!("q{index}").as_str()) {
                    index += 1;
                }
                format!("q{index}")
            };
            assert_name(&chosen)?;
            if names.contains(chosen.as_str()) {
                return Err(DomainError::validation(format!(
                    "State {chosen} already exists. Choose a unique state name."
                )));
            }
            let id = allocate_id(&mut draft, 's', &mut ids)?;
            if draft.states.is_empty() {
                draft.start = id.clone();
            }
            draft.states.push(GraphState {
                id,
                name: chosen,
                output: "0".into(),
                x: *x,
                y: *y,
            });
        }
        GraphEdit::UpdateState {
            id,
            name,
            output,
            start,
        } => {
            let index = state_index(&draft, id)?;
            assert_name(name)?;
            assert_symbol(output, "State output", true)?;
            if draft
                .states
                .iter()
                .any(|state| state.id != *id && state.name == *name)
            {
                return Err(DomainError::validation(format!(
                    "State {name} already exists. Choose a unique state name."
                )));
            }
            draft.states[index].name = name.clone();
            draft.states[index].output = output.clone();
            if *start {
                draft.start = id.clone();
            } else if draft.start == *id {
                draft.start.clear();
            }
        }
        GraphEdit::MoveState { id, x, y } => {
            let index = state_index(&draft, id)?;
            assert_coordinates(*x, *y)?;
            draft.states[index].x = *x;
            draft.states[index].y = *y;
        }
        GraphEdit::RemoveState { id } => {
            state_index(&draft, id)?;
            draft.states.retain(|state| state.id != *id);
            draft
                .transitions
                .retain(|edge| edge.from != *id && edge.to != *id);
            if draft.start == *id {
                draft.start = draft
                    .states
                    .first()
                    .map(|state| state.id.clone())
                    .unwrap_or_default();
            }
        }
        GraphEdit::UpsertTransition {
            id,
            from,
            to,
            input,
            output,
        } => {
            let source_index = state_index(&draft, from)?;
            state_index(&draft, to)?;
            assert_symbol(input, "Input", false)?;
            assert_symbol(output, "Transition output", true)?;
            let existing = match id {
                Some(id) => Some(
                    draft
                        .transitions
                        .iter()
                        .position(|edge| edge.id == *id)
                        .ok_or_else(|| {
                            DomainError::validation(
                                "That transition does not exist. Select an existing edge to edit.",
                            )
                        })?,
                ),
                None => None,
            };
            if draft.transitions.iter().enumerate().any(|(index, edge)| {
                Some(index) != existing && edge.from == *from && edge.input == *input
            }) {
                return Err(DomainError::validation(format!(
                    "State {} already has a transition for \"{input}\". Edit that edge instead.",
                    draft.states[source_index].name
                )));
            }
            let edge_id = if let Some(index) = existing {
                draft.transitions[index].id.clone()
            } else {
                allocate_id(&mut draft, 't', &mut ids)?
            };
            let edge = GraphTransition {
                id: edge_id,
                from: from.clone(),
                to: to.clone(),
                input: input.clone(),
                output: output.clone(),
            };
            if let Some(index) = existing {
                draft.transitions[index] = edge;
            } else {
                draft.transitions.push(edge);
            }
            if !draft.alphabet.contains(input) {
                draft.alphabet.push(input.clone());
            }
        }
        GraphEdit::RemoveTransition { id } => {
            if !draft.transitions.iter().any(|edge| edge.id == *id) {
                return Err(DomainError::validation(
                    "That transition does not exist. Select an existing edge.",
                ));
            }
            draft.transitions.retain(|edge| edge.id != *id);
        }
        GraphEdit::SetAlphabet { symbols } => {
            set_alphabet(&mut draft, symbols)?;
        }
        GraphEdit::SetAlphabetText { text } => {
            let text = text.trim_matches(is_lexical_whitespace);
            let symbols: Vec<String> = if text.starts_with('[') {
                serde_json::from_str(text).map_err(|_| {
                    DomainError::validation(
                        "Enter a JSON array of strings or whitespace-separated input symbols.",
                    )
                })?
            } else {
                text.split(is_lexical_whitespace)
                    .filter(|symbol| !symbol.is_empty())
                    .map(str::to_owned)
                    .collect()
            };
            set_alphabet(&mut draft, &symbols)?;
        }
        GraphEdit::SetKind { kind } => {
            draft.kind = *kind;
            match kind {
                MachineKind::Moore => {
                    for state in &mut draft.states {
                        if !is_symbol(&state.output) {
                            state.output = "0".into();
                        }
                    }
                }
                MachineKind::Mealy => {
                    for edge in &mut draft.transitions {
                        if !is_symbol(&edge.output) {
                            edge.output = "0".into();
                        }
                    }
                }
            }
        }
        GraphEdit::SetStart { id } => {
            if !id.is_empty() {
                state_index(&draft, id)?;
            }
            draft.start = id.clone();
        }
        GraphEdit::FillMissing { output } => {
            assert_symbol(output, "Transition output", false)?;
            let pairs = draft
                .transitions
                .iter()
                .map(|edge| (edge.from.clone(), edge.input.clone()))
                .collect::<HashSet<_>>();
            let states = draft
                .states
                .iter()
                .map(|state| state.id.clone())
                .collect::<Vec<_>>();
            let alphabet = draft.alphabet.clone();
            let mut bytes = 0;
            for state in states {
                for input in &alphabet {
                    if pairs.contains(&(state.clone(), input.clone())) {
                        continue;
                    }
                    charge(
                        &mut bytes,
                        (state.len() * 2 + input.len() + output.len()).saturating_mul(6) + 128,
                        MAX_RESPONSE_BYTES,
                        "Filled graph",
                    )?;
                    let id = allocate_id(&mut draft, 't', &mut ids)?;
                    draft.transitions.push(GraphTransition {
                        id,
                        from: state.clone(),
                        to: state.clone(),
                        input: input.clone(),
                        output: output.clone(),
                    });
                }
            }
        }
    }
    validate_structure(&draft)?;
    Ok(draft)
}
