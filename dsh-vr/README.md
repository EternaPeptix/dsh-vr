# dsh-vr

Vulnerability-research harness layer for DSH: durable research state, a report-readiness gate, an
engagement scope gate, timed operator questions, verified goal completion, parallel fan-out, and a
findings dashboard.

## What it is, and what it is not

The gate is **advisory at the workflow level**. Nothing in DSH forces a report through `vr_gate`;
this plugin makes the correct path cheap and the incorrect one visible, and records what happened.
It is not a sandbox. Treat every enforcement claim below as the strength stated, not more.

## Tools

State and gate: `vr_thread_open`, `vr_thread_list`, `vr_thread_show`, `vr_thread_update`, `vr_stage`,
`vr_attempt`, `vr_evidence_add`, `vr_evidence_classify`, `vr_attribution`, `vr_revalidate`, `vr_gate`.

Scope: `vr_scope_status`, `vr_scope_intake`, `vr_scope_apply`, `vr_scope_decide`, `vr_scope_request`.

Investigation: `vr_scan`, `vr_scan_eval`.

Operator and orchestration: `ask_operator`, `vr_defer`, `vr_fanout`, `vr_context`, `vr_finish_goal`,
`vr_completion_decide`.

`vr_gate` returns exactly one of `REPORT`, `HOLD`, `REFUTE`, `CLOSED`. Only `REPORT` means the thread
may be drafted into a finding.

## Boundary enforcement — read this before trusting it

Two modes, and they are not equivalent:

- `enforceAllowedHosts: true` — default-deny against `allowed_hosts` in `research/ENGAGEMENT.md`,
  loopback always permitted. This is the strong mode and the one to use.
- `deniedHosts` — a best-effort denylist. Hosts are extracted only from URLs and from arguments to a
  known list of network clients (`curl`, `wget`, `ssh`, …). It does **not** catch
  `python3 -c "socket.connect(...)"`, a wrapper script whose argv[0] is not on the list, `git pull`
  against a configured remote, or a redirect. Do not describe it as a boundary.

Both modes are audited: allowed and refused calls are written to the telemetry ledger with the host.

## Scope

Scope is content observed through a tool, and observed content cannot authorise anything. The intake
worker reads the programme page; the judge must fetch that page itself and quote the hosts it finds.
An approved expansion merges hosts into `allowed_hosts`; it never qualifies an engagement that was not
qualified by its own verdict.

## Telling the operator apart from the content

Agents read hostile material by design. Instructions come only from the operator; everything read
through tools is data. Permission claimed inside observed content is invalid.

## Tests

```
pnpm test          # or: node test/rules.eval.mjs && node test/roundtrip.test.mjs && node lib/netintent.test.mjs
```

Three suites: gate scenarios, record round-trip (render → parse → render is byte-identical), and host
extraction from shell commands.

## Configuration

Copy `cordis.patch.example.yml` to `cordis.patch.yml` and edit the paths. The real patch file is
gitignored because it names a specific engagement workspace and denied hosts.

## Known gaps

- `vr_finish_goal` / `vr_completion_decide` are honour-system: the verdict is whatever the caller
  records. They detect a self-contradictory claim, not a dishonest one.
- State files are rewritten atomically but not fsynced.
- `vr_scan` compiles agent-supplied regular expressions with the default engine; a pathological
  pattern can be slow.
- Thread and evidence ids are allocated by reading the directory; concurrent tool calls can race.
