/**
 * @soulmaker/sniper — PAPER-only, offline sniper decision support (Phase 5+).
 *
 * This package builds the safe, deterministic layers a Solana sniper bot needs BEFORE any live
 * capability exists: candidate intake (this sprint), and later a read-only token preflight summary
 * and paper-only sniper decisions. It is **pure and offline**:
 *
 *  - It NEVER builds, signs, simulates, or sends a transaction.
 *  - It holds no secret key, signer, or keypair — there is no such type here.
 *  - It makes no network / RPC call and reads no files (the CLI owns all I/O).
 *  - A candidate "decision" is a PAPER/simulated decision only — never a live trade or order.
 */

export const SNIPER_PACKAGE_PHASE = 5 as const;

export {
  parseMintAddress,
  isValidMintAddress,
  InvalidMintAddressError,
  MAX_MINT_BASE58_LEN,
  MIN_MINT_BASE58_LEN,
} from "./mint-address.js";

export {
  normalizeSniperCandidateList,
  validateSniperCandidateList,
  formatSniperCandidateList,
  SniperCandidateListError,
  SNIPER_CANDIDATE_LIST_SCHEMA_VERSION,
  SNIPER_CANDIDATE_LIST_BANNER,
  SNIPER_CANDIDATE_LIST_DISCLAIMERS,
} from "./candidate-list.js";

export type {
  SniperCandidateInput,
  NormalizeSniperCandidateListInput,
  SniperCandidate,
  SniperCandidateList,
  FormatSniperCandidateListOptions,
} from "./candidate-list.js";

export {
  buildSniperTokenPreflightReport,
  validateSniperTokenPreflightReport,
  formatSniperTokenPreflightReport,
  SniperTokenPreflightReportError,
  SNIPER_TOKEN_PREFLIGHT_REPORT_SCHEMA_VERSION,
  SNIPER_TOKEN_PREFLIGHT_REPORT_BANNER,
  SNIPER_TOKEN_PREFLIGHT_REPORT_DISCLAIMERS,
} from "./token-preflight.js";

export type {
  SniperPreflightCandidateData,
  BuildSniperTokenPreflightReportInput,
  SniperPreflightStatus,
  SniperPreflightInspection,
  SniperPreflightRisk,
  SniperPreflightEntry,
  SniperTokenPreflightReport,
  FormatSniperTokenPreflightReportOptions,
} from "./token-preflight.js";
