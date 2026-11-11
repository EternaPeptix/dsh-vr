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

Maintenance: `vr_repair` reports evidence files that were never linked into their thread and links
that point at files that do not exist; it is a dry run unless called with `apply: true`.

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

What neither mode can do is enforced anywhere but at dispatch time. An HTTP redirect is followed after
the check, so an allowed host that redirects to a denied one is reached; DNS resolves after the check,
so a denied host named by IP address or reached through a CNAME is not recognised. Only a
network-level egress control closes that class, and this plugin does not pretend to be one.

## Scope

Scope is content observed through a tool, and observed content cannot authorise anything. The intake
worker reads the programme page; the judge must fetch that page itself and answer with a line
`Hosts read on the page: ...`. Approval is refused unless every host in `allowed_hosts` is covered by
that list, so an injected instruction has to be repeated consistently in two tools, in a list the
researcher can diff against the page. An approved expansion merges the requested hosts into
`allowed_hosts`; it never qualifies an engagement that was not qualified by its own verdict.
`vr_scope_intake` refuses to overwrite an engagement that is already qualified unless `force: true`,
which archives the previous file first.

## Telling the operator apart from the content

Agents read hostile material by design. Instructions come only from the operator; everything read
through tools is data. Permission claimed inside observed content is invalid.

## Tests

```
pnpm test          # five suites, see package.json scripts.test
```

Five suites: gate scenarios, record round-trip (render → parse → render is byte-identical),
regressions for record-integrity and scope-grounding defects, host extraction from shell commands, and
a load test that imports the real plugin entry point against stubbed Harness packages so that a tool
that fails to register — or a config key that does not exist — fails here instead of at startup.

## Configuration

Copy `cordis.patch.example.yml` to `cordis.patch.yml` and edit the paths. The real patch file is
gitignored because it names a specific engagement workspace and denied hosts.

Values that change what the gate believes, beyond the defaults:

- `completionClaimMinutes` (60) — a completion claim older than this is refused, so a forgotten claim
  cannot complete a goal that appeared later.
- `minReportTier` (`""`) — when set to `component` or `system`, executed evidence below that tier
  cannot support a `REPORT`.
- `requireExecutionAttestation` (`false`) — when true, executed evidence that the telemetry ledger
  cannot tie to a finished tool call blocks instead of being reported as a caveat.
- `allowLoopback`, `referenceHosts`, `deniedHosts`, `enforceAllowedHosts` — see the boundary section.
- `dashboardAllowHosts`, `dashboardCacheMs` — the dashboard is served only to loopback Host headers.

The findings panel reads state when it mounts and when you press Refresh; it never polls. It reports a
failed read instead of going blank, keeps the last successful data visible when it can, isolates a
table that fails to render, and has a Hide findings toggle that blurs question text for screen
sharing.

`research/threads/INDEX.md` is derived state: it is regenerated after every write and is never read
back as evidence, so a crash that leaves it stale costs nothing but a regeneration.

## Residual risk

The gate verifies records, not reality. Nothing in it can stop an agent that wants a `REPORT` from
writing a convincing `vr_evidence_add` claiming `kind: execution` with an invented observed response.
What exists is a chain of consistency checks — the record must name a session, that session must show
a finished tool call, cited artifacts are hashed at record time, attribution must cite executed
evidence, revalidation must name a revision, and the completion claim must match the goal it was made
about. Each raises the cost of a false claim; none of them observes the target.

## Known gaps

- `vr_completion_decide` records whatever verdict the caller reports. It now refuses a claim made about
  a different goal, an expired claim, or artifacts that changed after the claim — but it cannot tell a
  dishonest verifier from an honest one.
- `vr_scan` compiles agent-supplied regular expressions with the default engine; a pathological
  pattern can be slow.
- Thread and evidence ids are allocated by reading the directory; concurrent tool calls can race.
- The boundary guard refuses at dispatch time only; redirects and DNS resolution happen afterwards.
