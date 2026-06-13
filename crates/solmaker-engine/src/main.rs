//! `solmaker-engine` binary entrypoint. Two subcommands exist:
//!
//!   solmaker-engine status [--json] [--created-at <iso-8601-utc>]
//!   solmaker-engine realtime-normalize [--json] [--created-at <iso-8601-utc>]
//!
//! `realtime-normalize` reads ONE replay events JSON document from BOUNDED
//! stdin (refused beyond 2 MiB) and emits normalized candidate observations.
//! Exit codes follow the IPC contract (src/ipc.rs): 0 = report produced,
//! 2 = invocation refused. Diagnostics go to stderr; stdout carries only the
//! report.

use std::io::Read;
use std::process::ExitCode;

use solmaker_engine::realtime;
use solmaker_engine::status;

const USAGE: &str =
    "usage: solmaker-engine <status|realtime-normalize> [--json] [--created-at <iso-8601-utc>]";

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
        return Err("stdin is empty — pipe a replay events JSON document".to_string());
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

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("status") => run_status(&args[1..]),
        Some("realtime-normalize") => run_realtime_normalize(&args[1..]),
        Some(other) => refuse(&format!("unknown command {other:?}")),
        None => refuse("a command is required"),
    }
}
