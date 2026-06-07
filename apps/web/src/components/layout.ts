/**
 * Layout / shell components: the full-document shell, sidebar navigation, the
 * always-visible safety banner, the page header, mode badge, and footer.
 *
 * Pure functions returning {@link RawHtml}. No DOM, no framework.
 */

import { html, raw, type RawHtml } from "../lib/html.js";
import {
  APP,
  CURRENT_MODE,
  SAFETY_DISCLAIMERS,
  modeInfo,
  type Mode,
} from "../lib/safety.js";
import {
  ICONS,
  NAV_GROUP_ORDER,
  navByGroup,
  type NavItem,
} from "../lib/nav.js";

/** A small pill showing the current trading mode and its safety tone. */
export function ModeBadge(
  mode: Mode = CURRENT_MODE,
  opts: { readonly showStatus?: boolean } = {},
): RawHtml {
  const info = modeInfo(mode);
  return html`<span class="sm-badge sm-badge--${info.tone}" title="${info.summary}">
    <span class="sm-badge__dot" aria-hidden="true"></span>
    <span class="sm-badge__label">${info.label}</span>
    ${opts.showStatus ? html`<span class="sm-badge__status">${info.status}</span>` : null}
  </span>`;
}

/** The prominent, always-on safety banner shown at the top of every page. */
export function SafetyBanner(): RawHtml {
  return html`<aside class="sm-banner" role="note" aria-label="Safety status">
    <div class="sm-banner__lead">
      <span class="sm-banner__icon">${ICONS.shield}</span>
      <strong class="sm-banner__title">PAPER ONLY</strong>
      <span class="sm-banner__sub">No live trading · no wallet connected · no signing or sending.</span>
    </div>
    <ul class="sm-banner__tags">
      ${SAFETY_DISCLAIMERS.map((text) => html`<li class="sm-pill sm-pill--safe">${text}</li>`)}
    </ul>
  </aside>`;
}

function NavLink(item: NavItem, activeId: string): RawHtml {
  const active = item.id === activeId;
  return html`<li>
    <a
      class="sm-navlink${active ? " is-active" : ""}"
      href="${item.file}"${active ? raw(' aria-current="page"') : null}
      title="${item.description}"
    >
      <span class="sm-navlink__icon">${ICONS[item.icon]}</span>
      <span class="sm-navlink__label">${item.label}</span>
    </a>
  </li>`;
}

/** Grouped sidebar navigation; highlights the active page. */
export function SidebarNav(activeId: string): RawHtml {
  return html`<nav class="sm-sidebar" aria-label="Primary">
    <a class="sm-brand" href="index.html">
      <span class="sm-brand__mark" aria-hidden="true">◎</span>
      <span class="sm-brand__text">
        <span class="sm-brand__name">${APP.name}</span>
        <span class="sm-brand__tag">${APP.posture}</span>
      </span>
    </a>
    ${NAV_GROUP_ORDER.map(
      (group) => html`<div class="sm-navgroup">
        <p class="sm-navgroup__title">${group}</p>
        <ul class="sm-navlist">
          ${navByGroup(group).map((item) => NavLink(item, activeId))}
        </ul>
      </div>`,
    )}
  </nav>`;
}

export interface PageHeaderOptions {
  readonly eyebrow?: string;
  readonly title: string;
  readonly description?: string;
  readonly aside?: RawHtml;
}

/** Page title block with optional eyebrow, description, and right-aligned aside. */
export function PageHeader(opts: PageHeaderOptions): RawHtml {
  return html`<header class="sm-pagehead">
    <div class="sm-pagehead__main">
      ${opts.eyebrow ? html`<p class="sm-eyebrow">${opts.eyebrow}</p>` : null}
      <h1 class="sm-pagehead__title">${opts.title}</h1>
      ${opts.description ? html`<p class="sm-pagehead__desc">${opts.description}</p>` : null}
    </div>
    ${opts.aside ? html`<div class="sm-pagehead__aside">${opts.aside}</div>` : null}
  </header>`;
}

/** Footer with explicit "this is a placeholder shell / no live data" labels. */
export function Footer(): RawHtml {
  return html`<footer class="sm-footer">
    <p class="sm-footer__labels">
      <span class="sm-pill sm-pill--muted">Placeholder UI shell</span>
      <span class="sm-pill sm-pill--muted">Sample local fixture</span>
      <span class="sm-pill sm-pill--muted">No live data</span>
      <span class="sm-pill sm-pill--muted">PAPER-only display</span>
    </p>
    <p class="sm-footer__note">
      ${APP.name} dashboard foundation — local, offline, simulated. Not financial advice;
      not a profitability claim. See <a href="safety.html">Safety &amp; modes</a>.
    </p>
  </footer>`;
}

export interface ShellOptions {
  readonly activeId: string;
  readonly title: string;
  readonly description?: string;
  readonly body: RawHtml;
  /** Path prefix to the assets folder (for nested routes). Defaults to "". */
  readonly assetsPrefix?: string;
}

/** Full HTML document shell wrapping a page body with chrome + safety banner. */
export function DashboardShell(opts: ShellOptions): RawHtml {
  const prefix = opts.assetsPrefix ?? "";
  const pageTitle = `${opts.title} · ${APP.name}`;
  const description = opts.description ?? APP.tagline;
  return html`<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="generator" content="Soulmaker apps/web/src/build.ts — generated, do not edit by hand" />
  <meta name="description" content="${description}" />
  <title>${pageTitle}</title>
  <link rel="stylesheet" href="${prefix}assets/theme.css" />
</head>
<body class="sm-body">
  <a class="sm-skiplink" href="#main">Skip to content</a>
  <div class="sm-shell">
    ${SidebarNav(opts.activeId)}
    <main class="sm-main" id="main">
      ${SafetyBanner()}
      <div class="sm-content">
        ${opts.body}
      </div>
      ${Footer()}
    </main>
  </div>
</body>
</html>
`;
}
