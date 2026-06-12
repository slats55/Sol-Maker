/**
 * PAPER dry-run folder overview (Sprint 89).
 *
 * A `paper:sniper:dry-run` output folder is recognized by the presence of a
 * valid `phase6.operator.bundle.v1` artifact — the bundle IS the run's own
 * machine-readable index (verdict, per-role file integrity, blocking codes,
 * narratives), so the overview is read straight from it and NOTHING is
 * re-derived, inferred from filenames, or invented. Every field is read
 * defensively (absent/mistyped values become `null` or empty lists, never
 * fabricated), every list is capped, and the module is pure: no filesystem,
 * no network, no DOM.
 */

import { asArray, asRecord, readBoolean, readString, readStringArray, type StringListRead } from "./json-access.js";
import type { FolderArtifactEntry, FolderIndex } from "./folder-index.js";

/** The operator bundle schema id this overview reads (and nothing else). */
export const DRY_RUN_BUNDLE_SCHEMA = "phase6.operator.bundle.v1";

/** Hard cap on rendered chain roles (a real bundle carries 13). */
const MAX_ROLES = 24;

/** One chain role's file-backed state, read verbatim from the bundle. */
export interface DryRunRoleStatus {
  readonly role: string;
  /** File name recorded by the bundle for this role; `null` when missing. */
  readonly fileName: string | null;
  /** Truncated integrity digest recorded by the bundle; `null` when missing. */
  readonly digest: string | null;
  readonly state: "valid" | "invalid" | "missing";
  /** Same-page anchor of the matching scanned artifact, when the file is in this folder. */
  readonly anchor: string | null;
}

/** The landing overview for a recognized dry-run folder. */
export interface DryRunOverview {
  /** Filename of the operator bundle artifact the overview was read from. */
  readonly bundleName: string;
  /** Same-page anchor of the bundle's own artifact section. */
  readonly bundleAnchor: string;
  readonly operatorVerdict: string | null;
  readonly bundleLabel: string | null;
  readonly operatorLabel: string | null;
  readonly complete: boolean | null;
  readonly blockingTrailConsistent: boolean | null;
  readonly routeResolutionStatus: string | null;
  readonly routeResolverAttempted: boolean | null;
  /** The readiness verdict carried VERBATIM by the bundle (never recomputed here). */
  readonly simulationReadyPerReadiness: boolean | null;
  readonly chainBlockingCodes: StringListRead;
  readonly whyBlocked: StringListRead;
  readonly whatHappened: string | null;
  readonly whatToInspectNext: StringListRead;
  readonly roles: readonly DryRunRoleStatus[];
  /** How many roles the cap hid (0 for any real bundle). */
  readonly rolesHidden: number;
  readonly validRoleCount: number;
  readonly invalidRoleCount: number;
  readonly missingRoleCount: number;
  /** Whether the scanned folder also carries the run's RUN_SUMMARY.md. */
  readonly hasRunSummary: boolean;
}

/** The closed verdict set a bundle can carry (anything else renders as unrecognized). */
export const DRY_RUN_VERDICTS = ["reviewable-paper-only", "blocked", "attention", "incomplete"] as const;

/**
 * The per-status route explanation (mirrors the CLI's honest wording).
 * Unknown statuses get the generic boundary statement — never a made-up state.
 */
export function routeStatusExplanation(status: string | null): string {
  switch (status) {
    case "unavailable":
      return "Expected — no route resolver exists inside the simulation boundary; nothing was faked.";
    case "blocked":
      return "The intent plan is blocked, so no resolution was attempted.";
    case "no_entries":
      return "Watch-only plan — there was nothing to resolve.";
    case "resolved":
      return "Resolved provenance is recorded; the live-state caveat applies (still PAPER only).";
    default:
      return "Honest boundary — no route-resolver capability exists; nothing was invented.";
  }
}

/** Find the artifact entry the overview is read from: the first VALID operator bundle. */
function findBundleEntry(index: FolderIndex): FolderArtifactEntry | null {
  for (const entry of index.artifacts) {
    if (entry.status === "valid" && entry.schemaVersion === DRY_RUN_BUNDLE_SCHEMA) return entry;
  }
  return null;
}

/** Read the per-role states, zipping the bundle's `artifacts` and `files` arrays by role. */
function readRoles(bundle: Record<string, unknown>, index: FolderIndex): {
  roles: DryRunRoleStatus[];
  hidden: number;
} {
  const artifactRows = asArray(bundle["artifacts"]) ?? [];
  const fileRows = asArray(bundle["files"]) ?? [];
  const fileByRole = new Map<string, Record<string, unknown>>();
  for (const row of fileRows) {
    const rec = asRecord(row);
    const role = rec === null ? null : readString(rec, "role");
    if (rec !== null && role !== null) fileByRole.set(role, rec);
  }
  const anchorByName = new Map<string, string>();
  for (const entry of index.artifacts) {
    if (entry.status === "valid") anchorByName.set(entry.name, entry.anchor);
  }

  const roles: DryRunRoleStatus[] = [];
  for (const row of artifactRows.slice(0, MAX_ROLES)) {
    const rec = asRecord(row);
    if (rec === null) continue;
    const role = readString(rec, "role");
    if (role === null) continue;
    const present = readBoolean(rec, "present");
    const valid = readBoolean(rec, "valid");
    const file = fileByRole.get(role) ?? null;
    const fileName = file === null ? null : readString(file, "fileName");
    roles.push({
      role,
      fileName,
      digest: file === null ? null : readString(file, "digest"),
      state: present === true ? (valid === true ? "valid" : "invalid") : "missing",
      anchor: fileName !== null ? (anchorByName.get(fileName) ?? null) : null,
    });
  }
  return { roles, hidden: Math.max(0, artifactRows.length - roles.length) };
}

/**
 * Build the dry-run landing overview from an already-built folder index, or
 * return `null` when the folder carries no valid operator bundle (the page
 * then renders exactly as before — this never degrades a generic folder).
 */
export function buildDryRunOverview(index: FolderIndex): DryRunOverview | null {
  const entry = findBundleEntry(index);
  if (entry === null) return null;
  const bundle = asRecord(entry.raw);
  if (bundle === null) return null;

  const { roles, hidden } = readRoles(bundle, index);

  return {
    bundleName: entry.name,
    bundleAnchor: entry.anchor,
    operatorVerdict: readString(bundle, "operatorVerdict"),
    bundleLabel: readString(bundle, "bundleLabel"),
    operatorLabel: readString(bundle, "operatorLabel"),
    complete: readBoolean(bundle, "complete"),
    blockingTrailConsistent: readBoolean(bundle, "blockingTrailConsistent"),
    routeResolutionStatus: readString(bundle, "routeResolutionStatus"),
    routeResolverAttempted: readBoolean(bundle, "routeResolverAttempted"),
    simulationReadyPerReadiness: readBoolean(bundle, "simulationReadyPerReadiness"),
    chainBlockingCodes: readStringArray(bundle, "chainBlockingCodes"),
    whyBlocked: readStringArray(bundle, "whyBlocked"),
    whatHappened: readString(bundle, "whatHappened", 600),
    whatToInspectNext: readStringArray(bundle, "whatToInspectNext"),
    roles,
    rolesHidden: hidden,
    validRoleCount: roles.filter((r) => r.state === "valid").length,
    invalidRoleCount: roles.filter((r) => r.state === "invalid").length,
    missingRoleCount: roles.filter((r) => r.state === "missing").length,
    hasRunSummary: index.skipped.some((s) => s.name === "RUN_SUMMARY.md"),
  };
}
