//! Pure Rust timings using the captured TypeScript workload, with no desktop IPC.
use patchbay_core::{DomainError, MachineDef, mealy_to_moore, parse, simulate};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    error::Error,
    hint::black_box,
    path::PathBuf,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize)]
struct Fixture {
    source: String,
    input: String,
}

fn measure<T>(mut operation: impl FnMut() -> Result<T, DomainError>) -> Result<Value, DomainError> {
    for _ in 0..50 {
        black_box(operation()?);
    }
    let mut times = Vec::with_capacity(500);
    for _ in 0..500 {
        let start = Instant::now();
        black_box(operation()?);
        times.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    times.sort_by(f64::total_cmp);
    Ok(json!({"samples":500,"p50Ms":times[250],"p95Ms":times[475]}))
}

fn main() -> Result<(), Box<dyn Error>> {
    let mut arguments = std::env::args_os().skip(1);
    let fixture_path = arguments.next().map(PathBuf::from).unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/benchmark-input.json")
    });
    let report_path = arguments.next().map(PathBuf::from);
    let fixture: Fixture = serde_json::from_str(&std::fs::read_to_string(&fixture_path)?)?;
    let parsed = parse(&fixture.source)?;
    let machine: MachineDef = parsed
        .machine
        .ok_or_else(|| DomainError::validation("Benchmark fixture is not a complete machine."))?;
    let transitions = machine.delta.values().map(|row| row.len()).sum::<usize>();
    let report = json!({
        "version":env!("CARGO_PKG_VERSION"),
        "implementation":"patchbay-core pure Rust domain functions",
        "scope":"No IPC, worker scheduling, React rendering, WebView2, or native file I/O is timed. Functions include their domain byte-budget checks. Return-value destruction occurs inside each sample.",
        "buildProfile":if cfg!(debug_assertions){"debug"}else{"release"},
        "toolchain":"1.99.0-x86_64-pc-windows-msvc",
        "platform":std::env::consts::OS,
        "arch":std::env::consts::ARCH,
        "conditions":{"states":machine.states.len(),"transitions":transitions,"inputCodeUnits":fixture.input.encode_utf16().count(),"warmups":50},
        "parse":measure(||parse(black_box(&fixture.source)))?,
        "simulate":measure(||simulate(black_box(&machine),black_box(&fixture.input),true))?,
        "convert":measure(||mealy_to_moore(black_box(&machine),"0"))?,
        "capturedAtUnixSeconds":SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs(),
    });
    let output = serde_json::to_string_pretty(&report)? + "\n";
    if let Some(path) = report_path {
        std::fs::write(path, &output)?;
    }
    print!("{output}");
    Ok(())
}
