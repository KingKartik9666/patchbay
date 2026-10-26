use crate::limits::{Diagnostics, MAX_PROJECT_BYTES, MAX_RESPONSE_BYTES, bound_serialized, charge};
use crate::symbols::{
    is_reserved, is_symbol, join_with_separator, output_separator, output_separator_for,
    tokenize_input,
};
use crate::{
    DomainError, Fault, MachineDef, MachineKind, Outputs, Step, SymbolMap, Trace, TransitionMap,
};
use std::collections::{HashMap, HashSet};

/// Complete IPC machines must have exactly the declared states, inputs and outputs.
pub fn validate_machine(machine: &MachineDef) -> Result<(), DomainError> {
    bound_serialized(machine, MAX_RESPONSE_BYTES, "Machine")?;
    let mut errors = Diagnostics::default();
    if machine.states.is_empty() {
        errors.push("Declare at least one state.");
    }
    if machine.alphabet.is_empty() {
        errors.push("Declare at least one input symbol.");
    }
    let mut states = HashSet::new();
    let mut alphabet = HashSet::new();
    for name in &machine.states {
        if !is_symbol(name) || is_reserved(name) {
            errors.push(format!(
                "State \"{name}\" needs a valid, unreserved Unicode token name."
            ));
        }
        if !states.insert(name.as_str()) {
            errors.push(format!("State {name} is duplicated."));
        }
    }
    for sym in &machine.alphabet {
        if !is_symbol(sym) {
            errors.push(format!(
                "Input \"{sym}\" must be a nonempty Unicode token without whitespace or #."
            ));
        }
        if !alphabet.insert(sym.as_str()) {
            errors.push(format!("Input \"{sym}\" is duplicated in the alphabet."));
        }
    }
    if !states.contains(machine.start.as_str()) {
        errors.push("The machine start state does not exist.");
    }
    for (state, row) in &machine.delta {
        if !states.contains(state.as_str()) {
            errors.push(format!(
                "Transitions reference unknown source state {state}."
            ));
        }
        for (sym, to) in row {
            if !alphabet.contains(sym.as_str()) {
                errors.push(format!(
                    "Transition input \"{sym}\" is not in the alphabet."
                ));
            }
            if !states.contains(to.as_str()) {
                errors.push(format!(
                    "Transition from {state} references unknown state {to}."
                ));
            }
        }
    }
    match &machine.outputs {
        Outputs::Mealy { lambda } => {
            for (state, row) in lambda {
                if !states.contains(state.as_str()) {
                    errors.push(format!("Outputs reference unknown state {state}."));
                }
                for (sym, out) in row {
                    if !alphabet.contains(sym.as_str()) {
                        errors.push(format!("Output input \"{sym}\" is not in the alphabet."));
                    }
                    if !is_symbol(out) {
                        errors.push(format!(
                            "Output from {state} for \"{sym}\" must be one nonempty Unicode token."
                        ));
                    }
                }
            }
        }
        Outputs::Moore { lambda } => {
            for (state, out) in lambda {
                if !states.contains(state.as_str()) {
                    errors.push(format!("Outputs reference unknown state {state}."));
                }
                if !is_symbol(out) {
                    errors.push(format!(
                        "Output for state {state} must be one nonempty Unicode token."
                    ));
                }
            }
        }
    }
    'states: for state in &machine.states {
        if let Outputs::Moore { lambda } = &machine.outputs
            && !lambda.contains_key(state)
        {
            errors.push(format!("State {state} needs an output."));
        }
        for sym in &machine.alphabet {
            if errors.full() {
                break 'states;
            }
            if !machine
                .delta
                .get(state)
                .is_some_and(|row| row.contains_key(sym))
            {
                errors.push(format!("State {state} has no transition for \"{sym}\"."));
            }
            if let Outputs::Mealy { lambda } = &machine.outputs
                && !lambda.get(state).is_some_and(|row| row.contains_key(sym))
            {
                errors.push(format!("State {state} has no output for \"{sym}\"."));
            }
        }
    }
    let details = errors.finish();
    if details.is_empty() {
        Ok(())
    } else {
        Err(DomainError {
            code: crate::ErrorCode::Validation,
            message: "The machine is not valid.".into(),
            details,
        })
    }
}

/// A pure simulation also accepts partial machines and halts at the first fault.
pub fn simulate(
    machine: &MachineDef,
    input: &str,
    moore_initial: bool,
) -> Result<Trace, DomainError> {
    bound_serialized(machine, MAX_RESPONSE_BYTES, "Machine")?;
    let symbols = tokenize_input(machine, input)?;
    simulate_symbols(machine, &symbols, moore_initial)
}

/// Callers check the machine byte budget and tokenize bounded input first.
pub(crate) fn simulate_symbols(
    machine: &MachineDef,
    symbols: &[String],
    moore_initial: bool,
) -> Result<Trace, DomainError> {
    let alphabet = machine
        .alphabet
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let states = machine
        .states
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let mut trace = Trace {
        initial_out: None,
        steps: Vec::with_capacity(symbols.len()),
        output: String::new(),
        fault: None,
        output_separator: String::new(),
    };
    let mut output_symbols = Vec::with_capacity(symbols.len() + 1);
    let mut current = machine.start.as_str();
    let mut used = 128;
    if let Outputs::Moore { lambda } = &machine.outputs
        && moore_initial
    {
        let Some(initial) = lambda.get(current) else {
            trace.fault = Some(Fault {
                at: 0,
                state: current.into(),
                sym: symbols.first().cloned().unwrap_or_default(),
            });
            trace.output_separator = output_separator(machine, &[]).into();
            return Ok(trace);
        };
        charge(
            &mut used,
            initial.len().saturating_mul(12) + 128,
            MAX_RESPONSE_BYTES,
            "Trace",
        )?;
        trace.initial_out = Some(initial.clone());
        output_symbols.push(initial.as_str());
    }
    for (i, sym) in symbols.iter().enumerate() {
        let to = machine.delta.get(current).and_then(|row| row.get(sym));
        if !alphabet.contains(sym.as_str())
            || !states.contains(current)
            || !to.is_some_and(|to| states.contains(to.as_str()))
        {
            trace.fault = Some(Fault {
                at: i,
                state: current.into(),
                sym: sym.clone(),
            });
            break;
        }
        let Some(to) = to else {
            break;
        };
        let out = match &machine.outputs {
            Outputs::Mealy { lambda } => lambda.get(current).and_then(|row| row.get(sym)),
            Outputs::Moore { lambda } => lambda.get(to),
        };
        let Some(out) = out else {
            trace.fault = Some(Fault {
                at: i,
                state: current.into(),
                sym: sym.clone(),
            });
            break;
        };
        // Conservatively include escaped JSON and the repeated output tape before cloning.
        let bytes = current
            .len()
            .saturating_add(sym.len())
            .saturating_add(to.len())
            .saturating_add(out.len().saturating_mul(2))
            .saturating_mul(6)
            .saturating_add(256);
        charge(&mut used, bytes, MAX_RESPONSE_BYTES, "Trace")?;
        trace.steps.push(Step {
            i,
            from: current.into(),
            sym: sym.clone(),
            to: to.clone(),
            out: out.clone(),
        });
        output_symbols.push(out.as_str());
        current = to;
    }
    let separator = output_separator_for(machine, &output_symbols);
    trace.output_separator = separator.into();
    trace.output = join_with_separator(&output_symbols, separator)?;
    bound_serialized(&trace, MAX_RESPONSE_BYTES, "Trace")?;
    Ok(trace)
}

/// Canonical DSL preserves explicit state/alphabet order, including isolated states.
pub fn serialize(machine: &MachineDef) -> Result<String, DomainError> {
    let mut result = String::new();
    let mut append = |line: String| -> Result<(), DomainError> {
        if result.len().saturating_add(line.len()).saturating_add(1) > MAX_PROJECT_BYTES {
            return Err(DomainError::limit(
                "Generated project text exceeds the 1 MiB UTF-8 limit.",
            ));
        }
        result.push_str(&line);
        result.push('\n');
        Ok(())
    };
    append(format!("type {}", machine.outputs.kind()))?;
    append(format!("start {}", machine.start))?;
    append(
        format!("alphabet {}", machine.alphabet.join(" "))
            .trim_end()
            .into(),
    )?;
    for state in &machine.states {
        append(format!("state {state}"))?;
    }
    if let Outputs::Moore { lambda } = &machine.outputs {
        for state in &machine.states {
            if let Some(out) = lambda.get(state) {
                append(format!("out {state} {out}"))?;
            }
        }
    }
    append(String::new())?;
    let indexes = machine
        .alphabet
        .iter()
        .enumerate()
        .map(|(i, sym)| (sym.as_str(), i))
        .collect::<HashMap<_, _>>();
    for state in &machine.states {
        let Some(row) = machine.delta.get(state) else {
            continue;
        };
        let mut edges = row
            .iter()
            .filter_map(|(sym, to)| indexes.get(sym.as_str()).map(|index| (*index, sym, to)))
            .collect::<Vec<_>>();
        edges.sort_unstable_by_key(|(index, _, _)| *index);
        for (_, sym, to) in edges {
            if let Outputs::Mealy { lambda } = &machine.outputs {
                let out = lambda.get(state).and_then(|row| row.get(sym));
                append(match out {
                    Some(out) => format!("{state} {sym} {to} {out}"),
                    None => format!("{state} {sym} {to}"),
                })?;
            } else {
                append(format!("{state} {sym} {to}"))?;
            }
        }
    }
    Ok(result)
}

pub fn moore_to_mealy(machine: &MachineDef) -> Result<MachineDef, DomainError> {
    let Outputs::Moore { lambda: moore } = &machine.outputs else {
        return Err(DomainError::validation(
            "Choose a Moore machine to convert to Mealy.",
        ));
    };
    validate_machine(machine)?;
    let mut delta = TransitionMap::new();
    let mut lambda = TransitionMap::new();
    let mut used = 0;
    for state in &machine.states {
        let mut row = SymbolMap::new();
        let mut outputs = SymbolMap::new();
        for sym in &machine.alphabet {
            if let Some(to) = machine.delta.get(state).and_then(|row| row.get(sym)) {
                let out = moore.get(to).ok_or_else(|| {
                    DomainError::validation(format!(
                        "State {to} needs an output before conversion."
                    ))
                })?;
                charge(
                    &mut used,
                    (sym.len().saturating_mul(2) + to.len() + out.len()).saturating_mul(6) + 64,
                    MAX_RESPONSE_BYTES,
                    "Converted machine",
                )?;
                row.insert(sym.clone(), to.clone());
                outputs.insert(sym.clone(), out.clone());
            }
        }
        delta.insert(state.clone(), row);
        lambda.insert(state.clone(), outputs);
    }
    let result = MachineDef {
        states: machine.states.clone(),
        alphabet: machine.alphabet.clone(),
        start: machine.start.clone(),
        delta,
        outputs: Outputs::Mealy { lambda },
    };
    bound_serialized(&result, MAX_RESPONSE_BYTES, "Converted machine")?;
    Ok(result)
}

pub fn mealy_to_moore(
    machine: &MachineDef,
    initial_output: &str,
) -> Result<MachineDef, DomainError> {
    let Outputs::Mealy { lambda: mealy } = &machine.outputs else {
        return Err(DomainError::validation(
            "Choose a Mealy machine to convert to Moore.",
        ));
    };
    if !is_symbol(initial_output) {
        return Err(DomainError::validation(
            "The initial Moore output must be a nonempty Unicode token without whitespace or #.",
        ));
    }
    validate_machine(machine)?;
    let mut pairs = Vec::<(String, &str, &str)>::new();
    let mut indexes = HashMap::<(&str, &str), usize>::new();
    let mut used = initial_output.len().saturating_mul(6) + 128;
    for from in &machine.states {
        for sym in &machine.alphabet {
            let (Some(to), Some(out)) = (
                machine.delta.get(from).and_then(|row| row.get(sym)),
                mealy.get(from).and_then(|row| row.get(sym)),
            ) else {
                continue;
            };
            let key = (to.as_str(), out.as_str());
            if let std::collections::hash_map::Entry::Vacant(entry) = indexes.entry(key) {
                let index = pairs.len();
                let name = format!("Q{index}_{to}");
                charge(
                    &mut used,
                    (name.len() * 2 + out.len()).saturating_mul(6) + 64,
                    MAX_RESPONSE_BYTES,
                    "Converted machine",
                )?;
                entry.insert(index);
                pairs.push((name, to.as_str(), out.as_str()));
            }
        }
    }
    let mut states = vec!["Initial".to_owned()];
    states.extend(pairs.iter().map(|(name, _, _)| name.clone()));
    let mut delta = TransitionMap::new();
    let mut lambda = SymbolMap::new();
    for (name, original, output) in
        std::iter::once(("Initial", machine.start.as_str(), initial_output)).chain(
            pairs
                .iter()
                .map(|(name, original, out)| (name.as_str(), *original, *out)),
        )
    {
        let mut row = SymbolMap::new();
        lambda.insert(name.into(), output.into());
        for sym in &machine.alphabet {
            let (Some(to), Some(out)) = (
                machine.delta.get(original).and_then(|row| row.get(sym)),
                mealy.get(original).and_then(|row| row.get(sym)),
            ) else {
                continue;
            };
            if let Some(index) = indexes.get(&(to.as_str(), out.as_str())) {
                let destination = &pairs[*index].0;
                charge(
                    &mut used,
                    (sym.len() + destination.len()).saturating_mul(6) + 16,
                    MAX_RESPONSE_BYTES,
                    "Converted machine",
                )?;
                row.insert(sym.clone(), destination.clone());
            }
        }
        delta.insert(name.into(), row);
    }
    let result = MachineDef {
        states,
        alphabet: machine.alphabet.clone(),
        start: "Initial".into(),
        delta,
        outputs: Outputs::Moore { lambda },
    };
    bound_serialized(&result, MAX_RESPONSE_BYTES, "Converted machine")?;
    Ok(result)
}

pub fn convert(
    machine: &MachineDef,
    target: MachineKind,
    initial_output: Option<&str>,
) -> Result<MachineDef, DomainError> {
    if machine.outputs.kind() == target {
        validate_machine(machine)?;
        return Ok(machine.clone());
    }
    match target {
        MachineKind::Mealy => moore_to_mealy(machine),
        MachineKind::Moore => mealy_to_moore(machine, initial_output.unwrap_or("0")),
    }
}
