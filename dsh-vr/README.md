# dsh-vr — vulnerability-research harness layer

A Host plugin bundle for DeepSeek Harness that adds the components a vulnerability-research
workflow needs and that a generic coding agent does not have:

| Component | What it does | Why it exists |
| --- | --- | --- |
| Research state (`vr_thread_*`) | Durable threads under `research/threads/<id>/index.md` with hypothesis, assessment, evidence links, rejected paths and one next action | Session-local findings are lost at compaction or shutdown, and prose status files grow until nobody can read them |
| Evidence records (`vr_evidence_add`) | One file per atomic check: conditions, request, observed response, separate target-state check | A claim without its conditions and its state check is not reproducible |
| Readiness gate (`vr_gate`) | `REPORT` / `HOLD` / `REFUTE` from linked, complete evidence only | Confidence gets confused with severity; the gate separates "has support" from "has impact" |
| Deterministic scan (`vr_scan`) | One saved question about one source version, with coverage accounting and comparison by `(path, api, expression)` | Counts hide replacements, line numbers move with comments, and zero matches prove nothing without coverage |
| Observe hook (`tools/execute`) | Append-only `research/telemetry/events.jsonl`, written by the harness where the event happens | The agent's own account of what it ran is not a record |
| Enrich hook (`system-prompt/assemble`) | Injects the compact thread table into context at assembly, capped at `enrichMaxLines` | Discovery that depends on the model remembering to ask is not discovery |
| Control hook (`tools/pre-execute`) | Refuses shell/fetch calls naming hosts in `deniedHosts`, before dispatch | A written boundary that nothing enforces is a preference, not a boundary |

State format contract: the workspace file `research/FORMAT.md`. The tools write that format;
the read-only view `bin/vr` parses the same files.

## Tools

- `vr_thread_open`, `vr_thread_list`, `vr_thread_show`, `vr_thread_update`
- `vr_evidence_add`, `vr_gate`
- `vr_scan`

## Config

| key | default | meaning |
| --- | --- | --- |
| `enabled` | `true` | mount the plugin |
| `root` | `research` | state directory, resolved against the session working directory |
| `telemetry` | `true` | append tool telemetry |
| `telemetryMaxBytes` | `8388608` | rotate the ledger once it passes this size |
| `maxFileBytes` | `4194304` | files larger than this are counted as skipped by `vr_scan` |
| `maxEntries` | `5000` | per-run entry cap; exceeding it marks coverage incomplete |
| `enrich` | `true` | inject the research-state table at prompt assembly |
| `enrichMaxLines` | `8` | rows of that table placed in context |
| `deniedHosts` | `""` | comma-separated hosts no shell or fetch call may contact; empty disables the control hook |

## Tests

Two deterministic suites, no model, no network, no filesystem:

```
node harness/dsh-vr/test/rules.eval.mjs      # gate decisions and stage refusals, one scenario each
node harness/dsh-vr/lib/netintent.test.mjs   # boundary guard: intent versus mention
```

Run both after any change to `lib/rules.js` or the guard. Every rule in the gate has a scenario that
would fail if the rule regressed; adding a rule means adding its scenario.

## Skills dependency

The bundle patch also mounts the shipped filesystem skill provider against `research/skills`.
Removing or reinstalling this bundle therefore unmounts the skill catalog too, and it returns when
the bundle is installed again. Skill descriptions containing an unquoted colon make the YAML invalid
and the provider skips that skill silently — quote every description.

## What this plugin does not claim

- It does not find vulnerabilities and does not judge severity or impact.
- `vr_gate` returning `REPORT` says the claim has linked, complete evidence under stated
  conditions. It says nothing about attacker control or blast radius.
- `vr_scan` coverage accounting covers enumerated files only; untracked files, generated code,
  indirect calls and other APIs stay outside the query.

## Install / remove

Installed with the profile's plugin manager from this directory; the bundle patch mounts one row,
`vr-harness`. Removing the bundle removes the row and leaves `research/` untouched.

No Client half and no UI slot are registered, so the bundle ships no icon or locale resources:
there is no surface on which they would render.
