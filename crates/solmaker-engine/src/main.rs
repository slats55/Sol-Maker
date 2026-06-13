//! `solmaker-engine` binary entrypoint. Subcommands:
//!
//!   solmaker-engine status [--json] [--created-at <iso-8601-utc>]
//!   solmaker-engine realtime-normalize [--json] [--created-at <iso-8601-utc>]
//!   solmaker-engine quote-score [--json] --scored-at <iso-8601-utc> --max-quote-age-ms <n>
//!   solmaker-engine tx-inspect [--json] [--created-at <iso-8601-utc>]
//!   solmaker-engine sim-classify [--json] [--created-at <iso-8601-utc>]
//!
//! `realtime-normalize` reads ONE replay events JSON document from BOUNDED
//! stdin (refused beyond 2 MiB) and emits normalized candidate observations.
//! `quote-score` reads ONE routequote.fetch.report.v1 document from the same
//! bounded stdin and emits route-quality intelligence (both arguments are
//! REQUIRED — there is no default age cap and no clock in this binary).
//! `tx-inspect` reads ONE strictly-UNSIGNED txpreview.envelope.v1 and emits its
//! decoded SHAPE facts (a signed transaction is refused). `sim-classify` reads
//! ONE simulation result and emits the S95 closed classification. Exit codes
//! follow the IPC contract (src/ipc.rs): 0 = report produced, 2 = invocation
//! refused. Diagnostics go to stderr; stdout carries only the report.

use std::io::Read;
use std::process::ExitCode;

use solmaker_engine::quote_score;
use solmaker_engine::realtime;
use solmaker_engine::sim_classify;
use solmaker_engine::status;
use solmaker_engine::tx_inspect;

const USAGE: &str = "usage: solmaker-engine <status|realtime-normalize|tx-inspect|sim-classify> [--json] [--created-at <iso-8601-utc>] | solmaker-engine quote-score [--json] --scored-at <iso-8601-utc> --max-quote-age-ms <n>";

/// Hard ceiling on stdin input for realtime-normalize (a 500-event replay
/// document is well under this; anything larger is a mistake, not a feed).
const MAX_STDIN_BYTES: u64 = 2 * 1024 * 1024;

fn refuse(message: &str) -> ExitCode {
    eprintln!("refused: {message}");
    eprintln!("{USAGE}");
    ExitCode::from(2)
}

struct CommonArgs {
    json: bool,
    created_at: Option<String>,
}

fn parse_common_args(args: &[String]) -> Result<CommonArgs, String> {
    let mut json = false;
    let mut created_at: Option<String> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--created-at" => match iter.next() {
                Some(value) if created_at.is_none() => created_at = Some(value.clone()),
                Some(_) => return Err("--created-at was given twice".to_string()),
                None => return Err("--created-at requires a value".to_string()),
            },
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    Ok(CommonArgs { json, created_at })
}

fn run_status(args: &[String]) -> ExitCode {
    let common = match parse_common_args(args) {
        Ok(common) => common,
        Err(message) => return refuse(&message),
    };
    match status::build_status_report(common.created_at.as_deref()) {
        Ok(report) => {
            if common.json {
                print!("{}", status::to_ipc_json(&report));
            } else {
                print!("{}", status::to_text(&report));
            }
            ExitCode::SUCCESS
        }
        Err(err) => refuse(&err.to_string()),
    }
}

/// Read stdin to completion, refusing anything beyond the byte ceiling.
fn read_bounded_stdin() -> Result<String, String> {
    let mut input = String::new();
    let mut handle = std::io::stdin().lock().take(MAX_STDIN_BYTES + 1);
    handle
        .read_to_string(&mut input)
        .map_err(|_| "stdin is not valid UTF-8".to_string())?;
    if input.len() as u64 > MAX_STDIN_BYTES {
        return Err(format!("stdin exceeds the {MAX_STDIN_BYTES}-byte ceiling"));
    }
    if input.trim().is_empty() {
        return Err("stdin is empty — pipe the command's JSON input document".to_string());
    }
    Ok(input)
}

fn run_realtime_normalize(args: &[String]) -> ExitCode {
    let common = match parse_common_args(args) {
        Ok(common) => common,
        Err(message) => return refuse(&message),
    };
    let input = match read_bounded_stdin() {
        Ok(input) => input,
        Err(message) => return refuse(&message),
    };
    match realtime::normalize_replay_events(&input, common.created_at.as_deref()) {
        Ok(report) => {
            if common.json {
                print!("{}", realtime::to_ipc_json(&report));
            } else {
                print!("{}", realtime::to_text(&report));
            }
            ExitCode::SUCCESS
        }
        Err(err) => refuse(&err.to_string()),
    }
}

fn run_quote_score(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut scored_at: Option<String> = None;
    let mut max_age: Option<u64> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--scored-at" => match iter.next() {
                Some(value) if scored_at.is_none() => scored_at = Some(value.clone()),
                Some(_) => return refuse("--scored-at was given twice"),
                None => return refuse("--scored-at requires a value"),
            },
            "--max-quote-age-ms" => match iter.next() {
                Some(value) if max_age.is_none() => match value.parse::<u64>() {
                    Ok(parsed) if parsed > 0 => max_age = Some(parsed),
                    _ => return refuse("--max-quote-age-ms must be a positive integer"),
                },
                Some(_) => return refuse("--max-quote-age-ms was given twice"),
                None => return refuse("--max-quote-age-ms requires a value"),
            },
            other => return refuse(&format!("unknown argument {other:?}")),
        }
    }
    let Some(scored_at) = scored_at else {
        return refuse("--scored-at is required (the orchestrator supplies the scoring instant)");
    };
    let Some(max_age) = max_age else {
        return refuse("--max-quote-age-ms is required (no default cap exists by design)");
    };
    let input = match read_bounded_stdin() {
        Ok(input) => input,
        Err(message) => return refuse(&message),
    };
    match quote_score::score_fetch_report(&input, &scored_at, max_age) {
        Ok(report) => {
            if json {
                print!("{}", quote_score::to_ipc_json(&report));
            } else {
                print!("{}", quote_score::to_text(&report));
            }
            ExitCode::SUCCESS
        }
        Err(err) => refuse(&err.to_string()),
    }
}

fn run_tx_inspect(args: &[String]) -> ExitCode {
    let common = match parse_common_args(args) {
        Ok(common) => common,
        Err(message) => return refuse(&message),
    };
    let input = match read_bounded_stdin() {
        Ok(input) => input,
        Err(message) => return refuse(&message),
    };
    match tx_inspect::inspect_envelope(&input, common.created_at.as_deref()) {
        Ok(report) => {
            if common.json {
                print!("{}", tx_inspect::to_ipc_json(&report));
            } else {
                print!("{}", tx_inspect::to_text(&report));
            }
            ExitCode::SUCCESS
        }
        Err(err) => refuse(&err.to_string()),
    }
}

fn run_sim_classify(args: &[String]) -> ExitCode {
    let common = match parse_common_args(args) {
        Ok(common) => common,
        Err(message) => return refuse(&message),
    };
    let input = match read_bounded_stdin() {
        Ok(input) => input,
        Err(message) => return refuse(&message),
    };
    match sim_classify::classify_document(&input, common.created_at.as_deref()) {
        Ok(report) => {
            if common.json {
                print!("{}", sim_classify::to_ipc_json(&report));
            } else {
                print!("{}", sim_classify::to_text(&report));
            }
            ExitCode::SUCCESS
        }
        Err(err) => refuse(&err.to_string()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("status") => run_status(&args[1..]),
        Some("realtime-normalize") => run_realtime_normalize(&args[1..]),
        Some("quote-score") => run_quote_score(&args[1..]),
        Some("tx-inspect") => run_tx_inspect(&args[1..]),
        Some("sim-classify") => run_sim_classify(&args[1..]),
        Some(other) => refuse(&format!("unknown command {other:?}")),
        None => refuse("a command is required"),
    }
}
