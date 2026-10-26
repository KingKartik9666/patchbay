use crate::limits::check_input;
use crate::{DomainError, InputIssue, MachineDef, Outputs};
use std::collections::HashSet;

/// Union of ECMAScript \s and Unicode White_Space used by the legacy DSL.
pub fn is_lexical_whitespace(ch: char) -> bool {
    ch.is_whitespace() || ch == '\u{feff}'
}
pub fn is_symbol(value: &str) -> bool {
    !value.is_empty()
        && !value
            .chars()
            .any(|ch| is_lexical_whitespace(ch) || ch == '#')
}
pub(crate) fn is_reserved(name: &str) -> bool {
    matches!(name, "type" | "start" | "out" | "state" | "alphabet")
}
pub fn uses_token_input(machine: &MachineDef) -> bool {
    machine
        .alphabet
        .iter()
        .any(|value| value.chars().take(2).count() > 1)
}
pub fn tokenize_input(machine: &MachineDef, input: &str) -> Result<Vec<String>, DomainError> {
    check_input(input)?;
    Ok(if uses_token_input(machine) {
        input
            .split(is_lexical_whitespace)
            .filter(|part| !part.is_empty())
            .map(str::to_owned)
            .collect()
    } else {
        input.chars().map(|ch| ch.to_string()).collect()
    })
}
pub fn check_input_symbols(
    machine: &MachineDef,
    input: &str,
) -> Result<Vec<InputIssue>, DomainError> {
    Ok(check_symbols(machine, &tokenize_input(machine, input)?))
}
pub(crate) fn check_symbols(machine: &MachineDef, symbols: &[String]) -> Vec<InputIssue> {
    let alphabet = machine
        .alphabet
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    symbols
        .iter()
        .enumerate()
        .filter(|(_, sym)| !alphabet.contains(sym.as_str()))
        .map(|(index, sym)| InputIssue {
            index,
            sym: sym.clone(),
        })
        .collect()
}

/// Only Moore destination outputs influence step spacing; Initial may be omitted.
pub fn output_separator(machine: &MachineDef, symbols: &[String]) -> &'static str {
    output_separator_for(machine, symbols)
}
pub(crate) fn output_separator_for<T: AsRef<str>>(
    machine: &MachineDef,
    symbols: &[T],
) -> &'static str {
    let multi = |value: &str| value.chars().take(2).count() > 1;
    let alphabet = machine
        .alphabet
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let word_output = match &machine.outputs {
        Outputs::Mealy { lambda } => machine.states.iter().any(|state| {
            lambda.get(state).is_some_and(|row| {
                row.iter()
                    .any(|(input, out)| alphabet.contains(input.as_str()) && multi(out))
            })
        }),
        Outputs::Moore { lambda } => machine.states.iter().any(|state| {
            machine.delta.get(state).is_some_and(|row| {
                row.iter().any(|(input, to)| {
                    alphabet.contains(input.as_str())
                        && lambda.get(to).is_some_and(|out| multi(out))
                })
            })
        }),
    };
    if word_output || symbols.iter().any(|out| multi(out.as_ref())) {
        " "
    } else {
        ""
    }
}
pub fn join_symbols(machine: &MachineDef, symbols: &[String]) -> Result<String, DomainError> {
    let separator = output_separator(machine, symbols);
    join_with_separator(symbols, separator)
}
pub(crate) fn join_with_separator<T: AsRef<str>>(
    symbols: &[T],
    separator: &str,
) -> Result<String, DomainError> {
    let size = symbols
        .iter()
        .try_fold(0_usize, |size, out| {
            size.checked_add(out.as_ref().len() + separator.len())
        })
        .ok_or_else(|| DomainError::limit("Output tape exceeds its byte budget."))?;
    if size > crate::MAX_RESPONSE_BYTES {
        return Err(DomainError::limit("Output tape exceeds its byte budget."));
    }
    let mut output = String::with_capacity(size);
    for (index, symbol) in symbols.iter().enumerate() {
        if index > 0 {
            output.push_str(separator);
        }
        output.push_str(symbol.as_ref());
    }
    Ok(output)
}
