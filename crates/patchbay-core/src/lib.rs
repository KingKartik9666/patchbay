#![forbid(unsafe_code)]

mod types;
pub use types::*;
mod limits;
pub use limits::{MAX_DIAGNOSTICS, MAX_INPUT_UTF16_UNITS, MAX_PROJECT_BYTES, MAX_RESPONSE_BYTES};
mod symbols;
pub use symbols::{
    check_input_symbols, is_lexical_whitespace, is_symbol, join_symbols, output_separator,
    tokenize_input, uses_token_input,
};
mod parse;
pub use parse::parse;
mod engine;
pub use engine::{convert, mealy_to_moore, moore_to_mealy, serialize, simulate, validate_machine};
mod graph;
pub use graph::{
    MAX_SAFE_ID, create_draft, draft_from_machine, draft_to_machine, draft_to_source, edit_graph,
    inspect_graph, parse_draft, serialize_draft, validate_draft, validate_structure,
};

/// One immutable, typed domain operation; desktop integration belongs to the caller.
pub fn execute(request: DomainRequest) -> Result<DomainResponse, DomainError> {
    limits::bound_serialized(&request, MAX_RESPONSE_BYTES, "Domain request")?;
    let result = match request {
        DomainRequest::Presets => DomainResponse::Presets(presets()?),
        DomainRequest::Parse {
            source,
            input,
            moore_initial,
        } => {
            limits::check_input(&input)?;
            let parsed = parse(&source)?;
            if let Some(machine) = parsed.machine {
                DomainResponse::Evaluation(evaluate(machine, source, &input, moore_initial)?)
            } else {
                DomainResponse::Evaluation(Evaluation {
                    machine: None,
                    source,
                    errors: parsed.errors,
                    trace: None,
                    input_symbols: Vec::new(),
                    input_issues: Vec::new(),
                    token_input: false,
                })
            }
        }
        DomainRequest::Simulate {
            machine,
            input,
            moore_initial,
        } => {
            limits::check_input(&input)?;
            validate_machine(&machine)?;
            let source = serialize(&machine)?;
            DomainResponse::Evaluation(evaluate(machine, source, &input, moore_initial)?)
        }
        DomainRequest::Convert {
            machine,
            target,
            input,
            moore_initial,
            initial_output,
        } => {
            limits::check_input(&input)?;
            let converted = convert(&machine, target, initial_output.as_deref())?;
            let source = serialize(&converted)?;
            DomainResponse::Evaluation(evaluate(converted, source, &input, moore_initial)?)
        }
        DomainRequest::InspectGraph { draft } => DomainResponse::Graph(inspect_graph(draft)?),
        DomainRequest::EditGraph { draft, edit } => {
            DomainResponse::Graph(inspect_graph(edit_graph(&draft, &edit)?)?)
        }
        DomainRequest::FromMachine { machine, positions } => DomainResponse::Graph(inspect_graph(
            draft_from_machine(&machine, positions.as_ref())?,
        )?),
        DomainRequest::OpenProject { source } => {
            DomainResponse::Graph(inspect_graph(parse_draft(&source)?)?)
        }
        DomainRequest::ExportGraph { draft } => DomainResponse::Text(serialize_draft(&draft)?),
    };
    limits::bound_serialized(&result, MAX_RESPONSE_BYTES, "Domain response")?;
    Ok(result)
}

fn evaluate(
    machine: MachineDef,
    source: String,
    input: &str,
    moore_initial: bool,
) -> Result<Evaluation, DomainError> {
    let input_symbols = tokenize_input(&machine, input)?;
    let input_issues = symbols::check_symbols(&machine, &input_symbols);
    let token_input = uses_token_input(&machine);
    limits::bound_serialized(&machine, MAX_RESPONSE_BYTES, "Machine")?;
    let trace = engine::simulate_symbols(&machine, &input_symbols, moore_initial)?;
    Ok(Evaluation {
        machine: Some(machine),
        source,
        errors: Vec::new(),
        trace: Some(trace),
        input_symbols,
        input_issues,
        token_input,
    })
}

/// Immutable built-in teaching examples, independent of frontend source files.
pub fn presets() -> Result<Vec<Preset>, DomainError> {
    serde_json::from_str(include_str!("presets.json"))
        .map_err(|_| DomainError::new(ErrorCode::Internal, "The bundled preset data is invalid."))
}
