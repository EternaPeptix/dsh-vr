# Security policy

## Reporting

Open a private security advisory on this repository, or contact the maintainer directly. Please do not
file a public issue for anything that could let an engagement leak.

## Threat model

This plugin runs inside an operator's DSH profile and writes research state to the workspace. It is
not a sandbox and does not confine the agent it observes.

What the boundary layer does: refuses shell and fetch calls whose destination is not in the
engagement's `allowed_hosts` when `enforceAllowedHosts` is on, and audits both allow and deny
decisions to the telemetry ledger.

What it does not do: it does not intercept every egress path. Host extraction covers URLs and the
arguments of a known list of network clients. Indirect execution (`python3 -c`, a wrapper whose
argv[0] is unrecognised, `git pull` against a configured remote, redirects) is not covered. Treat the
denylist as best effort and the allowlist as the mode you actually rely on.

## Known weaknesses

- Completion verification is self-certified: the tool detects a claim that contradicts its artifacts,
  not a dishonest verifier. When the same agent claims and decides, the result says so.
- Scan patterns are bounded in length and rejected for nested quantifiers, but they still run on the
  default engine.
- State files are written atomically and fsynced; concurrent tool calls can still race on id
  allocation.
