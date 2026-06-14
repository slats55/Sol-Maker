/**
 * Sniper Command Center page (Sprint 90).
 *
 * The unified PAPER sniper view: the honest capability strip, dashboard cards,
 * the safe pipeline visualization, the candidate intelligence table, and the
 * observability panel — all rendered over the committed, byte-pinned
 * `fixtures/dry-run-sample/` run (a REAL `paper:sniper:dry-run` output over
 * FICTIONAL candidates) and clearly marked SAMPLE. The same blocks render for
 * a REAL run folder via `pnpm web:inspect --dir <folder>` — this page is the
 * product surface, the folder index is the live one.
 *
 * Everything stays honest: no prices, no PnL, no fake liquidity, no timing
 * data invented, route honestly unavailable, live trading disabled.
 */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { loadSampleDryRun } from "../lib/sample-run.js";
import {
  buildCandidateRows,
  buildObservabilityFacts,
  buildPipelineStages,
  SNIPER_CAPABILITIES,
} from "../lib/command-center.js";
import { routeStatusExplanation } from "../lib/dry-run-overview.js";
import { hasTypedView } from "../components/artifact-views.js";
import { PageHeader } from "../components/layout.js";
import { RiskNotice, SampleBadge, Section, StatusCard } from "../components/ui.js";
import {
  CandidateIntelSection,
  CapabilitySection,
  ObservabilitySection,
  PipelineSection,
} from "../components/command-center.js";

function header(): RawHtml {
  const nav = navItem("sniper");
  return PageHeader({ eyebrow: nav.group, title: "Sniper command center", description: nav.description });
}

function paperOnlyNotice(): RawHtml {
  return RiskNotice({
    tone: "caution",
    title: "PAPER-only command center — SIMULATION ONLY, by construction.",
    body: html`Everything on this page describes the <strong>paper</strong> sniper pipeline. There is
      <strong>no wallet, no key, no signing, no transaction, no order</strong> anywhere in this system; the
      route resolver is an honest boundary (always <em>unavailable</em>), and Phase 7 live trading remains
      <strong>disabled and unauthorized</strong>. A simulated <em>paper-enter</em> is a classification that
      always demands operator review — never a trade.`,
  });
}

/** The dashboard cards over the sample run (verdict, candidates, route, readiness, next action). */
function sampleDashboardSection(): RawHtml {
  const { index, overview } = loadSampleDryRun(hasTypedView);
  const rows = buildCandidateRows(index);
  const blocked = rows.rows.filter((row) => row.decision === "paper-reject" || (row.blockingCodes.length > 0)).length;
  const nextAction =
    overview.whatToInspectNext.items.length > 0
      ? overview.whatToInspectNext.items[0]
      : "Read RUN_SUMMARY.md in the run folder.";
  const cards: readonly RawHtml[] = [
    StatusCard({
      label: "Latest dry-run verdict",
      value: overview.operatorVerdict ?? "(missing)",
      tone: overview.operatorVerdict === "reviewable-paper-only" ? "safe" : "caution",
      note: "verbatim from the operator bundle",
      sample: true,
    }),
    StatusCard({
      label: "Candidates",
      value: String(rows.rows.length),
      tone: "neutral",
      note: `${String(blocked)} blocked / rejected`,
      sample: true,
    }),
    StatusCard({
      label: "Route status",
      value: overview.routeResolutionStatus ?? "(missing)",
      tone: "neutral",
      note: routeStatusExplanation(overview.routeResolutionStatus),
      sample: true,
    }),
    StatusCard({
      label: "Readiness (verbatim)",
      value: overview.simulationReadyPerReadiness === null ? "unknown" : String(overview.simulationReadyPerReadiness),
      tone: "neutral",
      note: "phase6 SIMULATION readiness — never live readiness",
      sample: true,
    }),
    StatusCard({
      label: "Audit / handoff / bundle",
      value: `${String(overview.validRoleCount)}/13 roles valid`,
      tone: overview.complete === true ? "safe" : "caution",
      note: overview.blockingTrailConsistent === false ? "blocking trail INCONSISTENT" : "blocking trail consistent",
      sample: true,
    }),
    StatusCard({
      label: "Artifacts",
      value: String(index.counts.validArtifacts),
      tone: "neutral",
      note: `${String(index.schemaCounts.length)} distinct schemas`,
      sample: true,
    }),
  ];
  return Section({
    title: "Sample run",
    description:
      "Rendered from the committed dry-run sample (a real paper:sniper:dry-run output over FICTIONAL candidates). Your own runs render the same blocks via the inspect command below.",
    aside: SampleBadge(),
    body: html`<div class="sm-cardgrid">${cards}</div>
      <p class="sm-muted-line">Next operator action: ${nextAction}</p>`,
  });
}

/** The run-it-yourself command chain (the real operator workflow, end to end). */
function workflowSection(): RawHtml {
  const commands: readonly { readonly command: string; readonly summary: string }[] = [
    {
      command: "pnpm soulmaker token:inspect <MINT> --json --out runs/r/inspect.json",
      summary: "Read-only mint inspection (decimals, supply, mint/freeze authority). Advisory, never a buy signal.",
    },
    {
      command: "pnpm soulmaker token:risk <MINT> --json --out runs/r/risk.json",
      summary: "Advisory risk report from the real risk engine (flags + score + decision).",
    },
    {
      command:
        "pnpm soulmaker paper:sniper:preflight:input:prepare --candidates runs/r/candidates.json --inspect runs/r/inspect.json --risk runs/r/risk.json --out runs/r/preflight-input.json",
      summary: "The bridge: pairs the read-only outputs to your candidates BY MINT (verbatim, fail-closed).",
    },
    {
      command:
        "pnpm soulmaker paper:sniper:dry-run --candidates runs/r/candidates.json --preflight-input runs/r/preflight-input.json --adopt-specs --operator <you> --acknowledge-paper-enter-review --out runs/r/out",
      summary: "One command, the whole PAPER chain: 19 artifacts + RUN_SUMMARY.md in one folder.",
    },
    {
      command: "pnpm web:inspect --dir runs/r/out --force",
      summary: "Render THIS command center over your real run folder (local-only; restore with pnpm web:build).",
    },
  ];
  return Section({
    title: "Run it yourself",
    description:
      "The real-input rehearsal workflow — see examples/sniper/real-input-rehearsal/ for a runnable fictional walkthrough.",
    body: html`<div class="sm-cmdgrid">
      ${commands.map(
        (cmd) => html`<article class="sm-cmd">
          <code class="sm-cmd__code">${cmd.command}</code>
          <p class="sm-cmd__summary">${cmd.summary}</p>
        </article>`,
      )}
    </div>`,
  });
}

/** Sprint 105-B — the no-send Operator Alpha Workflow: provider health → live-read-only campaign. */
function alphaWorkflowSection(): RawHtml {
  const commands: readonly { readonly command: string; readonly summary: string }[] = [
    {
      command: "pnpm soulmaker paper:sniper:provider:doctor --mode mainnet-dry-run --out runs/alpha/provider-health.json",
      summary:
        "Check read-only provider readiness FIRST: bounded probes of the RPC, the Jupiter quote API, and the Rust engine into a sniper.provider_health.report.v1. Reachability only — a provider being down is honest evidence, never a candidate risk verdict. No raw endpoint is printed.",
    },
    {
      command:
        "pnpm soulmaker paper:sniper:campaign:auto-run --candidates runs/alpha/candidates.json --mode mainnet-dry-run --allow-readonly-network --check-providers --rpc-url <RPC_URL> --out runs/alpha",
      summary:
        "Run the live-read-only auto campaign: it checks providers, then gathers deep risk + route quotes itself. An unreachable provider SKIPS its stage as honest evidence — it never fakes a result and never kills the run. --rpc-url drives the provider probe, deep risk, AND simulation at the SAME read-only endpoint (a key in the URL is never printed). No send, no signer, no key.",
    },
    {
      command: "pnpm soulmaker paper:sniper:campaign:diff --before runs/prev/campaign.json --after runs/alpha/campaign.json --out runs/alpha/campaign-diff.json",
      summary: "Compare two campaigns — improved / worsened / newly-blocked / newly-watch. Reports movement only; authorizes nothing.",
    },
    {
      command: "pnpm soulmaker paper:sniper:alpha:report --campaign runs/alpha/campaign.json --plan runs/alpha/readonly-campaign-plan.json --out runs/alpha/alpha-report.json",
      summary: "Assemble the showable sniper.alpha_run.report.v1 (top / blocked / insufficient-evidence candidates, stage coverage, provider + Rust health, Phase 7 posture). Never a profitability or live-readiness claim.",
    },
    {
      command: "pnpm web:inspect --dir runs/alpha --force",
      summary: "Render the alpha folder — plan, ranked campaign, diff, alpha report, and the provider health report — each with a LIVE TRADING DISABLED banner. Restore the static site with pnpm web:build.",
    },
  ];
  const providerStatuses: readonly { readonly status: string; readonly meaning: string }[] = [
    { status: "available", meaning: "reachable for read-only use" },
    { status: "unavailable", meaning: "unreachable (network error)" },
    { status: "timeout", meaning: "no response within the timeout" },
    { status: "rate-limited", meaning: "the provider throttled the read-only probe" },
    { status: "misconfigured", meaning: "the endpoint is an invalid / unsupported URL" },
    { status: "error", meaning: "the provider returned an error" },
    { status: "skipped", meaning: "not probed (e.g. exercised by the campaign instead)" },
  ];
  const provenance: readonly { readonly label: string; readonly meaning: string }[] = [
    { label: "real-readonly", meaning: "real evidence read live from a public RPC / quote provider (no send, no signer)" },
    { label: "fixture", meaning: "deterministic committed example evidence" },
    { label: "unavailable", meaning: "a provider could not be reached — recorded honestly, never faked" },
    { label: "skipped", meaning: "a stage was gated off (provider down, or risk blocked the candidate)" },
    { label: "blocked", meaning: "a candidate failed a risk / build / simulation gate — never overridable by a score" },
  ];
  return Section({
    title: "Operator alpha workflow (live-read-only · no-send)",
    description:
      "Sprint 105-B: diagnose read-only providers, then run or honestly block a real-read-only alpha campaign. Live trading stays disabled — nothing here signs, sends, or trades.",
    body: html`
      ${RiskNotice({
        tone: "info",
        title: "Read-only providers only — LIVE TRADING DISABLED · no wallet, no key, no signer, no send.",
        body: html`The provider <strong>doctor</strong> reports whether Sol Maker can <em>reach</em> the read-only
          dependencies an alpha campaign needs (RPC, the Jupiter quote API, the Rust engine). A provider being down
          is <strong>honest evidence</strong>, never a candidate risk verdict — and the campaign skips that stage
          rather than faking a result. Default endpoints are public and keyless; a key embedded in a custom
          <code>--rpc-url</code> / <code>--jupiter-url</code> is <strong>never printed</strong> (every endpoint is
          reduced to its host). An explicit <code>--rpc-url</code> is honored consistently — the doctor probe, the
          deep-risk read, and the simulation all use that <em>same</em> endpoint (flag &gt; <code>SOULMAKER_RPC_URL</code>
          &gt; default), so the gathered evidence is internally consistent. <code>canRunLiveReadonlyCampaign</code>
          means only that the read-only network is reachable — it <strong>never</strong> means a trade is authorized.`,
      })}
      <div class="sm-cmdgrid">
        ${commands.map(
          (cmd) => html`<article class="sm-cmd">
            <code class="sm-cmd__code">${cmd.command}</code>
            <p class="sm-cmd__summary">${cmd.summary}</p>
          </article>`,
        )}
      </div>
      ${Section({
        title: "Alpha run folder",
        description: "What --out contains after a run (inspect it with the command above).",
        body: html`<ul class="sm-bullets sm-bullets--plain">
          <li><code>provider-health.json</code> — sniper.provider_health.report.v1 (reachability only)</li>
          <li><code>readonly-campaign-plan.json</code> — what the no-send campaign is ALLOWED to do</li>
          <li><code>campaign.json</code> — the ranked, re-derived candidate verdicts</li>
          <li><code>alpha-report.json</code> — the showable summary (top / blocked / insufficient)</li>
          <li><code>evidence-index.json</code> + per-candidate evidence, and <code>RUN_SUMMARY.md</code></li>
        </ul>`,
      })}
      ${Section({
        title: "Provider health status vocabulary",
        description: "Reachability only — there is deliberately no blocked / ready status, so a down provider is never confused with a blocked candidate.",
        body: html`<ul class="sm-bullets sm-bullets--plain">
          ${providerStatuses.map((s) => html`<li><code>${s.status}</code> — ${s.meaning}</li>`)}
        </ul>`,
      })}
      ${Section({
        title: "What is real vs fixture vs unavailable vs skipped vs blocked",
        body: html`<ul class="sm-bullets sm-bullets--plain">
          ${provenance.map((p) => html`<li><code>${p.label}</code> — ${p.meaning}</li>`)}
        </ul>`,
      })}
      <p class="sm-muted-line">Next safe action: run the provider doctor; if providers are reachable, run the
        auto campaign with <code>--check-providers</code>; if not, the campaign records the unavailable providers
        honestly and runs a fixture campaign instead. Nothing here trades.</p>
    `,
  });
}

/** The Phase 7 / live posture + the operator demo workbench — honest, calm, no green live state. */
function livePostureSection(): RawHtml {
  const commands: readonly { readonly command: string; readonly summary: string }[] = [
    {
      command: "pnpm soulmaker paper:sniper:operator-demo --out runs/demo",
      summary:
        "Assemble a SAFE demo folder (the real Phase 7 audit + a blank sign-off template + an honest devnet funding-status fixture + the fictional release candidate), every artifact labelled by provenance. Inspect it with pnpm web:inspect --dir runs/demo.",
    },
    {
      command: "pnpm soulmaker execution:devnet:funding-status --public-key <KEY>",
      summary: "Read the throwaway devnet key's balance and report the honest funding/proof status. Never sends; mainnet endpoints refused.",
    },
    {
      command: "pnpm soulmaker paper:phase7:signoff:template --out runs/signoff.json",
      summary: "Generate the blank Phase 7 human sign-off template. A signed record is EVIDENCE only — it authorizes no live trade and creates no mainnet send.",
    },
    {
      command: "pnpm soulmaker paper:phase7:authorization:audit",
      summary: "Re-run the read-only Phase 7 authorization audit. The verdict defaults to not-authorized and authorizes nothing.",
    },
    {
      command: "pnpm soulmaker paper:phase7:microtrade:preflight --sign-off-record … --release-candidate …",
      summary:
        "S104 preflight: check whether the structural inputs for a FUTURE, separately-authorized micro-trade are present. It does NOT execute — the best verdict, ready-for-separate-execution-authorization, authorizes nothing.",
    },
  ];
  return Section({
    title: "Phase 7 live-trading posture & operator demo",
    description: "The honest live-execution status. Nothing here is ready to trade.",
    body: html`
      ${RiskNotice({
        tone: "caution",
        title: "Live trading is DISABLED and unauthorized.",
        body: html`The fourteen-condition mainnet live gate defaults <strong>blocked</strong>, no CLI command can
          send on mainnet, and the Phase 7 authorization audit verdict is
          <code>authorized-for-design-only</code>. Of the two prerequisites before a controlled micro-trade
          could even be <em>considered</em>, the devnet broadcast is now <strong>met</strong> — a real funded
          devnet broadcast confirmed and reconciled (devnet slot <code>469219488</code>, verdict
          <code>reconciled</code>). A written human Phase 7 sign-off remains the <em>only</em> open
          prerequisite. The S104 micro-trade <strong>preflight</strong>
          (<code>paper:phase7:microtrade:preflight</code>) now checks whether the structural inputs are
          present, but its best verdict — <code>ready-for-separate-execution-authorization</code> — still
          authorizes nothing. Even so, nothing is authorized here, and no flag in this repo can substitute for
          that human decision.`,
      })}
      <div class="sm-cmdgrid">
        ${commands.map(
          (cmd) => html`<article class="sm-cmd">
            <code class="sm-cmd__code">${cmd.command}</code>
            <p class="sm-cmd__summary">${cmd.summary}</p>
          </article>`,
        )}
      </div>
    `,
  });
}

/** The full static Sniper Command Center page. */
export function renderSniper(): RawHtml {
  const { index, overview } = loadSampleDryRun(hasTypedView);
  return html`
    ${header()}
    ${paperOnlyNotice()}
    ${CapabilitySection(SNIPER_CAPABILITIES)}
    ${sampleDashboardSection()}
    ${PipelineSection(buildPipelineStages(index, overview))}
    ${CandidateIntelSection(buildCandidateRows(index))}
    ${ObservabilitySection(buildObservabilityFacts(index, overview))}
    ${alphaWorkflowSection()}
    ${workflowSection()}
    ${livePostureSection()}

    <p class="sm-artifactview__note">
      Read-only, local, simulated paper artifacts. Not a live result, not advice, not a profitability claim.
    </p>
  `;
}
