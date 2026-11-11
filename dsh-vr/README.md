# dsh-vr

A vulnerability-research harness layer for [DeepSeek Harness](https://github.com/deepseek-ai). It turns
an engagement into durable, checkable state: threads, executed evidence, scope that had to be judged
before anything ran, a report-readiness gate, timed operator questions, completion that a second agent
has to approve, and a read-only findings dashboard.

It is a research instrument, not a scanner. It does not find bugs; it makes the difference between a
finding and a note visible while there is still time to fix it.

Status: pre-release, tagged `v0.1.0`, not published to a registry.

## What it is, and what it is not

The gate is **advisory at the workflow level**. Nothing in DSH forces a report through `vr_gate`; this
plugin makes the correct path cheap and the incorrect one visible, and records what happened. It is not
a sandbox and does not confine the agent it observes. Every enforcement claim below is stated at the
strength the code actually has.

## Requirements

- Node 20 or newer.
- A DSH profile where the plugin can be loaded as a bundle.
- No network access is needed to install or test it.

## Install

The bundle is a Cordis plugin. Point a profile at this directory and let the patch file configure it:

```sh
ln -s /path/to/dsh-vr ~/.dsh/profiles/<profile>/node_modules/dsh-vr
cp cordis.patch.example.yml ~/.dsh/profiles/<profile>/cordis.patch.yml
```

Then edit `cordis.patch.yml`: `root`, an absolute `enrichRoot`, your denied hosts, and whether
`enforceAllowedHosts` is on. The real patch file is gitignored because it names one engagement
workspace and that engagement's hosts.

Restart the Host after changing plugin code. The Host imports the module once per process, so edits on
disk do not take effect in a running session.

## Quick start

The intended shape of a session:

1. Operator supplies a programme or scope-page URL.
2. `vr_scope_intake` writes a provisional `research/ENGAGEMENT.md` and returns a brief.
3. That brief goes to one subagent verbatim; it reads the page and calls `vr_scope_apply`.
4. The brief returned by `vr_scope_apply` goes to a different subagent, the judge, which fetches the
   page itself and answers with `Hosts read on the page: ...`.
5. `vr_scope_decide` records the verdict. Only approval sets `confirmed: true`.
6. Research opens one thread per experiment with `vr_thread_open`.
7. Evidence is recorded with `vr_evidence_add`, the thread advances through `vr_stage`, and `vr_gate`
   decides whether it may be reported.

Until the scope is qualified the tool refuses to open threads. That refusal is the point: an
unqualified scope is an unauthorised engagement.

## Tools

State and gate: `vr_thread_open`, `vr_thread_list`, `vr_thread_show`, `vr_thread_update`, `vr_stage`,
`vr_attempt`, `vr_evidence_add`, `vr_evidence_classify`, `vr_attribution`, `vr_revalidate`, `vr_gate`,
`vr_repair`.

Scope: `vr_scope_status`, `vr_scope_intake`, `vr_scope_apply`, `vr_scope_decide`, `vr_scope_request`.

Investigation: `vr_scan`, `vr_scan_eval`.

Operator and orchestration: `ask_operator`, `vr_defer`, `vr_fanout`, `vr_context`, `vr_finish_goal`,
`vr_completion_decide`.

`vr_gate` returns exactly one of `REPORT`, `HOLD`, `REFUTE`, `CLOSED`. Only `REPORT` means the thread
may be drafted into a finding, and a gate pass says the claim has support under stated conditions — it
says nothing about severity.

## The research state

Everything lives under `research/` in the engagement workspace:

- `ENGAGEMENT.md` — scope, allowed hosts, decisions. Written only by the scope tools.
- `threads/<id>/index.md` — one experiment: question, hypothesis, scope, assessment, evidence links,
  attribution, revalidation, attempts.
- `threads/<id>/evidence/E-NNN.md` — one atomic check: conditions, request, observed response, a
  separate state check, limitations, hashed artifacts.
- `threads/INDEX.md` — derived; regenerated after every write.
- `DEFERRALS.md` — obstacles recorded instead of ending a goal.
- `telemetry/events.jsonl` — harness output. Never evidence, never to be pasted into a report.

Sections are fenced when written and unwrapped when read, so captured output that contains `##` cannot
forge a heading. Unknown frontmatter keys are preserved rather than dropped.

The pipeline is a pipeline, not a menu:

```
candidate → validated → assessed → ready
```

Each stage refuses an advance whose artifact does not exist. `validated` needs an executed evidence
record (`kind: execution`, with a tier); static reasoning alone cannot get there.

## Scope

Scope is content observed through a tool, and observed content cannot authorise anything. The judge
must fetch the programme page itself and name the hosts it read there. Approval is refused unless
every host in `allowed_hosts` is covered by that list, so an injected instruction has to survive being
repeated consistently in two tools, in a list the researcher can diff against the page.

An approved expansion merges only the requested hosts, and never qualifies an engagement that was not
qualified by its own verdict. Intake refuses to overwrite an engagement that is already qualified
unless called with `force: true`, which archives the previous file first.

`ENGAGEMENT.md` is written from text copied off a programme page, so none of that text is allowed to
become structure. Every frontmatter value is folded to one line (LF, CR, CRLF, U+2028, U+2029, NEL and
the other control characters), which is what keeps a field from carrying its own `confirmed: true`.
Free text in a section has any line that would read as a heading, a title or a code fence escaped
with a backslash. A scope entry must be one bare host — `acme.test`, `*.acme.test`, `acme.test:8443`,
an IP literal — and anything else is refused rather than repaired, so the judge is never shown a
different string from the one that was stored. An expansion merges only the hosts on the request's
own leading `requested host:` lines, not hosts its justification or evidence text mentions.

## Boundary enforcement — read this before trusting it

Two modes, and they are not equivalent:

- `enforceAllowedHosts: true` — default-deny against `allowed_hosts`, loopback permitted, and the
  programme page itself reachable so the judge can read it. An engagement that is not `confirmed: true`
  permits nothing beyond loopback and that page. This is the strong mode.
- `deniedHosts` — a best-effort denylist over URLs and the arguments of known network clients at a
  command position, including after wrappers such as `sudo`, `time` or `xargs`, and inside `$( )`.

Neither mode intercepts every egress path. `python3 -c`, a program that builds its own request, or
`git pull` against a configured remote are not covered. Both modes are audited: allowed and refused
calls are written to the telemetry ledger with the host.

The check runs before the request is sent. An HTTP redirect is followed afterwards, so an allowed host
that redirects to a denied one is reached; DNS resolves afterwards, so a denied host named by IP
address or through a CNAME is not recognised. Only a network-level egress control closes that class,
and this plugin is not one.

A refusal is recorded, not announced. If it matters, it is in the ledger.

## Completion

`update_goal action=complete` is refused. `vr_finish_goal` records a claim, fingerprints the named
artifacts, and returns a brief for an independent verifier whose verdict is recorded with
`vr_completion_decide`. The claim is bound to the goal it was made about: a verdict about a different
goal, an expired claim, or an artifact that changed after the claim is refused rather than applied.
A rejection leaves the goal active.

Attestation is a consistency check, not proof: an executed evidence record names the session that wrote
it, and `vr_gate` reports a caveat when that session shows no execution-capable tool call that finished
before the record was written.

## Findings dashboard

A read-only panel in the Harness Web UI lists threads grouped by engagement, with gate decisions,
blocking-rule frequency, unlinked evidence files, and a manual refresh that shows when it last
succeeded. It refuses requests whose `Host` or `Origin` is not loopback, which closes the
DNS-rebinding path to engagement data. It has no authentication: if you put a tunnel in front of it,
name the tunnel host in `dashboardAllowHosts` and add your own access control there. A Hide findings
toggle blurs question text for screen sharing.

## Configuration

Defaults are in `lib/index.js`. The ones that change behaviour:

- `root`, `enrichRoot` — where state lives, and where the prompt-time summary is read from.
- `enforceAllowedHosts`, `deniedHosts`, `referenceHosts`, `allowLoopback`, `guardedTools`.
  `referenceHosts` exempts only the fetch tool, never shell.
- `executionTools` — which tool names count as running the target when attesting evidence.
- `questionTimeoutSeconds`, `redirectQuestionTool` — operator questions settle as UNANSWERED instead
  of hanging.
- `goalBlockPolicy`, `goalDiscipline` — model-initiated goal blocks are refused.
- `maxActiveThreads`, `fanoutCeiling` — attention limits; `research/ENGAGEMENT.md` may set a lower
  ceiling for one engagement.
- `maxAttempts`, `maxEntries`, `maxFileBytes`, `deferralsMaxEntries` — give-up, size and retention
  bounds.
- `completionClaimMinutes`, `minReportTier`, `requireExecutionAttestation` — stricter gate behaviour.
- `dashboardAllowHosts`, `dashboardCacheMs`, `telemetry`, `telemetryMaxBytes`.

Config values are typed but not validated against what the code expects: a typo such as
`goalBlockPolicy: nevr`, or an unknown `minReportTier`, changes or disables the rule instead of being
rejected at load time.

## Tests

```sh
npm test
```

Five suites:

- gate scenarios, including the refusal cases that must never become `REPORT`;
- record round-trip, where render → parse → render must be byte-identical;
- regressions for record-integrity, scope grounding, completion binding and placeholder handling;
- host extraction from shell commands, including the forms that must be denied and the prose that must
  not be;
- a load test that imports the real plugin entry point against stubbed Harness packages, so a tool that
  fails to register or a config key that does not exist fails here instead of at startup.

Run them after any change to `lib/`. They are fast and they catch the class of mistake that is
otherwise invisible until a Host refuses to start.

## Repository layout

```
lib/index.js        tools, guards, telemetry, dashboard route
lib/rules.js        pure gate and parsing rules, shared by tools and tests
client.js           findings dashboard panel (web client half)
test/               five suites and the stubs the load test needs
cordis.patch.example.yml   configuration template
SECURITY.md         threat model and known weaknesses
CHANGELOG.md        what changed, including the reasoning
```

## Residual risk

The gate verifies records, not reality. Nothing stops an agent that wants a `REPORT` from writing a
convincing evidence record claiming execution with an invented observed response. What exists is a
chain of consistency checks: the record names a session, that session must show an execution call
before the record, cited artifacts are hashed at record time, attribution must cite executed evidence,
revalidation must name the revision it was checked against, and completion claims are bound to their
goal. Each raises the cost of a false claim; none observes the target.

## Known gaps

These are real and unfixed as of this commit:

- `ENGAGEMENT.md` is an ordinary file in the workspace. The scope tools can no longer be steered into
  writing `confirmed: true`, but an agent with a shell or a file-write tool can still write it
  directly: nothing binds the stored verdict to the judge that gave it, and the boundary guard reads
  the same file. Until the verdict is signed or kept outside the agent's reach, a qualified scope
  means "the file says so", not "a judge said so".
- Thread and evidence ids are allocated by reading the directory; concurrent tool calls can race and
  both claim the same id.
- `vr_evidence_classify`, `vr_attempt`, `vr_attribution` and `vr_revalidate` still accept writes to
  terminal threads in some paths.
- Reopening restores the stage to `assessed` regardless of where the thread stopped.
- `vr_scan` compiles agent-supplied regular expressions with the default engine; a pathological pattern
  can block the event loop.
- Scan coverage counts skipped directories inconsistently, and `$` anchors do not match CRLF files.
- Completion claims share one pending file per workspace, not one per agent.
- Prompt-time enrichment includes agent-written text; it is data, but it appears in the prompt.
- The boundary guard refuses at dispatch time only; redirects and DNS resolution happen afterwards.

If any of these matters for an engagement you are running, record it with `vr_defer` rather than
working around it silently.
