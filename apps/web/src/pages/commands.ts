/** Command reference page — documents the existing CLI workflows. */

import { html, type RawHtml } from "../lib/html.js";
import { navItem } from "../lib/nav.js";
import {
  CLI_INVOCATION,
  COMMAND_GROUP_ORDER,
  commandsByGroup,
} from "../lib/command-reference.js";
import { PageHeader } from "../components/layout.js";
import { RiskNotice, Section } from "../components/ui.js";
import { CommandCard } from "../components/cards.js";

export function renderCommands(): RawHtml {
  const nav = navItem("commands");
  return html`
    ${PageHeader({
      eyebrow: nav.group,
      title: "Command reference",
      description: nav.description,
      aside: html`<code class="sm-codechip">${CLI_INVOCATION}</code>`,
    })}

    ${RiskNotice({
      tone: "caution",
      title: "Reference only — the dashboard never runs these.",
      body: html`These commands are run by the operator in a terminal. Read-only chain commands accept
        <strong>public keys only</strong> and, in PAPER mode, require an explicit
        <code>--allow-paper-read</code>. Nothing here signs or sends.`,
    })}

    ${COMMAND_GROUP_ORDER.map((group) =>
      Section({
        title: group,
        body: html`<div class="sm-cmdgrid">
          ${commandsByGroup(group).map((command) => CommandCard(command))}
        </div>`,
      }),
    )}
  `;
}
