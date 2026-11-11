# Security policy

## Reporting

Open a private security advisory on this repository, or contact the maintainer directly. Please do not
file a public issue for anything that could let an engagement leak.

## Threat model

This plugin runs inside an operator's DSH profile and writes research state to the workspace. It is
not a sandbox and does not confine the agent it observes.

Research state is an append-only journal, `research/journal.jsonl`, of typed records. Each line is
sealed with an HMAC chained to the line before it, under a key kept outside the research directory
(`~/.dsh-vr/journal.key` by default), and the position last written is kept beside that key. A
journal that was edited, extended without the key, cut short, replaced or deleted fails
verification; it is then refused whole, no scope counts as qualified, and the host guard permits
nothing beyond loopback until an operator has run `tools/journal.mjs verify` and decided. The
Markdown files beside the journal are generated for readers and are never read back.

What that defends: the stored scope verdict, stage, evidence classification and completion claims
against a file write or a shell command that edits them, and against observed content that would
once have been parsed as structure. What it does not defend: the key is readable by the OS user the
agent runs as. An agent that reads the key can seal lines of its own, and nothing here would notice.
Treat the seal as tamper evidence against stray and injected writes, not as a control on an agent
that is trying to defeat it; that takes a key its user cannot read.

What the boundary layer does: refuses shell and fetch calls whose destination is not in the
engagement's `allowed_hosts` when `enforceAllowedHosts` is on, and audits both allow and deny
decisions to the telemetry ledger. Loopback is exempt unless `allowLoopback` is false. The
`referenceHosts` exemption applies only to the fetch tool, never to shell.

What it does not do: it does not intercept every egress path. Host extraction covers URLs and the
arguments of a known list of network clients at a command position — after environment assignments
and wrappers such as `sudo`, `time`, `xargs` or `timeout`, and inside `$( )` substitution. Indirect
execution (`python3 -c`, a program that builds its own request, `git pull` against a configured
remote, redirects) is not covered. Treat the denylist as best effort and the allowlist as the mode
you actually rely on.

The guard is best effort even for the requests it does inspect, and it has residual blind spots that
only a network-level egress control closes. It runs before dispatch and judges the host named in the
call; HTTP redirects and DNS resolution happen after that check, so an allowed host that redirects to
a denied one passes, and a denied host reached by IP address or through a CNAME that never spells its
name is not recognised as denied. Closing those would take an egress control that resolves and
rejects at connection time; the pre-execute hook described above is not one, and this plugin provides
none.

A refusal is written to the telemetry ledger but does not interrupt the operator: an unattended agent
that tries to reach the wrong host is stopped quietly. The record exists for an incident review after
the fact; it is not an alert, and nothing in this plugin raises one.

Scope qualification is structurally defended rather than merely instructed: approval is refused unless
the judge's own reply carries the line `Hosts read on the page: ...` and every host in `allowed_hosts`
is covered by it. That does not make a judge honest, it makes a fabricated scope harder to pass off:
the claim has to be repeated consistently across two tools, in a list the operator can diff against
the programme page.

The findings dashboard refuses requests whose `Host` or `Origin` header is not loopback, which closes
the DNS-rebinding path to engagement data through a browser. It has no authentication of its own; if
you put a tunnel in front of it, name the tunnel host in `dashboardAllowHosts` and add your own
access control there.

## Known weaknesses

- Completion verification is self-certified: the tool detects a claim that contradicts its artifacts,
  not a dishonest verifier. When the same agent claims and decides, the result says so.
- Scan patterns are bounded in length and rejected for nested quantifiers, but they still run on the
  default engine.
- The journal key and the last-written position live in the operator's home directory, readable by
  the agent's own user. Rollback detection is per machine: a journal moved to another machine is
  checked line by line there, not against a position.
- `tools/journal.mjs reseal` accepts whatever the journal holds. It is the operator's way out of a
  refusal and is exactly as trustworthy as the look the operator took first; it keeps the previous
  file beside the new one.
- `kind: execution` is the researcher's attestation, not something the harness observed. Records
  carry the session that wrote them, and whether that session had finished an execution-capable tool
  call is decided when the record is written and stored with it; `vr_gate` reports an unattested
  record as a caveat. That is a consistency check against harness output, not proof that the
  execution described actually happened, and with telemetry off every execution record is
  unattested.
- The gate verifies records, not reality. Nothing stops an agent from writing a convincing evidence
  record that claims `kind: execution` with a fabricated observed response, and the attestation check
  only looks for any finished tool call in the same session, not for the specific command the record
  describes.
- A gate pass is about support, not severity: it says the claim has evidence under the stated
  conditions and has been attributed and revalidated. It does not say the finding matters.
