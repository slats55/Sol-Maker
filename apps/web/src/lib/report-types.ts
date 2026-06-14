/**
 * Frontend-only catalogue of the report artifact schemas Soulmaker's backtest
 * research tooling emits, plus the *expected* envelope shape a viewer would
 * read later.
 *
 * IMPORTANT: this is documentation + types only. It deliberately does NOT import
 * any backend package and is NOT wired to a file loader or parser. It exists so
 * the report-viewer foundation is typed and so the UI can label known vs.
 * unknown schema ids without ever touching backend code that another sprint may
 * be actively changing.
 */

export type SchemaStability = "stable" | "emerging";

export type SchemaFamily =
  | "report"
  | "suite"
  | "sensitivity"
  | "coverage"
  | "plan"
  | "research"
  | "sniper"
  | "simulation"
  | "phase6"
  | "routequote"
  | "realtime"
  | "txpreview"
  | "execution"
  | "engine";

export interface ReportSchemaInfo {
  readonly id: string;
  readonly title: string;
  readonly family: SchemaFamily;
  readonly stability: SchemaStability;
  readonly description: string;
  /** The CLI command that emits this artifact (or a note for emerging ones). */
  readonly cli: string;
}

/**
 * Known schema ids. `stable` entries correspond to shipped CLI commands. The
 * `emerging` tier is kept for forward-compatibility (a recognized schema whose
 * backend work has not yet landed on master), but no catalogued schema is
 * emerging today — the cross-scenario matrix and research-run families have all
 * shipped. CLI command names below are verified against the commands registered
 * in `apps/cli` on master; they are display labels only (this module imports no
 * backend code and runs nothing).
 */
export const KNOWN_REPORT_SCHEMAS: readonly ReportSchemaInfo[] = [
  {
    id: "backtest.report.v1",
    title: "Backtest report",
    family: "report",
    stability: "stable",
    description:
      "A single deterministic, simulated paper backtest over one injected scenario.",
    cli: "paper:backtest",
  },
  {
    id: "backtest.suite.v1",
    title: "Backtest suite index",
    family: "suite",
    stability: "stable",
    description:
      "Aggregated index over a directory of injected scenarios (counts + summed simulated totals).",
    cli: "paper:backtest:suite",
  },
  {
    id: "backtest.suite.diff.v1",
    title: "Suite diff",
    family: "suite",
    stability: "stable",
    description: "Conservative delta between two suite indexes.",
    cli: "paper:backtest:diff:suite",
  },
  {
    id: "backtest.sensitivity.v1",
    title: "Sensitivity report",
    family: "sensitivity",
    stability: "stable",
    description:
      "Per-variant deltas vs a baseline over bounded numeric perturbations, with rankings by movement magnitude.",
    cli: "paper:backtest:sensitivity",
  },
  {
    id: "backtest.sensitivity.diff.v1",
    title: "Sensitivity diff",
    family: "sensitivity",
    stability: "stable",
    description: "Conservative delta between two sensitivity reports (paired by suffix).",
    cli: "paper:backtest:diff:sensitivity",
  },
  {
    id: "backtest.coverage.v1",
    title: "Suite coverage",
    family: "coverage",
    stability: "stable",
    description:
      "Which simulated paper behaviours a suite exercised — behavioural bookkeeping, not market or test coverage.",
    cli: "paper:backtest:suite:coverage",
  },
  {
    id: "backtest.variant-plan.explain.v1",
    title: "Variant-plan explain",
    family: "plan",
    stability: "stable",
    description: "Dry-run explanation of what a variant plan would change, without generating files.",
    cli: "paper:backtest:scenario:variants:explain",
  },
  {
    id: "backtest.sensitivity.matrix.v1",
    title: "Sensitivity matrix",
    family: "sensitivity",
    stability: "stable",
    description:
      "Cross-scenario sensitivity matrix: base scenarios × variants, with per-cell deltas and per-variant aggregates.",
    cli: "paper:backtest:sensitivity:matrix",
  },
  {
    id: "backtest.sensitivity.matrix.diff.v1",
    title: "Sensitivity matrix diff",
    family: "sensitivity",
    stability: "stable",
    description:
      "Conservative delta between two sensitivity matrices (bases paired by id, cells by suffix).",
    cli: "paper:backtest:diff:sensitivity:matrix",
  },
  {
    id: "backtest.research.manifest.v1",
    title: "Research run manifest",
    family: "research",
    stability: "stable",
    description:
      "Manifest of a paper research run's generated artifacts + digests.",
    cli: "paper:backtest:research:manifest",
  },
  {
    id: "backtest.research.verify.v1",
    title: "Research run verify",
    family: "research",
    stability: "stable",
    description:
      "Result of re-verifying a research manifest against its artifacts on disk.",
    cli: "paper:backtest:research:verify",
  },
  {
    id: "backtest.research.manifest.diff.v1",
    title: "Research manifest diff",
    family: "research",
    stability: "stable",
    description: "Conservative delta between two research run manifests.",
    cli: "paper:backtest:diff:research:manifest",
  },
  {
    id: "backtest.research.bundle.v1",
    title: "Research run bundle",
    family: "research",
    stability: "stable",
    description:
      "Bundle summary of a paper research run: run digest, artifact/kind/schema counts, and a manifest summary.",
    cli: "paper:backtest:research:bundle",
  },
  {
    id: "backtest.research.status.v1",
    title: "Research run status",
    family: "research",
    stability: "stable",
    description:
      "Integrity/status check of a paper research run: completeness, recognition, and manifest sync.",
    cli: "paper:backtest:research:status",
  },
  {
    id: "backtest.research.campaign.index.v1",
    title: "Research campaign index",
    family: "research",
    stability: "stable",
    description:
      "Campaign-level summary across many paper research runs: per-run digests, drift, and aggregate kind/schema counts.",
    cli: "paper:backtest:research:index",
  },
  {
    id: "backtest.research.bundle.diff.v1",
    title: "Research bundle diff",
    family: "research",
    stability: "stable",
    description:
      "Conservative delta between two research run bundles: run-digest change, artifact add/remove/digest-change, count/schema-set deltas, and a conservative regression flag.",
    cli: "paper:backtest:diff:research:bundle",
  },
  {
    id: "backtest.research.campaign.diff.v1",
    title: "Research campaign diff",
    family: "research",
    stability: "stable",
    description:
      "Conservative delta between two research campaign indexes: campaign-digest change, runs added/removed/changed, attention transitions, aggregate count/schema deltas, and a conservative regression flag.",
    cli: "paper:backtest:diff:research:index",
  },

  // --- Sniper PAPER pipeline (S25–S87; verified against origin/master) -------
  // These are integrity/safety artifacts from the paper-only sniper pipeline.
  // None of them is an order, a transaction, or live-trading readiness.
  {
    id: "sniper.paper.decision.report.v2",
    title: "Sniper paper decision report v2",
    family: "sniper",
    stability: "stable",
    description:
      "Paper-only sniper decisions per candidate (skip/watch/paper-enter/paper-reject/unknown) with machine-readable reason codes and policy visibility. A paper-enter is a SIMULATED classification, never an order.",
    cli: "paper:sniper:decide",
  },
  {
    id: "sniper.run.report.v2",
    title: "Sniper run report v2",
    family: "sniper",
    stability: "stable",
    description:
      "Operator run summary bundling already-built local artifacts verbatim: decisions, preflight statuses, reason-code rollups, policy visibility, and operator-blocking reasons. Built with --schema-version v2.",
    cli: "paper:sniper:report",
  },
  {
    id: "sniper.run.report.diff.v2",
    title: "Sniper run report diff v2",
    family: "sniper",
    stability: "stable",
    description:
      "Structured comparison of two v2 run reports: decision/preflight transitions, operator-blocking reasons added/removed, and reason-code count deltas. Built with --schema-version v2.",
    cli: "paper:sniper:diff:report",
  },

  // --- Phase 6 simulation chain (S61–S87; verified against origin/master) ----
  // Read-only, dry-run-only artifacts. The route resolver and the real dry-run
  // engine do NOT exist; unavailable/unresolved states are the honest record.
  {
    id: "simulation.intent.plan.v2",
    title: "Simulation intent plan v2",
    family: "simulation",
    stability: "stable",
    description:
      "Fail-closed SIMULATION PREVIEW over the strictly-validated v2 chain. Destination/amount/fee previews stay UNRESOLVED (never invented); anything missing or not ready produces a BLOCKED plan.",
    cli: "paper:simulation:intent:plan",
  },
  {
    id: "simulation.result.v1",
    title: "Simulation result v1",
    family: "simulation",
    stability: "stable",
    description:
      "The honest record of one simulation pass over a validated plan: unresolved entries are SKIPPED and the dry-run reports UNAVAILABLE (no real dry-run engine exists — nothing is faked).",
    cli: "paper:simulation:result",
  },
  {
    id: "simulation.route.resolution.v1",
    title: "Simulation route resolution v1",
    family: "simulation",
    stability: "stable",
    description:
      "Per-entry route/destination/fee PROVENANCE over a validated plan. Honestly UNAVAILABLE without quote observations; with a prepared routequote (S91) observed quotes enter as label facts with provenance and the mandatory live-state caveat — still never executable.",
    cli: "paper:simulation:route",
  },
  {
    id: "routequote.observation.input.v1",
    title: "Route quote observation",
    family: "routequote",
    stability: "stable",
    description:
      "One operator-supplied READ-ONLY quote observation for one candidate mint. CLOSED outcome set (quote-observed | unavailable | blocked | error | unsupported — nothing can mean executable); label-only facts; observed-at is an operator LABEL, never system time.",
    cli: "paper:routequote:prepare",
  },
  {
    id: "routequote.prepared.v1",
    title: "Route quote prepared input",
    family: "routequote",
    stability: "stable",
    description:
      "Quote observations paired to candidates BY MINT with deterministic label-only route facts and the mandatory caveat set. The bridge paper:sniper:dry-run consumes via --routequote — observation provenance only, never executable, never an order.",
    cli: "paper:routequote:prepare",
  },
  {
    id: "simulation.intent.plan.diff.v2",
    title: "Simulation plan diff v2",
    family: "simulation",
    stability: "stable",
    description:
      "Structured-field-only comparison of two simulation intent plans: blocked transitions, reason-code movements, source-ref changes, and per-entry preview changes.",
    cli: "paper:simulation:diff:plan",
  },
  {
    id: "simulation.result.diff.v1",
    title: "Simulation result diff v1",
    family: "simulation",
    stability: "stable",
    description:
      "Structured-field-only comparison of two simulation results: status/blocked transitions, code movements, adapter changes, and per-entry outcome changes.",
    cli: "paper:simulation:diff:result",
  },
  {
    id: "phase6.audit.report.v1",
    title: "Phase 6 chain audit",
    family: "phase6",
    stability: "stable",
    description:
      "Chain audit over the ten Phase 6 artifacts (incl. the S87 route-resolution role): each strictly validated in place, structured cross-references checked, chain conditions surfaced verbatim. Reports — never authorizes.",
    cli: "paper:simulation:audit",
  },
  {
    id: "phase6.simulation.readiness.report.v1",
    title: "Phase 6 simulation readiness",
    family: "phase6",
    stability: "stable",
    description:
      "Structural 'is the Phase 6 simulation stack green?' verdict: machine-verified artifact checks plus eleven verbatim evidence declarations (incl. route-resolution-tests). phase7LiveTradingReady is a literal false, always.",
    cli: "paper:simulation:readiness",
  },
  {
    id: "phase6.simulation.handoff.pack.v1",
    title: "Phase 6 handoff pack",
    family: "phase6",
    stability: "stable",
    description:
      "Session handoff over the twelve Phase 6 chain artifacts (incl. the S87 route-resolution role), each strictly validated and summarized from verbatim structured fields; missing artifacts classified, never invented.",
    cli: "paper:simulation:handoff",
  },
  {
    id: "phase6.operator.bundle.v1",
    title: "Phase 6 operator bundle",
    family: "phase6",
    stability: "stable",
    description:
      "Archiveable operator bundle over the THIRTEEN Phase 6 chain roles (the twelve handoff roles plus the handoff pack itself): per-role state + file integrity refs, a blocking trail recomputed and cross-checked against the pack, and a closed-set operator verdict never better than reviewable-paper-only.",
    cli: "paper:simulation:bundle",
  },

  // --- Real-time / execution lane (S92–S93; verified against the registered CLI) ----
  // Read-only feeds, unsigned-transaction material, and GATED execution evidence. Nothing in
  // this family is live readiness; mainnet sending has no CLI surface at all.
  {
    id: "realtime.candidates.snapshot.v1",
    title: "Realtime candidates snapshot",
    family: "realtime",
    stability: "stable",
    description:
      "One bounded poll of a public new-token feed (or a local replay file), normalized into the candidate-list contract. Watch-only observation with provider-reported HINTS; sourceKind is live or replay, labeled verbatim.",
    cli: "paper:realtime:snapshot",
  },
  {
    id: "routequote.fetch.report.v1",
    title: "Route quote fetch report",
    family: "routequote",
    stability: "stable",
    description:
      "One live read-only quote fetch per candidate with honest freshness provenance (real fetchedAt timestamp, provider id, HTTP status, context slot, price impact). Provider failures map onto the closed status set — never upgraded, never faked.",
    cli: "paper:routequote:fetch",
  },
  {
    id: "txpreview.envelope.v1",
    title: "Unsigned transaction envelope",
    family: "txpreview",
    stability: "stable",
    description:
      "A strictly-validated UNSIGNED transaction (every signature slot zero — a signed transaction is refused). Since S93 it carries quotedAt freshness provenance. Simulation material, never an order.",
    cli: "execution:build",
  },
  {
    id: "txpreview.simulation.report.v1",
    title: "Unsigned tx simulation report",
    family: "txpreview",
    stability: "stable",
    description:
      "The real simulateTransaction (sigVerify:false, replaceRecentBlockhash:true) over an unsigned envelope. Closed outcomes (simulated-ok | simulated-failed | unavailable | refused); S95 adds a deterministic failure classification (slippage/compute/blockhash/account/program) with the exact next safe action; simulated-ok is evidence for review, never readiness.",
    cli: "paper:simulation:tx",
  },
  {
    id: "txbuild.report.v1",
    title: "Swap build attempt report",
    family: "txpreview",
    stability: "stable",
    description:
      "The S95 auditable record of ONE unsigned-build attempt — built or refused. Every refusal carries its closed-set code, an operator message, and the exact next safe action; a built attempt carries fresh-quote facts and the decoded transaction SHAPE facts (version, blockhash, programs, address-table lookups). Nothing here signs or sends.",
    cli: "execution:build",
  },
  {
    id: "execution.status.report.v1",
    title: "Execution status report",
    family: "execution",
    stability: "stable",
    description:
      "The resolved execution mode plus the FULL fourteen-condition mainnet live-gate checklist (default BLOCKED) and the core gate. S93 adds quote-freshness evidence from a live fetch report + explicit age cap. Read-only; can never arm anything.",
    cli: "execution:status",
  },
  {
    id: "execution.attempt.report.v1",
    title: "Execution attempt report",
    family: "execution",
    stability: "stable",
    description:
      "One journaled gated execution attempt (refused or submitted) from the refusal-first send path — devnet-only in the shipped CLI. Submission is not confirmation, and the report says so.",
    cli: "execution:devnet:send",
  },
  {
    id: "execution.devnet.rehearsal.report.v1",
    title: "Devnet rehearsal report",
    family: "execution",
    stability: "stable",
    description:
      "The S93 devnet end-to-end broadcast rehearsal: throwaway gitignored keypair, airdrop, unsigned self-transfer probe, simulation, gated send, confirmation — every step honest (an airdrop rate limit is devnet-funding-blocked, never faked success). Devnet only by construction.",
    cli: "execution:devnet:rehearse",
  },
  {
    id: "execution.readiness.report.v1",
    title: "Mainnet readiness checklist",
    family: "execution",
    stability: "stable",
    description:
      "All fourteen live-gate conditions evaluated against operator-NAMED evidence, each gap named with its exact next safe action. Structurally incapable of reporting armed; the verdict literal is always blocked. S96 adds the last session's reconciliation status as evidence.",
    cli: "execution:readiness",
  },
  {
    id: "execution.reconciliation.report.v1",
    title: "Execution reconciliation report",
    family: "execution",
    stability: "stable",
    description:
      "The S96 post-trade accounting record over ONE execution session: signature, closed confirmation classification (confirmed/finalized/timeout/dropped/rpc-unavailable/signature-error/unknown), pre/post balance facts from ACTUAL reads, the lamport/token deltas, the real fee when transaction meta supplies it, and a closed expected-vs-actual verdict. Unavailable data says unavailable — nothing is estimated and no P/L is ever invented.",
    cli: "execution:session:reconcile",
  },
  {
    id: "execution.session.status.v1",
    title: "Execution session status",
    family: "execution",
    stability: "stable",
    description:
      "The S96 read-only accounting state of the latest execution session and the continuation decision a NEW devnet attempt would face: allowed only after reconciled / not-sent / funding-blocked / an explicit audited acknowledgment. A blocked decision is the refusal wall working, not a bug.",
    cli: "execution:session:status",
  },
  {
    id: "engine.status.report.v1",
    title: "Rust engine status",
    family: "engine",
    stability: "stable",
    description:
      "The S97 Rust sidecar foundation's self-description over JSON IPC: capabilities (CLOSED allowlist — status, json-ipc, schema-parity, and since S98 realtime-replay-normalize), explicit disabled list, and signer/send/mainnet-send markers that must all literally be disabled or the TypeScript validator refuses the artifact. Deterministic — the engine reads no clock; the orchestrator supplies createdAt.",
    cli: "engine:status",
  },
  {
    id: "engine.realtime.observations.report.v1",
    title: "Rust engine replay observations",
    family: "engine",
    stability: "stable",
    description:
      "The S98 Rust realtime hot path's output: candidate observations normalized from an operator-supplied REPLAY file over bounded stdin (never live data, never an order). TypeScript re-validates every observation — mints re-parsed, labels re-checked for secret shapes, caveats pinned byte for byte — then folds them into the existing realtime.candidates.snapshot.v1, byte-identical to the TypeScript normalizer's output. The engine still has no network, signing, or sending capability.",
    cli: "paper:realtime:snapshot",
  },
  {
    id: "engine.routequote.score.report.v1",
    title: "Rust engine route quote scores",
    family: "engine",
    stability: "stable",
    description:
      "The S99 Rust quote/router hot path's output: quote-quality INTELLIGENCE (impact, hops, age) over a TypeScript-produced routequote.fetch.report.v1 — per-entry scores with penalty components, a deterministic ranking, and closed reason codes. TypeScript recomputes every score and RE-EVALUATES every freshness verdict with the real evaluateQuoteFreshness; any disagreement refuses the artifact. Never a profitability claim, never readiness, never an order — and the engine still has no network capability.",
    cli: "engine:quote:score",
  },
  {
    id: "engine.tx.inspect.report.v1",
    title: "Rust engine tx inspect",
    family: "engine",
    stability: "stable",
    description:
      "The S100 Rust transaction inspection output: SHAPE facts decoded from a strictly-UNSIGNED txpreview.envelope.v1 (version, blockhash presence, instruction/account counts, static program ids, ALT counts) — parsed byte by byte in pure Rust. The bridge re-derives the facts with the real @solana/web3.js decoder and refuses unless they match; a signed transaction is refused. Read-only: never signs, never sends.",
    cli: "engine:tx:inspect",
  },
  {
    id: "engine.sim.classification.report.v1",
    title: "Rust engine sim classification",
    family: "engine",
    stability: "stable",
    description:
      "The S100 Rust simulation-classification output: a simulation result mapped onto the S95 CLOSED set (slippage/compute/blockhash/account/program/unclassified) with the verbatim operator guidance. TypeScript re-runs the real classifySimulationFailure and refuses on disagreement. A classification explains WHY a simulation failed — never an execution signal.",
    cli: "engine:sim:classify",
  },
  {
    id: "engine.sniper.score.report.v1",
    title: "Rust engine candidate scores",
    family: "engine",
    stability: "stable",
    description:
      "The S101 Rust memecoin candidate scoring output: a deterministic per-candidate score (0-100) + closed verdict (watch/caution/reject/insufficient-evidence) + ranking, computed from a sniper.score.input.v1 bundle of already-collected facts (risk, token mechanics, quote quality, simulation evidence). TypeScript re-derives every component, score, verdict, reason set, and the ranking and cross-checks the echoed facts against the bundle; any disagreement refuses the artifact. A score is INTELLIGENCE only — never a buy signal, never live readiness, and a rejected risk (or a critical flag / Token-2022 blocker) stays rejected no matter the score.",
    cli: "engine:sniper:score",
  },
  {
    id: "sniper.preflight.input.v1",
    title: "Sniper preflight input bridge",
    family: "sniper",
    stability: "stable",
    description:
      "The S90 read-only bridge: token:inspect / token:risk evidence paired to candidates BY MINT for the preflight stage. Cross-kind, unknown-mint, duplicate, and secret-shaped inputs are refused at prepare time. Since S94 the rehearsal's auto-risk writes one automatically.",
    cli: "paper:sniper:preflight:input:prepare",
  },
  {
    id: "sniper.rehearsal.report.v1",
    title: "Sniper rehearsal stage record",
    family: "sniper",
    stability: "stable",
    description:
      "The S93 unified rehearsal workflow's honest per-stage record (candidates → risk bridge → quote fetch/prepare → dry-run → build → simulate → optional devnet broadcast → readiness). Closed mode set paper | devnet | mainnet-dry-run; no mode can send on mainnet.",
    cli: "paper:sniper:rehearse",
  },
  {
    id: "sniper.mainnet_dryrun.release_candidate.v1",
    title: "Mainnet dry-run release candidate",
    family: "sniper",
    stability: "stable",
    description:
      "The S102 no-send release candidate: one mainnet dry-run rehearsal folded into an auditable summary (candidate scoring + ranking, deep risk, Token-2022 blockers, quote + freshness + Rust quote score, unsigned tx build, Rust tx inspection, real simulation, readiness checklist). The verdict is RE-DERIVED from the structured stage evidence (never from a candidate score), the live-send status is the literal \"disabled\", and the closed schema refuses any send-result field. 'dryrun-complete-blocked-live' means dry-run evidence complete and live STILL disabled — never live-trading readiness. Produced by paper:sniper:rehearse --mode mainnet-dry-run.",
    cli: "paper:sniper:rehearse",
  },
  {
    id: "phase7.authorization.audit.v1",
    title: "Phase 7 authorization audit",
    family: "execution",
    stability: "stable",
    description:
      "The S103 read-only security review: is the repo ready to be CONSIDERED for a separately-authorized S104 controlled micro-trade? It folds the fourteen-condition live gate, the no-send invariant, the signer/Rust/redaction/reconciliation boundaries, the release candidate, and the command surface into one verdict that is RE-DERIVED from the evidence and DEFAULTS to not-authorized. The best verdict, 'ready-for-separate-microtrade-authorization', authorizes NOTHING; live execution is pinned false and the artifact is structurally incapable of arming, signing, or sending. Produced by paper:phase7:authorization:audit.",
    cli: "paper:phase7:authorization:audit",
  },
  {
    id: "execution.devnet.funding_status.v1",
    title: "Devnet funding status",
    family: "execution",
    stability: "stable",
    description:
      "The S103-B devnet proof unblocker: one honest, retained devnet balance observation for a throwaway rehearsal key. Public-key only — funded / canBroadcastDevnetProbe / fundingSourceStatus (funded | unfunded | faucet-rate-limited | faucet-unavailable | rpc-unavailable | unknown) are RE-DERIVED from the observed lamports, so an unobserved or short balance can never read as funded. Devnet only; never reads a secret key; authorizes no live trading. Produced by execution:devnet:funding-status.",
    cli: "execution:devnet:funding-status",
  },
  {
    id: "phase7.human_signoff.record.v1",
    title: "Phase 7 human sign-off record",
    family: "execution",
    stability: "stable",
    description:
      "The S103-B mechanism for a FUTURE explicit human Phase 7 authorization. The default is a blank template-only checklist; a SIGNED status requires every required acknowledgement for the target scope plus operator + signed-at labels and (for a micro-trade) a bounded max-spend. The status and granted scope are RE-DERIVED (a signature cannot be faked); the granted scope can never exceed controlled-microtrade; and even a fully-signed record authorizes NO live trade and creates no mainnet send — it is evidence only. Produced by paper:phase7:signoff:template.",
    cli: "paper:phase7:signoff:template",
  },
  {
    id: "sniper.operator_demo.manifest.v1",
    title: "Sniper operator demo manifest",
    family: "sniper",
    stability: "stable",
    description:
      "The S103-B operator demo workbench manifest: a SAFE, showable folder of the paper / dry-run pipeline. It ties together the real read-only Phase 7 audit + sign-off template, an honest devnet funding-status fixture, and the byte-pinned fictional candidate + release-candidate examples — every artifact labelled by provenance (real-readonly | fixture | fictional-example) with re-derived counts. Live execution is pinned disabled; nothing sends, signs, or trades. Produced by paper:sniper:operator-demo.",
    cli: "paper:sniper:operator-demo",
  },
  {
    id: "phase7.microtrade.preflight.v1",
    title: "S104 micro-trade preflight",
    family: "execution",
    stability: "stable",
    description:
      "The S104-A no-send readiness check: IF a human later gives a separate, explicit S104 execution authorization, are the required inputs present? It folds the written Phase 7 sign-off, the reconciled devnet broadcast proof, a complete mainnet dry-run release candidate, a public burner wallet, a bounded max-spend, a manual-confirmation label, and the release candidate's risk/quote/simulation posture into one re-derived verdict. It DOES NOT execute a trade: it never signs, never sends, never loads a key, and the best verdict — ready-for-separate-execution-authorization — authorizes NOTHING. liveExecutionAuthorized/authorizesLiveTrading are pinned false; the closed schema refuses any send result or signature. Produced by paper:phase7:microtrade:preflight.",
    cli: "paper:phase7:microtrade:preflight",
  },
  {
    id: "sniper.watchlist.v1",
    title: "Sniper watchlist",
    family: "sniper",
    stability: "stable",
    description:
      "The S104-C operator watchlist: a deterministic, offline list of candidate mints to monitor, each with a status (watch | review | blocked | archived) that is bookkeeping ONLY. Every mint is validated as a public key (secret-length input refused); a status NEVER implies trade readiness (statusIsNotTradeReadiness is pinned true and there is no readiness/execution field); distinct/duplicate-mint lists and status counts are re-derived. Produced by paper:sniper:watchlist:prepare.",
    cli: "paper:sniper:watchlist:prepare",
  },
  {
    id: "sniper.dryrun.campaign.v1",
    title: "Sniper dry-run campaign",
    family: "sniper",
    stability: "stable",
    description:
      "The S104-C no-send campaign: a comparison of candidates across the paper / dry-run evidence already gathered (ranking, watchlist status, deep risk, route quote, unsigned build, simulation, mainnet dry-run release-candidate verdict, token preflight). Each candidate's finalOperatorVerdict (watch | review | blocked | insufficient-evidence) is RE-DERIVED from the structured evidence — a candidate's score is never read by the derivation, so a high score can NEVER override a blocker; missing evidence shows as insufficient-evidence, never hidden. liveSendStatus is pinned \"disabled\" and the closed schema refuses any signature / txid / send-result field. Produced by paper:sniper:campaign:run.",
    cli: "paper:sniper:campaign:run",
  },
];

/** Look up schema metadata by id, or `undefined` for an unknown schema. */
export function knownSchema(id: string): ReportSchemaInfo | undefined {
  return KNOWN_REPORT_SCHEMAS.find((schema) => schema.id === id);
}

/**
 * Inverse of {@link knownSchema}: find the schema a CLI command emits, matched
 * against the registry's `cli` field. Returns `undefined` for a command that
 * produces no catalogued artifact (e.g. `doctor`, `paper:run`). This is the
 * single source of truth the command-reference page reads so a command's
 * artifact + stability can never drift from the schema registry.
 */
export function schemaForCli(cli: string): ReportSchemaInfo | undefined {
  return KNOWN_REPORT_SCHEMAS.find((schema) => schema.cli === cli);
}

/** True when `id` is a schema this foundation recognizes. */
export function isKnownSchema(id: string): boolean {
  return knownSchema(id) !== undefined;
}

/**
 * How the inspector should label a (possibly missing) schemaVersion:
 *   - "absent"   — no usable `schemaVersion` field at all
 *   - "stable"   — a shipped, recognized schema
 *   - "emerging" — a recognized but backend-work-in-progress schema
 *   - "unknown"  — a present-but-unrecognized schema id (labelled honestly, never faked)
 */
export type SchemaRecognition = "absent" | "stable" | "emerging" | "unknown";

/** Classify a raw schemaVersion string without ever pretending to know it. */
export function recognizeSchema(id: string | null | undefined): SchemaRecognition {
  if (typeof id !== "string" || id.length === 0) {
    return "absent";
  }
  const info = knownSchema(id);
  return info ? info.stability : "unknown";
}

/**
 * Frontend-only shape of a report file the viewer expects to READ later.
 *
 * This is intentionally permissive and unknown-tolerant. It is NOT a validator
 * and NOT a parser — it only documents the envelope so components are typed.
 */
export interface ReportEnvelope {
  readonly schemaVersion?: string;
  readonly scenarioDigest?: string;
  readonly [key: string]: unknown;
}

/** Read the declared schema version from an envelope, if present and a string. */
export function envelopeSchema(envelope: ReportEnvelope): string | undefined {
  return typeof envelope.schemaVersion === "string"
    ? envelope.schemaVersion
    : undefined;
}
