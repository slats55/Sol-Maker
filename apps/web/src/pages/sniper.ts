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
          <code>authorized-for-design-only</code>. Two prerequisites remain open before a controlled
          micro-trade could even be <em>considered</em>: a confirmed devnet broadcast and a written human
          sign-off. Neither is granted here, and no flag in this repo can substitute for that human decision.`,
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
    ${workflowSection()}
    ${livePostureSection()}

    <p class="sm-artifactview__note">
      Read-only, local, simulated paper artifacts. Not a live result, not advice, not a profitability claim.
    </p>
  `;
}
