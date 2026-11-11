# Changelog

## Unreleased
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
