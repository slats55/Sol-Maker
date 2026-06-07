/**
 * Card components for CLI commands and report artifacts.
 */

import { html, type RawHtml } from "../lib/html.js";
import type { CommandRef } from "../lib/command-reference.js";
import { SampleBadge } from "./ui.js";
import { ReportSchemaBadge } from "./reports.js";

/** A card describing one CLI command. */
export function CommandCard(command: CommandRef): RawHtml {
  return html`<article class="sm-cmd">
    <code class="sm-cmd__code">pnpm soulmaker ${command.command}</code>
    <p class="sm-cmd__summary">${command.summary}</p>
    ${
      command.readsChain
        ? html`<span
            class="sm-pill sm-pill--caution"
            title="Reads public chain state; in PAPER mode requires --allow-paper-read and accepts public keys only"
            >reads chain · public keys only</span
          >`
        : html`<span class="sm-pill sm-pill--safe">offline · injected data</span>`
    }
  </article>`;
}

export interface ArtifactCardOptions {
  readonly name: string;
  readonly schema: string;
  readonly kind: string;
  readonly sample?: boolean;
}

/** A card describing a (local) report artifact file. */
export function ArtifactCard(opts: ArtifactCardOptions): RawHtml {
  return html`<article class="sm-artifact">
    <div class="sm-artifact__head">
      <span class="sm-artifact__kind">${opts.kind}</span>
      ${opts.sample ? SampleBadge() : null}
    </div>
    <code class="sm-artifact__name">${opts.name}</code>
    <div class="sm-artifact__schema">${ReportSchemaBadge(opts.schema)}</div>
  </article>`;
}
