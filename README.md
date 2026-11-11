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

Then edit `cordis.patch.yml`: `root`, an absolute `enrichRoot`, your denied hosts, whether
`enforceAllowedHosts` is on, and `journalKeyFile` if the journal key should live somewhere other than
`~/.dsh-vr/journal.key`. The real patch file is gitignored because it names one engagement
workspace and that engagement's hosts.

Restart the Host after changing plugin code. The Host imports the module once per process, so edits on
disk do not take effect in a running session.

## Quick start

The intended shape of a session:

1. Operator supplies a programme or scope-page URL.
2. `vr_scope_intake` records a provisional, unqualified engagement and returns a brief.
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

The state is one file: `research/journal.jsonl`. Each line is one tool call's changes — typed
records for the engagement, threads, evidence, deferrals and completion claims — and the state is
what the lines add up to. Nothing is ever parsed back out of prose.

- A thread's evidence list, an evidence record's kind, tier and artifact hashes, an engagement's
  allowed hosts and its `confirmed` flag are fields. Text supplied by the agent, or copied off a
  target, is stored as a string in a field and cannot turn into a heading, a key or a verdict.
- One tool call is one entry, appended under a lock: an evidence record and the link to it are
  written together or not at all. Writing tools run one at a time, and a write that finds the journal
  changed underneath it by another process is refused rather than applied, so an id is never handed
  out twice.
- Each line carries an HMAC over its content and the previous line's seal, keyed by a file outside the
  research directory (`~/.dsh-vr/journal.key`, or `journalKeyFile`). A line that was edited, removed,
  reordered or added without the key fails verification, and so does a journal that ends earlier than
  the position this machine last wrote, or that was deleted.
- A journal that fails verification is refused whole: no tool reads or writes it, no scope counts as
  qualified, and the host guard permits nothing beyond loopback. The refusal names the line.

The Markdown under `research/` is still there, for people:

- `ENGAGEMENT.md`, `threads/<id>/index.md`, `threads/<id>/evidence/E-NNN.md`, `threads/INDEX.md` and
  `DEFERRALS.md` are **generated views**: after each entry, the ones it touched are rewritten.
  Nothing reads them. Editing one changes nothing, and the next write to that record overwrites the
  edit; `vr_repair apply: true` rewrites all of them.
- `telemetry/events.jsonl` is harness output, as before. Never evidence, never to be pasted into a
  report.

Operator commands, none of which the plugin runs itself:

```sh
node tools/journal.mjs verify research      # every line and its seal
node tools/journal.mjs render research      # rewrite every Markdown view
node tools/journal.mjs reseal research      # accept the journal as it stands; keeps a copy first
node tools/journal.mjs import research      # one-off: state written before the journal existed
node tools/vr.mjs --root research list      # read-only: list, show, gate, stages, telemetry, decisions
```

A directory that holds Markdown state from before the journal and no journal is refused until it has
been imported once; `import --dry-run` reports what would be written. `tools/vr.mjs` reads the journal
the way the plugin does and never writes: no key is created, no lock is taken, no view is refreshed.

What the seal is worth is stated under [Residual risk](#residual-risk). Back the key up with the
journal: a journal without its key cannot be verified, only resealed.

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
unless called with `force: true`, which keeps the previous engagement in the journal's history and
as an `ENGAGEMENT.<timestamp>.md` view.

Scope text is copied off a programme page, so none of it is allowed to become structure. It is stored
as fields: only `vr_scope_decide` sets the `confirmed` flag to true, the allowed hosts are
a list, and a pending expansion's hosts are the request's own list rather than lines found in its
justification. A scope entry must be one bare host — `acme.test`, `*.acme.test`, `acme.test:8443`, an
IP literal — and anything else is refused rather than repaired, so the judge is never shown a
different string from the one that was stored. The generated `ENGAGEMENT.md` still folds every value to
one line and escapes lines that would read as headings or fences, so the view reads the way the
record is.

## Boundary enforcement — read this before trusting it

Two modes, and they are not equivalent:

- `enforceAllowedHosts: true` — default-deny against `allowed_hosts`, loopback permitted, and the
  programme page itself reachable so the judge can read it. An engagement that is not confirmed
  permits nothing beyond loopback and that page, and a journal that cannot be read or fails
  verification permits nothing beyond loopback. This is the strong mode.
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

`update_goal action=complete` is refused. `vr_finish_goal` records a claim in the journal, fingerprints
the named artifacts, and returns a brief for an independent verifier whose verdict is recorded with
`vr_completion_decide`. There is one pending claim per goal, and it is bound to that goal: a verdict
about a different goal, an expired claim, or an artifact that changed after the claim is refused
rather than applied. A rejection leaves the goal active.

Attestation is a consistency check, not proof: an executed evidence record names the session that wrote
it, and whether that session had finished an execution-capable tool call is decided when the record is
written and stored with it. `vr_gate` reports an unattested record as a caveat, and that answer does
not change when the telemetry ledger later rotates.

## Findings dashboard

A read-only panel in the Harness Web UI lists threads grouped by engagement, with gate decisions,
blocking-rule frequency, unlinked evidence records, and a manual refresh that shows when it last
succeeded. It refuses requests whose `Host` or `Origin` is not loopback, which closes the
DNS-rebinding path to engagement data. It has no authentication: if you put a tunnel in front of it,
name the tunnel host in `dashboardAllowHosts` and add your own access control there. A Hide findings
toggle blurs question text for screen sharing.

## Configuration

Defaults are in `lib/index.js`. The ones that change behaviour:

- `root`, `enrichRoot` — where state lives, and where the prompt-time summary is read from.
- `journalKeyFile` — the key that seals the journal. Default `~/.dsh-vr/journal.key`, created on the
  first write. Keep it outside the workspace the agent works in.
- `enforceAllowedHosts`, `deniedHosts`, `referenceHosts`, `allowLoopback`, `guardedTools`.
  `referenceHosts` exempts only the fetch tool, never shell.
- `executionTools` — which tool names count as running the target when attesting evidence.
- `questionTimeoutSeconds`, `redirectQuestionTool` — operator questions settle as UNANSWERED instead
  of hanging.
- `goalBlockPolicy`, `goalDiscipline` — model-initiated goal blocks are refused.
- `maxActiveThreads`, `fanoutCeiling` — attention limits; the engagement record may set a lower
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

Six suites:

- gate scenarios, including the refusal cases that must never become `REPORT`;
- view round-trip, where render → parse → render must be byte-identical. The parser lives only in the
  importer now; this keeps the views and the importer honest about each other;
- regressions for record-integrity, scope grounding, completion binding and placeholder handling;
- the one-off import, against a directory shaped like the early ones: a title held only in a thread's
  link text, artifact lines with and without a hash, a record the thread never linked, and the two
  refusals that stop a directory being imported twice;
- host extraction from shell commands, including the forms that must be denied and the prose that must
  not be;
- a load test that imports the real plugin entry point against stubbed Harness packages and drives
  the tools and hooks: a tool that fails to register or a config key that does not exist fails here
  instead of at startup, and so does a tool that stops keeping the journal's rules — an edited,
  truncated, replaced or deleted journal, ids allocated at once, a thread walked from open to
  `REPORT`, a scope steered by the text it records, the host guard under each of those. State is
  read back from the journal file with the key, never from the generated Markdown.

The load test runs against stubs of the two Harness packages, and the stubs accept almost anything.
To run it against the packages the Host itself loads:

```sh
DSH_PACKAGE_ROOT=<directory whose node_modules holds @deepseek-ai/> npm run test:real
```

For the desktop app that directory is `Contents/Resources/app.asar/dsh` inside the app, and the test
has to run under the app's own runtime (`Contents/Resources/runtime/bin/node`), which can read inside
the archive. The real `defineTool` checks arguments against each tool's schema, so this is the run
that catches a required argument the stubs let through.

Run them after any change to `lib/`. They are fast and they catch the class of mistake that is
otherwise invisible until a Host refuses to start.

## Repository layout

Paths are relative to `dsh-vr/`.

```
lib/index.js        tools, guards, telemetry, dashboard route
lib/journal.js      what a journal line means: records, sealing, verification (pure)
lib/store.js        the journal on disk: lock, append, key, last-written position
lib/views.js        records as documents, and the generated Markdown views
lib/evidence.js     what the gate is told about a thread's evidence
lib/rules.js        pure gate, stage, scope and host rules, shared by tools and tests
tools/journal.mjs   operator commands: import, verify, render, reseal
tools/vr.mjs        read-only terminal view over the journal
tools/legacy-markdown.mjs   the old Markdown reader, kept only for the importer
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

The journal's seal is tamper evidence, not confinement. It stops what used to work — writing
`confirmed: true` into a file, editing a thread's stage, deleting an inconvenient record — because
none of those survive verification, and it makes an injected "just edit the scope file" instruction
harmless. It does not stop an agent that goes looking for the key: the key file is outside the
research directory but readable by the same OS user, and a process that reads it can seal its own
lines. Closing that takes a key the agent's user cannot read — a separate account, a keychain item
with an access prompt, or a signing service — and this plugin does not provide one.

## Known gaps

These are real and unfixed as of this commit:

- The journal key is readable by the agent's own OS user; see [Residual risk](#residual-risk).
- The last-written position that detects a rolled-back journal is kept beside the key, per machine. A
  journal copied to another machine is verified line by line there, but not against a position.
- The journal is verified and replayed whole whenever the file has changed, and there is no
  compaction. Measured on synthetic entries of about 1 KB: 45 ms at 1,000 entries, 0.14 s at 5,000,
  0.8 s at 20,000. An engagement of several hundred threads stays well under that; a workspace that
  outgrows it will feel it on every write.
- `vr_scan` compiles agent-supplied regular expressions with the default engine; a pathological pattern
  can block the event loop.
- Scan coverage counts skipped directories inconsistently, and `$` anchors do not match CRLF files.
- Prompt-time enrichment includes agent-written text; it is data, but it appears in the prompt.
- The boundary guard refuses at dispatch time only; redirects and DNS resolution happen afterwards.

If any of these matters for an engagement you are running, record it with `vr_defer` rather than
working around it silently.
