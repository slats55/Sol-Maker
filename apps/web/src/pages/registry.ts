/**
 * Page registry: the single list the generator and tests both iterate, so the
 * sidebar, the generated files, and the test coverage can never drift apart.
 */

import type { RawHtml } from "../lib/html.js";
import { navItem, type NavItem } from "../lib/nav.js";
import { renderOverview } from "./overview.js";
import { renderResearch } from "./research.js";
import { renderReports } from "./reports.js";
import { renderMatrix } from "./matrix.js";
import { renderCoverage } from "./coverage.js";
import { renderArtifact } from "./artifact.js";
import { renderFolder } from "./folder.js";
import { renderCommands } from "./commands.js";
import { renderSafety } from "./safety.js";
import { renderSettings } from "./settings.js";

export interface PageDef {
  readonly nav: NavItem;
  readonly render: () => RawHtml;
}

export const PAGES: readonly PageDef[] = [
  { nav: navItem("overview"), render: renderOverview },
  { nav: navItem("research"), render: renderResearch },
  { nav: navItem("reports"), render: renderReports },
  { nav: navItem("matrix"), render: renderMatrix },
  { nav: navItem("coverage"), render: renderCoverage },
  { nav: navItem("artifact"), render: renderArtifact },
  { nav: navItem("folder"), render: renderFolder },
  { nav: navItem("commands"), render: renderCommands },
  { nav: navItem("safety"), render: renderSafety },
  { nav: navItem("settings"), render: renderSettings },
];
