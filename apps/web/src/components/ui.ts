/**
 * Reusable UI primitives: status / metric cards, pills, sections, empty states,
 * risk notices, and the SAMPLE marker. Pure {@link RawHtml} builders.
 */

import { html, type HtmlValue, type RawHtml } from "../lib/html.js";

export type Tone = "safe" | "neutral" | "caution" | "danger";

/** A small "SAMPLE" marker for clearly labelling local fixture content. */
export function SampleBadge(): RawHtml {
  return html`<span class="sm-tag sm-tag--sample" title="Local sample fixture — not live data">SAMPLE</span>`;
}

/** A generic pill / tag. */
export function Pill(text: string, tone: Tone | "muted" | "info" = "muted"): RawHtml {
  return html`<span class="sm-pill sm-pill--${tone}">${text}</span>`;
}

export interface StatusCardOptions {
  readonly label: string;
  readonly value: string;
  readonly tone?: Tone;
  readonly note?: string;
  readonly sample?: boolean;
}

/** A status card: a labelled headline value with an optional note. */
export function StatusCard(opts: StatusCardOptions): RawHtml {
  const tone = opts.tone ?? "neutral";
  return html`<article class="sm-card sm-card--${tone}">
    <div class="sm-card__head">
      <span class="sm-card__label">${opts.label}</span>
      ${opts.sample ? SampleBadge() : null}
    </div>
    <p class="sm-card__value">${opts.value}</p>
    ${opts.note ? html`<p class="sm-card__note">${opts.note}</p>` : null}
  </article>`;
}

export interface MetricCardOptions {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly sample?: boolean;
}

/** A compact metric card: a big number/value with a small label + hint. */
export function MetricCard(opts: MetricCardOptions): RawHtml {
  return html`<article class="sm-metric">
    <div class="sm-metric__head">
      <span class="sm-metric__label">${opts.label}</span>
      ${opts.sample ? SampleBadge() : null}
    </div>
    <p class="sm-metric__value">${opts.value}</p>
    ${opts.hint ? html`<p class="sm-metric__hint">${opts.hint}</p>` : null}
  </article>`;
}

export interface SectionOptions {
  readonly title?: string;
  readonly description?: string;
  readonly body: HtmlValue;
  readonly id?: string;
  readonly aside?: RawHtml;
}

/** A titled content section. */
export function Section(opts: SectionOptions): RawHtml {
  return html`<section class="sm-section"${opts.id ? html` id="${opts.id}"` : null}>
    ${
      opts.title || opts.aside
        ? html`<div class="sm-section__head">
            <div>
              ${opts.title ? html`<h2 class="sm-section__title">${opts.title}</h2>` : null}
              ${opts.description ? html`<p class="sm-section__desc">${opts.description}</p>` : null}
            </div>
            ${opts.aside ? html`<div class="sm-section__aside">${opts.aside}</div>` : null}
          </div>`
        : null
    }
    <div class="sm-section__body">${opts.body}</div>
  </section>`;
}

export interface EmptyStateOptions {
  readonly title: string;
  readonly message: string;
  readonly icon?: RawHtml;
  readonly action?: RawHtml;
}

/** An empty / no-data placeholder block. */
export function EmptyState(opts: EmptyStateOptions): RawHtml {
  return html`<div class="sm-empty">
    ${opts.icon ? html`<div class="sm-empty__icon">${opts.icon}</div>` : null}
    <p class="sm-empty__title">${opts.title}</p>
    <p class="sm-empty__message">${opts.message}</p>
    ${opts.action ? html`<div class="sm-empty__action">${opts.action}</div>` : null}
  </div>`;
}

export interface RiskNoticeOptions {
  readonly tone?: "info" | "caution";
  readonly title: string;
  readonly body: HtmlValue;
}

/** A callout for safety / risk language. */
export function RiskNotice(opts: RiskNoticeOptions): RawHtml {
  const tone = opts.tone ?? "info";
  return html`<div class="sm-notice sm-notice--${tone}" role="note">
    <p class="sm-notice__title">${opts.title}</p>
    <div class="sm-notice__body">${opts.body}</div>
  </div>`;
}

export interface DefinitionItem {
  readonly term: string;
  readonly detail: HtmlValue;
}

/** A simple term/detail definition list (used by settings + safety pages). */
export function DefinitionList(items: readonly DefinitionItem[]): RawHtml {
  return html`<dl class="sm-deflist">
    ${items.map(
      (item) => html`<div class="sm-deflist__row">
        <dt>${item.term}</dt>
        <dd>${item.detail}</dd>
      </div>`,
    )}
  </dl>`;
}

/** A bulleted list of plain strings. */
export function BulletList(items: readonly string[], tone: "plain" | "deny" | "allow" = "plain"): RawHtml {
  return html`<ul class="sm-bullets sm-bullets--${tone}">
    ${items.map((item) => html`<li>${item}</li>`)}
  </ul>`;
}
