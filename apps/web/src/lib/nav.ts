/**
 * Navigation model for the static dashboard.
 *
 * Each item carries both the intended future app `route` and the current
 * generated static `file`, so the sidebar works today (as flat static pages)
 * and documents the routing shape a real app would adopt later.
 */

import { raw, type RawHtml } from "./html.js";

/** Build a small, monochrome inline SVG icon (uses `currentColor`). */
function svg(body: string): RawHtml {
  return raw(
    `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ` +
      `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`,
  );
}

/** Icon set, keyed by name. Kept tiny and dependency-free. */
export const ICONS = {
  grid: svg(
    `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>` +
      `<rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
  ),
  flask: svg(
    `<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7 16h10"/>`,
  ),
  table: svg(
    `<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>`,
  ),
  layers: svg(`<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>`),
  terminal: svg(
    `<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 9l3 3-3 3M13 15h4"/>`,
  ),
  shield: svg(
    `<path d="M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3z"/><path d="M9 12l2 2 4-4"/>`,
  ),
  gear: svg(
    `<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`,
  ),
  gauge: svg(`<path d="M12 13l4-3"/><path d="M3.5 13a8.5 8.5 0 1 1 17 0"/><circle cx="12" cy="13" r="1.4"/>`),
} as const;

export type IconName = keyof typeof ICONS;

export type NavGroup = "Cockpit" | "Research" | "Operate";

export const NAV_GROUP_ORDER: readonly NavGroup[] = ["Cockpit", "Research", "Operate"];

export interface NavItem {
  readonly id: string;
  readonly label: string;
  /** Intended app route once a real router exists. */
  readonly route: string;
  /** Generated static file (what the sidebar links to today). */
  readonly file: string;
  readonly group: NavGroup;
  readonly icon: IconName;
  readonly description: string;
}

export const NAV: readonly NavItem[] = [
  {
    id: "overview",
    label: "Overview",
    route: "/",
    file: "index.html",
    group: "Cockpit",
    icon: "grid",
    description: "Dashboard cockpit — posture, modes, and where to look next.",
  },
  {
    id: "research",
    label: "Research",
    route: "/research",
    file: "research.html",
    group: "Cockpit",
    icon: "flask",
    description: "The PAPER-only research lab: scenarios, backtests, suites, sensitivity.",
  },
  {
    id: "reports",
    label: "Report viewer",
    route: "/research/reports",
    file: "research-reports.html",
    group: "Research",
    icon: "table",
    description: "Inspect locally-generated backtest report artifacts (viewer foundation).",
  },
  {
    id: "matrix",
    label: "Sensitivity matrix",
    route: "/research/matrix",
    file: "research-matrix.html",
    group: "Research",
    icon: "grid",
    description: "Cross-scenario sensitivity matrix viewer (foundation).",
  },
  {
    id: "coverage",
    label: "Suite coverage",
    route: "/research/coverage",
    file: "research-coverage.html",
    group: "Research",
    icon: "layers",
    description: "Which simulated paper paths a backtest suite exercised (foundation).",
  },
  {
    id: "commands",
    label: "Command reference",
    route: "/commands",
    file: "commands.html",
    group: "Operate",
    icon: "terminal",
    description: "The real CLI workflows that produce these local artifacts.",
  },
  {
    id: "safety",
    label: "Safety & modes",
    route: "/safety",
    file: "safety.html",
    group: "Operate",
    icon: "shield",
    description: "The wallet-safety model, modes, and hard guarantees.",
  },
  {
    id: "settings",
    label: "Settings",
    route: "/settings",
    file: "settings.html",
    group: "Operate",
    icon: "gear",
    description: "Local display preferences (placeholder shell).",
  },
];

/** Nav items in a given group, in declared order. */
export function navByGroup(group: NavGroup): NavItem[] {
  return NAV.filter((item) => item.group === group);
}

/** Look up a nav item by id; throws on unknown id (build-time invariant). */
export function navItem(id: string): NavItem {
  const found = NAV.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown nav id: ${id}`);
  }
  return found;
}
