use crate::limits::{MAX_DIAGNOSTICS, check_source, clipped};
use crate::symbols::{is_lexical_whitespace, is_reserved, is_symbol};
use crate::{
    DomainError, MachineDef, MachineKind, Outputs, ParseError, ParseResult, SymbolMap,
    TransitionMap,
};
use std::collections::{HashMap, HashSet};

#[derive(Default)]
struct Errors(Vec<ParseError>);
impl Errors {
    fn push(&mut self, line: usize, msg: impl AsRef<str>) {
        if self.0.len() < MAX_DIAGNOSTICS {
            self.0.push(ParseError {
                line,
                msg: clipped(msg.as_ref()),
            });
        }
    }
    fn full(&self) -> bool {
        self.0.len() >= MAX_DIAGNOSTICS
    }
    fn finish(mut self) -> Vec<ParseError> {
        if self.full() {
            self.0.push(ParseError {
                line: 1,
                msg: "Additional diagnostics omitted; fix the listed errors and parse again."
                    .into(),
            });
        }
        self.0.sort_by_key(|error| error.line);
        self.0
    }
}

fn add_state(
    name: &str,
    line: usize,
    states: &mut Vec<String>,
    state_lines: &mut HashMap<String, usize>,
    delta: &mut TransitionMap,
    outputs: &mut TransitionMap,
    errors: &mut Errors,
) {
    if is_reserved(name) {
        errors.push(
            line,
            format!("\"{name}\" is a reserved keyword. Choose another state name."),
        );
        return;
    }
    if !is_symbol(name) {
        errors.push(
            line,
            "Choose a state name containing valid Unicode without whitespace or #.",
        );
        return;
    }
    if !state_lines.contains_key(name) {
        states.push(name.into());
        state_lines.insert(name.into(), line);
        delta.insert(name.into(), SymbolMap::new());
        outputs.insert(name.into(), SymbolMap::new());
    }
}

/// Parses the whitespace DSL with stable display order and original line numbers.
pub fn parse(source: &str) -> Result<ParseResult, DomainError> {
    check_source(source)?;
    let lines = source
        .split('\n')
        .enumerate()
        .filter_map(|(index, raw)| {
            let text = raw
                .split('#')
                .next()
                .unwrap_or_default()
                .trim_matches(is_lexical_whitespace);
            (!text.is_empty()).then(|| {
                (
                    index + 1,
                    text.split(is_lexical_whitespace)
                        .filter(|token| !token.is_empty())
                        .collect::<Vec<_>>(),
                )
            })
        })
        .collect::<Vec<_>>();
    let mut errors = Errors::default();
    let (mut kind, mut start, mut start_line) = (None, None, 1);
    let (mut type_seen, mut start_seen, mut alphabet_seen) = (false, false, false);
    let mut alphabet = Vec::<String>::new();
    let mut alphabet_set = HashSet::<String>::new();
    for (line, tokens) in &lines {
        if errors.full() {
            break;
        }
        match tokens.first().copied() {
            Some("type") => {
                if type_seen {
                    errors.push(
                        *line,
                        "The machine type is already declared. Keep one type line.",
                    );
                    continue;
                }
                type_seen = true;
                kind = match tokens.as_slice() {
                    ["type", "mealy"] => Some(MachineKind::Mealy),
                    ["type", "moore"] => Some(MachineKind::Moore),
                    _ => {
                        errors.push(*line, "Use \"type mealy\" or \"type moore\".");
                        None
                    }
                };
            }
            Some("start") => {
                if start_seen {
                    errors.push(
                        *line,
                        "The start state is already declared. Keep one start line.",
                    );
                    continue;
                }
                start_seen = true;
                start_line = *line;
                if let ["start", name] = tokens.as_slice() {
                    start = Some(*name);
                } else {
                    errors.push(*line, "Use \"start\" followed by one state name.");
                }
            }
            Some("alphabet") => {
                if alphabet_seen {
                    errors.push(
                        *line,
                        "The input alphabet is already declared. Keep one alphabet line.",
                    );
                    continue;
                }
                alphabet_seen = true;
                for symbol in tokens.iter().skip(1) {
                    if errors.full() {
                        break;
                    }
                    if !is_symbol(symbol) {
                        errors.push(*line,format!("Input \"{symbol}\" must be a nonempty Unicode token without whitespace or #."));
                    } else if !alphabet_set.insert((*symbol).into()) {
                        errors.push(*line,format!("Input \"{symbol}\" is already in the alphabet. Keep each symbol once."));
                    } else {
                        alphabet.push((*symbol).into());
                    }
                }
            }
            _ => {}
        }
    }
    if !type_seen {
        errors.push(
            1,
            "Declare the machine type with \"type mealy\" or \"type moore\".",
        );
    }
    if !start_seen {
        errors.push(1, "Declare a start state with \"start A\".");
    }
    let Some(kind) = kind else {
        return Ok(ParseResult {
            machine: None,
            errors: errors.finish(),
        });
    };
    let mut states = Vec::new();
    let mut state_lines = HashMap::new();
    let mut delta = TransitionMap::new();
    let mut mealy = TransitionMap::new();
    let mut moore = SymbolMap::new();
    let mut declared = HashSet::new();
    for (line, tokens) in &lines {
        if errors.full() {
            break;
        }
        if tokens.first() != Some(&"state") {
            continue;
        }
        let ["state", name] = tokens.as_slice() else {
            errors.push(*line, "Use \"state\" followed by one state name.");
            continue;
        };
        if !declared.insert(*name) {
            errors.push(
                *line,
                format!("State {name} is already declared. Keep one state line per state."),
            );
        } else {
            add_state(
                name,
                *line,
                &mut states,
                &mut state_lines,
                &mut delta,
                &mut mealy,
                &mut errors,
            );
        }
    }
    for (line, tokens) in &lines {
        if errors.full() {
            break;
        }
        match tokens.first().copied() {
            Some("type" | "start" | "state" | "alphabet") => continue,
            Some("out") => {
                if kind != MachineKind::Moore {
                    errors.push(
                        *line,
                        "Mealy outputs belong on transitions. Remove the out line.",
                    );
                    continue;
                }
                let ["out", name, output] = tokens.as_slice() else {
                    errors.push(*line, "A Moore output line has the form \"out A 0\".");
                    continue;
                };
                add_state(
                    name,
                    *line,
                    &mut states,
                    &mut state_lines,
                    &mut delta,
                    &mut mealy,
                    &mut errors,
                );
                if !is_symbol(output) {
                    errors.push(*line,format!("The output for state {name} must be a nonempty Unicode token without whitespace or #."));
                } else if moore.contains_key(*name) {
                    errors.push(
                        *line,
                        format!("State {name} already has an output. Keep one out line per state."),
                    );
                } else {
                    moore.insert((*name).into(), (*output).into());
                }
                continue;
            }
            _ => {}
        }
        let expected = if kind == MachineKind::Mealy { 4 } else { 3 };
        if tokens.len() != expected {
            errors.push(
                *line,
                if kind == MachineKind::Mealy {
                    "A Mealy transition needs four values: from, input, to, output."
                } else {
                    "A Moore transition needs three values: from, input, to."
                },
            );
            continue;
        }
        let (from, sym, to) = (tokens[0], tokens[1], tokens[2]);
        add_state(
            from,
            *line,
            &mut states,
            &mut state_lines,
            &mut delta,
            &mut mealy,
            &mut errors,
        );
        add_state(
            to,
            *line,
            &mut states,
            &mut state_lines,
            &mut delta,
            &mut mealy,
            &mut errors,
        );
        if !state_lines.contains_key(from) || !state_lines.contains_key(to) {
            continue;
        }
        if !is_symbol(sym) {
            errors.push(
                *line,
                format!(
                    "Input \"{sym}\" must be a nonempty Unicode token without whitespace or #."
                ),
            );
            continue;
        }
        if alphabet_seen && !alphabet_set.contains(sym) {
            errors.push(*line,format!("Input \"{sym}\" is not in the declared alphabet. Add it to the alphabet line first."));
            continue;
        }
        if !alphabet_seen && alphabet_set.insert(sym.into()) {
            alphabet.push(sym.into());
        }
        let row = delta.entry(from.into()).or_default();
        if row.contains_key(sym) {
            errors.push(
                *line,
                format!("State {from} already has a transition for \"{sym}\"."),
            );
            continue;
        }
        row.insert(sym.into(), to.into());
        if kind == MachineKind::Mealy {
            let output = tokens[3];
            if !is_symbol(output) {
                errors.push(
                    *line,
                    "A transition output must be a nonempty Unicode token without whitespace or #.",
                );
            } else {
                mealy
                    .entry(from.into())
                    .or_default()
                    .insert(sym.into(), output.into());
            }
        }
    }
    if let Some(name) = start
        && !state_lines.contains_key(name)
    {
        errors.push(
            start_line,
            format!("Start state {name} does not exist. Add its transitions first."),
        );
    }
    if alphabet.is_empty() {
        errors.push(
            1,
            "Declare at least one input symbol with \"alphabet a b\", or add a transition.",
        );
    }
    'states: for name in &states {
        let line = state_lines.get(name).copied().unwrap_or(1);
        for sym in &alphabet {
            if errors.full() {
                break 'states;
            }
            if !delta.get(name).is_some_and(|row| row.contains_key(sym)) {
                errors.push(line,format!("State {name} has no transition for \"{sym}\". Add one for every input symbol."));
            }
        }
        if kind == MachineKind::Moore && !moore.contains_key(name) {
            errors.push(
                line,
                format!(
                    "State {name} has no output. Add \"out {name} 0\" with the output you want."
                ),
            );
        }
    }
    let errors = errors.finish();
    if !errors.is_empty() || start.is_none() {
        return Ok(ParseResult {
            machine: None,
            errors,
        });
    }
    Ok(ParseResult {
        machine: Some(MachineDef {
            states,
            alphabet,
            start: start.unwrap_or_default().into(),
            delta,
            outputs: if kind == MachineKind::Mealy {
                Outputs::Mealy { lambda: mealy }
            } else {
                Outputs::Moore { lambda: moore }
            },
        }),
        errors,
    })
}
