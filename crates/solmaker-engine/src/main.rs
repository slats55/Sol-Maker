//! `solmaker-engine` binary entrypoint. One subcommand exists: `status`.
//!
//! Usage:
//!   solmaker-engine status [--json] [--created-at <iso-8601-utc>]
//!
//! Exit codes follow the IPC contract (src/ipc.rs): 0 = report produced,
//! 2 = invocation refused. Diagnostics go to stderr; stdout carries only the
//! report.

use std::process::ExitCode;

use solmaker_engine::status::{build_status_report, to_ipc_json, to_text};

const USAGE: &str = "usage: solmaker-engine status [--json] [--created-at <iso-8601-utc>]";

fn refuse(message: &str) -> ExitCode {
    eprintln!("refused: {message}");
    eprintln!("{USAGE}");
    ExitCode::from(2)
}

fn run_status(args: &[String]) -> ExitCode {
    let mut json = false;
    let mut created_at: Option<String> = None;
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--json" => json = true,
            "--created-at" => match iter.next() {
                Some(value) if created_at.is_none() => created_at = Some(value.clone()),
                Some(_) => return refuse("--created-at was given twice"),
                None => return refuse("--created-at requires a value"),
            },
            other => return refuse(&format!("unknown argument {other:?}")),
        }
    }
    match build_status_report(created_at.as_deref()) {
        Ok(report) => {
            if json {
                print!("{}", to_ipc_json(&report));
            } else {
                print!("{}", to_text(&report));
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
        Some(other) => refuse(&format!("unknown command {other:?}")),
        None => refuse("a command is required"),
    }
}
