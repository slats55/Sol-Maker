# Chrome Extension Companion — Design Note (NOT built)

Status: **design only.** No extension app/package exists in this repo and none
is created by this foundation. This note records the *intended* safe shape so a
future sprint starts from the right constraints. Do not build it until the
dashboard foundation is mature and a dedicated, reviewed sprint is opened.

The dashboard is the priority. The extension is an optional, lightweight
*companion* — never a trading surface.

## Product role

```text
Backend engine = brain · CLI = admin · Web dashboard = cockpit
Chrome extension = a thin, read-only "see this token in Soulmaker" helper
```

## Good (allowed) future uses

- Capture the current token **mint / page URL** the user is looking at.
- "Open in Soulmaker dashboard" — deep-link the mint into the (local) dashboard.
- Send page **context** to the backend **only after an explicit user action**.
- Show a **read-only risk badge** sourced from the existing advisory risk engine.

All of the above are read-only, user-initiated, and hold no secrets.

## Hard rejections (must never be built)

- ❌ Holding wallet keys, seeds, or any secret material.
- ❌ Connecting the operator's main wallet.
- ❌ Signing or sending transactions; any transaction building/planning.
- ❌ Executing trades or auto-trading in the background.
- ❌ Bypassing any dashboard or backend safety gate.
- ❌ Storing secrets in extension storage, or exfiltrating page data silently.

These mirror [`SECURITY.md`](../SECURITY.md) and
[`WALLET_SAFETY_MODEL.md`](WALLET_SAFETY_MODEL.md): the adversary includes the
software itself, so a browser surface must stay read-only and key-free.

## Constraints for the eventual build

- Minimum permissions (prefer `activeTab` + explicit user gesture over broad
  host permissions). No persistent background trading.
- No secret storage of any kind; the extension never sees a private key/seed.
- Talks to a **local** dashboard/backend the user runs; no third-party trading
  or data provider calls baked in.
- Every network/handoff action is explicit and user-initiated, shown before it
  happens — never silent.
- Ships with the same redaction posture as the rest of the project.

## Why later, not now

- The dashboard (cockpit) must exist and stabilize first.
- An extension adds a new trust surface and a new build/dependency footprint; it
  deserves its own security-reviewed sprint, not a side effect of UI work.

When that sprint happens, start from this note's allowed/rejected lists and add
an entry to the roadmap and the safety docs before writing any extension code.
