# Changelog

## Unreleased
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
