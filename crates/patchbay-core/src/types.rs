use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type SymbolMap = BTreeMap<String, String>;
pub type TransitionMap = BTreeMap<String, SymbolMap>;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MachineKind {
    Mealy,
    Moore,
}

impl std::fmt::Display for MachineKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Mealy => "mealy",
            Self::Moore => "moore",
        })
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Outputs {
    Mealy { lambda: TransitionMap },
    Moore { lambda: SymbolMap },
}
impl Outputs {
    pub fn kind(&self) -> MachineKind {
        match self {
            Self::Mealy { .. } => MachineKind::Mealy,
            Self::Moore { .. } => MachineKind::Moore,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MachineDef {
    pub states: Vec<String>,
    pub alphabet: Vec<String>,
    pub start: String,
    pub delta: TransitionMap,
    pub outputs: Outputs,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Step {
    pub i: usize,
    pub from: String,
    pub sym: String,
    pub to: String,
    pub out: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Fault {
    pub at: usize,
    pub state: String,
    pub sym: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Trace {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub initial_out: Option<String>,
    pub steps: Vec<Step>,
    pub output: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub fault: Option<Fault>,
    pub output_separator: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ParseError {
    pub line: usize,
    pub msg: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ParseResult {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub machine: Option<MachineDef>,
    pub errors: Vec<ParseError>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InputIssue {
    pub index: usize,
    pub sym: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evaluation {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub machine: Option<MachineDef>,
    pub source: String,
    pub errors: Vec<ParseError>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub trace: Option<Trace>,
    pub input_symbols: Vec<String>,
    pub input_issues: Vec<InputIssue>,
    pub token_input: bool,
}

fn serialize_coordinate<S: serde::Serializer>(
    value: &f64,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    if value.is_finite()
        && *value >= 0.0
        && value.fract() == 0.0
        && *value <= 9_007_199_254_740_991.0
    {
        serializer.serialize_u64(*value as u64)
    } else {
        serializer.serialize_f64(*value)
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphState {
    pub id: String,
    pub name: String,
    pub output: String,
    #[serde(serialize_with = "serialize_coordinate")]
    pub x: f64,
    #[serde(serialize_with = "serialize_coordinate")]
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphTransition {
    pub id: String,
    pub from: String,
    pub to: String,
    pub input: String,
    pub output: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphDraft {
    pub kind: MachineKind,
    pub start: String,
    pub next_id: u64,
    pub alphabet: Vec<String>,
    pub states: Vec<GraphState>,
    pub transitions: Vec<GraphTransition>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GraphResult {
    pub draft: GraphDraft,
    pub source: String,
    pub errors: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub machine: Option<MachineDef>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum PresetCategory {
    Binary,
    #[serde(rename = "Multi-variable")]
    MultiVariable,
    Events,
    Decimal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub kind: MachineKind,
    pub category: PresetCategory,
    pub description: String,
    pub input: String,
    pub source: String,
    pub expected: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum GraphEdit {
    AddState {
        x: f64,
        y: f64,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        name: Option<String>,
    },
    UpdateState {
        id: String,
        name: String,
        output: String,
        start: bool,
    },
    MoveState {
        id: String,
        x: f64,
        y: f64,
    },
    RemoveState {
        id: String,
    },
    UpsertTransition {
        #[serde(skip_serializing_if = "Option::is_none", default)]
        id: Option<String>,
        from: String,
        to: String,
        input: String,
        output: String,
    },
    RemoveTransition {
        id: String,
    },
    SetAlphabet {
        symbols: Vec<String>,
    },
    SetAlphabetText {
        text: String,
    },
    SetKind {
        kind: MachineKind,
    },
    SetStart {
        id: String,
    },
    FillMissing {
        output: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DomainRequest {
    Presets,
    Parse {
        source: String,
        input: String,
        moore_initial: bool,
    },
    Simulate {
        machine: MachineDef,
        input: String,
        moore_initial: bool,
    },
    Convert {
        machine: MachineDef,
        target: MachineKind,
        input: String,
        moore_initial: bool,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        initial_output: Option<String>,
    },
    InspectGraph {
        draft: GraphDraft,
    },
    EditGraph {
        draft: GraphDraft,
        edit: GraphEdit,
    },
    FromMachine {
        machine: MachineDef,
        #[serde(skip_serializing_if = "Option::is_none", default)]
        positions: Option<BTreeMap<String, Position>>,
    },
    OpenProject {
        source: String,
    },
    ExportGraph {
        draft: GraphDraft,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "type",
    content = "value",
    rename_all = "lowercase",
    deny_unknown_fields
)]
pub enum DomainResponse {
    Presets(Vec<Preset>),
    Evaluation(Evaluation),
    Graph(GraphResult),
    Text(String),
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorCode {
    Validation,
    Limit,
    Format,
    Io,
    Internal,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DomainError {
    pub code: ErrorCode,
    pub message: String,
    pub details: Vec<String>,
}

impl std::fmt::Display for DomainError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for DomainError {}

impl DomainError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: crate::limits::clipped(&message.into()),
            details: Vec::new(),
        }
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }
    pub fn limit(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Limit, message)
    }
    pub fn format(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Format, message)
    }
}
