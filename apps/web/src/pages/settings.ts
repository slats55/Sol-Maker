/** Settings page — a non-functional placeholder shell. */

import { html, type RawHtml } from "../lib/html.js";
import { navItem, ICONS } from "../lib/nav.js";
import { PageHeader } from "../components/layout.js";
import { DefinitionList, EmptyState, RiskNotice, Section } from "../components/ui.js";

export function renderSettings(): RawHtml {
  const nav = navItem("settings");
  return html`
    ${PageHeader({ eyebrow: nav.group, title: "Settings", description: nav.description })}

    ${RiskNotice({
      tone: "info",
      title: "Placeholder shell — nothing here changes anything yet.",
      body: html`No setting is persisted, no secret is stored, and nothing reaches the network. This page
        exists to document where local display preferences would live.`,
    })}

    ${Section({
      title: "Display",
      description: "Read-only placeholders for future, local-only preferences.",
      body: DefinitionList([
        { term: "Theme", detail: "Dark command center (fixed for now)" },
        { term: "Density", detail: "Comfortable (placeholder)" },
        { term: "Reduced motion", detail: "Follows your operating system" },
      ]),
    })}

    ${Section({
      title: "Data source",
      description: "How the dashboard would read local artifacts — deliberately inert today.",
      body: DefinitionList([
        { term: "Source", detail: "None — no file loading is wired" },
        { term: "Network", detail: "Disabled — no external calls, ever" },
        { term: "Live data", detail: "Never — PAPER-only display" },
      ]),
    })}

    ${Section({
      title: "Status",
      body: EmptyState({
        icon: ICONS.gear,
        title: "No configurable settings yet",
        message: "This is a foundation. Real, local-only preferences arrive in a later UI sprint.",
      }),
    })}
  `;
}
