/** Safety & modes page — the wallet-safety model surfaced for display. */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import { MODES, NEVER_DOES, SAFETY_DISCLAIMERS } from "../lib/safety.js";
import { PageHeader } from "../components/layout.js";
import { BulletList, DefinitionList, Pill, RiskNotice, Section } from "../components/ui.js";
import { CapabilityTable } from "../components/tables.js";

const GATE_CONDITIONS: readonly string[] = [
  "mode === DANGEROUS_BURNER_LIVE",
  "killSwitch === false",
  "live.acknowledgeBurnerRisk === true",
  "live.confirmFreshBurner === true",
  "live.burnerKeyEnvVar is set AND that env var is present",
  "out-of-band env SOULMAKER_I_UNDERSTAND_BURNER_RISK === \"true\"",
  "caps within the hard limits (HARD_LIMITS)",
];

export function renderSafety(): RawHtml {
  const nav = navItem("safety");
  return html`
    ${PageHeader({
      eyebrow: nav.group,
      title: "Safety & modes",
      description: nav.description,
      aside: Pill("wallet safety first", "safe"),
    })}

    ${RiskNotice({
      tone: "info",
      title: "SECURITY.md and docs/WALLET_SAFETY_MODEL.md are authoritative.",
      body: html`This page mirrors those documents for display. If anything here disagrees with them, they win.
        Soulmaker defaults to PAPER and refuses to handle seeds or the operator's main wallet.`,
    })}

    ${Section({
      title: "Modes (safest → most dangerous)",
      description: "Only DANGEROUS_BURNER_LIVE can ever send, and it is gated and not started.",
      body: CapabilityTable(),
    })}

    ${Section({
      title: "What each mode means",
      body: DefinitionList(
        MODES.map((mode) => ({
          term: mode.label,
          detail: html`<span class="sm-mode sm-mode--${mode.tone}">${mode.status}</span> ${mode.summary}`,
        })),
      ),
    })}

    ${Section({
      title: "Hard guarantees — what this dashboard will never do",
      body: BulletList(NEVER_DOES, "deny"),
    })}

    ${Section({
      title: "Always-on disclaimers",
      body: html`<ul class="sm-pillrow">
        ${SAFETY_DISCLAIMERS.map((text) => html`<li class="sm-pill sm-pill--safe">${text}</li>`)}
      </ul>`,
    })}

    ${Section({
      title: "Live-mode gate (fail-closed)",
      description:
        "Every condition must hold before any future signing/sending code could run. The gate fails closed. Roadmap Phase 7 — not started.",
      body: BulletList(GATE_CONDITIONS, "allow"),
    })}
  `;
}
