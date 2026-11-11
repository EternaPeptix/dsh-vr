# Changelog

## Unreleased
- **Research state is a journal, not Markdown.** `research/journal.jsonl` holds one sealed line per
  tool call; the state is what the lines add up to. `ENGAGEMENT.md`, the thread and evidence files,
  `INDEX.md` and `DEFERRALS.md` are generated from it and never read back. The Markdown parser is
  gone from the runtime and survives only in `tools/legacy-markdown.mjs`, for the one-off importer.
  The reason: every state bug of the last review was text turning into structure — a line break
  that became `confirmed: true`, a `##` inside captured output that became a section, a title with
  a `]` that unlinked its evidence. Escaping closed them one at a time; storing fields closes the
  class.
- A directory holding Markdown state and no journal is refused until
  `node tools/journal.mjs import <research dir>` has been run once. The import is not reversible in
  place: keep a copy of the directory. Imported execution records are attested against whatever the
  telemetry ledger still holds on that day. An evidence title that existed only in a thread's link
  text is moved onto the record, and an artifact line that never had a hash is shown as
  `(no hash recorded)` rather than as unreadable. The import has its own test suite.
- Journal lines are sealed with an HMAC chained to the previous line, under a key outside the
  research directory (`journalKeyFile`, default `~/.dsh-vr/journal.key`). An edited, added, removed
  or reordered line, a journal cut short of the position last written, a replaced journal and a
  deleted one are all refused, by every tool, with the line named. Editing `ENGAGEMENT.md` no longer
  qualifies a scope: nothing reads it.
- The host guard fails closed. A scope that cannot be read used to clear the finding, so a broken
  state file let every host through; it now permits loopback only. An unjudged scope's hosts are a
  proposal and are not reachable until a judge confirms them — they used to be permitted as soon as
  `vr_scope_apply` recorded them.
- The programme page stays reachable to the judge after `vr_scope_apply` replaces the page URL with
  the programme's name: the URL is kept as `programme_url`.
- Thread and evidence ids can no longer collide: writing tools run one at a time and an entry is
  refused if another process wrote the journal first. An evidence record and its link are one entry.
- Execution attestation is decided when the record is written and stored with it, so it no longer
  changes when the telemetry ledger rotates. Only tools named in `executionTools` attest; the
  harness's own tools finishing do not.
- Terminal threads are immutable everywhere, `vr_evidence_classify` included. Reopening never
  advances a thread: it returns to the stage it had reached, capped at `assessed`.
- Completion claims live in the journal, one per goal; `COMPLETION-PENDING.json` is gone, so there
  is no claim file for an agent to write. Applying a different scope over a qualified engagement
  keeps the old one in the journal's history.
- `vr_repair` compares threads with evidence records instead of directory listings, and
  `apply: true` rewrites every Markdown view.
- New operator commands: `tools/journal.mjs` (`import`, `verify`, `render`, `reseal`) and
  `tools/vr.mjs`, a read-only terminal view that verifies the journal and never writes.
- The load test now drives the tools and hooks end to end and reads state back from the journal
  with the key: tampering, rollback, ids allocated at once, a thread walked to `REPORT`, the host
  guard. Before this the suites never ran a hook.
- Scope writes can no longer be steered by the text they record. A line break inside a
  `vr_scope_apply` field used to be written raw, so `authorization: "…\nconfirmed: true\n---"`
  qualified a scope with no judge. `renderEngagement` is now the one writer of `ENGAGEMENT.md` and
  folds every frontmatter value to a single line whatever the caller passed; section text has
  heading, title and fence lines escaped, so `rules_note` or an `out_of_scope` rule cannot add a
  `Scope decisions` or `Pending scope request` section, and a judge's rationale cannot continue as a
  second, forged verdict line.
- `allowed_hosts` and `requested_hosts` entries must each be one bare host (optional `*.` prefix and
  port; IP literals accepted). Entries holding whitespace, a comma, a scheme or path, a trailing dot,
  an empty label or non-ASCII characters are refused with the reason, not rewritten.
- An approved expansion reads the requested hosts from the leading `requested host:` lines of the
  pending request only; a host line quoted further down in its justification or evidence is ignored.
- `vr_scope_intake` refuses a URL that contains whitespace or control characters instead of letting
  the URL parser drop them silently.
- Findings panel: aborts an in-flight read when it unmounts, reports a failed read instead of going
  blank, shows when it last succeeded, isolates a table that fails to render behind an error
  boundary, and can blur finding text for screen sharing.
- A completion verdict is refused when the pending claim names a different goal, when the objective
  changed, when the claim is older than `completionClaimMinutes`, or when a named artifact changed
  after the claim was made.
- `vr_finish_goal` refuses a thread artifact whose gate is `HOLD`: a thread that does not support its
  own claim cannot demonstrate that an objective was met.
- `vr_scope_intake` refuses to overwrite an engagement that is already qualified; `force: true`
  archives the previous file first.
- The intake-pending check looks for the tool's own sentinel line instead of the word "provisional",
  which legitimate programme text also contains.
- Placeholders (`TBD`, `n/a`, `pending`, `wip`, `unknown`, `later`, `TODO`, `draft`, …) no longer
  count as filled, and revalidation must name the revision it was checked against.
- Section parsing tracks the opening fence length, so a four-backtick block containing three
  backticks no longer ends its section early.
- Duplicate section headings are reported as a gate caveat instead of resolving silently.
- `vr_repair` reports evidence files that were never linked and links that point at nothing.
- `vr_defer` validates the thread id it is given and keeps `DEFERRALS.md` within a bounded entry
  count.
- `minReportTier` and `requireExecutionAttestation` let an engagement demand a stronger harness tier
  or treat unattested execution as blocking.
- Expansion approval no longer qualifies an engagement that was not qualified.
- Reopening a closed thread resets stage to assessed and clears revalidation.
- CRLF normalised at parse entry.
- Enrichment writes telemetry only when enabled.
- Telemetry rotation keeps two generations instead of overwriting.
- Exclude rules match path segments, not substrings.
- Scan patterns bounded; nested quantifiers refused.
- writeAtomic fsyncs the file and directory.
- Completion records who claimed and who decided; self-certification is surfaced.
- Guard refusal wording no longer overclaims.
- Licence, SECURITY, CHANGELOG, test script; engagement patch untracked.
- Every state-file section is fenced on write, so captured content cannot forge a heading.
- The guard resolves the network client at a command position — after env assignments and wrappers
  such as `sudo -u user`, `time` or `xargs` — instead of anywhere in the line, which had made an
  English sentence containing the word "host" look like a DNS lookup.
- Command substitution (`VAR=$(curl host)`) is parsed, not skipped.
- A fence whose info string is anything other than `[a-z]*` unwraps on read instead of nesting again.
- Unknown frontmatter keys are preserved across rewrites instead of being deleted.
- A cited artifact stored without a hash is reported as a gate caveat instead of being skipped.
- `concurrency` in ENGAGEMENT.md is the ceiling actually applied when opening threads.
- Scope approval requires the judge's own host enumeration, and refuses hosts it does not cover.
- `referenceHosts` exempts only the fetch tool, never shell; loopback exemption is configurable.
- Recording evidence drops a thread at `assessed` or `ready` back to `validated` and clears its
  revalidation, because both described the evidence set that just changed.
- The dashboard refuses requests whose Host or Origin is not loopback (DNS rebinding), and reuses
  its built state for `dashboardCacheMs` instead of rebuilding on every poll.
- A load test imports the real plugin entry point against stubbed Harness packages, so a module that
  fails to register its tools — or reads an undefined config key — fails in CI instead of at startup.
- Evidence records carry the session that wrote them, and `vr_gate` reports executed evidence that
  session cannot attest as a caveat rather than accepting it silently.
