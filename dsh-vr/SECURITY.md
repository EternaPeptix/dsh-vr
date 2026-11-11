# Security policy

## Reporting

Open a private security advisory on this repository, or contact the maintainer directly. Please do not
file a public issue for anything that could let an engagement leak.

## Threat model

This plugin runs inside an operator's DSH profile and writes research state to the workspace. It is
not a sandbox and does not confine the agent it observes.

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
- State files are written atomically and fsynced; concurrent tool calls can still race on id
  allocation.
- `kind: execution` is the researcher's attestation, not something the harness observed. Records now
  carry the session that wrote them, and `vr_gate` reports a caveat when that session shows no
  finished tool call — but that is a consistency check against harness output, not proof that the
  execution described actually happened, and it only reaches as far as the telemetry ledger does.
- A gate pass is about support, not severity: it says the claim has evidence under the stated
  conditions and has been attributed and revalidated. It does not say the finding matters.
