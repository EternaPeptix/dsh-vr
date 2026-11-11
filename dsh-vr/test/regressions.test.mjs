/**
 * Regressions for record-integrity defects found in review.
 *
 * Each case here failed against a shipped build:
 *  - a section stored inside a fence whose info string was not `[a-z]*` never unwrapped on read, so
 *    every rewrite wrapped it again;
 *  - frontmatter keys the renderer did not know about were deleted by the next rewrite;
 *  - an artifact cited without a recorded hash was skipped by the drift check, so an unverifiable
 *    citation looked exactly like a verified one.
 */
import {
  artifactFingerprintDrift,
  completionClaimProblem,
  dashboardRequestAllowed,
  evaluateGate,
  executionAttestation,
  fenced,
  hostGrounded,
  normaliseHost,
  parseStateFile,
  readinessInvalidatedBy,
  renderThread,
} from '../lib/rules.js';

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail === undefined ? '' : `  → ${detail}`}`);
  }
};

const threadFm = (extra = {}) => ({
  id: 'thr-999',
  engagement: 'example-202601',
  status: 'active',
  stage: 'validated',
  target: 'example@abc123',
  created: '2026-01-01T00:00:00.000Z',
  updated: '2026-01-02T00:00:00.000Z',
  ...extra,
});

const threadSections = (attemptLog) => ({
  Question: 'does the primitive reach the sink?',
  Hypothesis: 'the actor reaches it',
  Scope: 'lib/sink.c++',
  'Attempt log': attemptLog,
});

// --- fence info strings other than [a-z]* ---------------------------------
for (const lang of ['json5', 'c++', 'shell-session', 'HTML', '']) {
  const record = [
    '---',
    'id: thr-999',
    '---',
    '',
    '# title',
    '',
    '## Conditions',
    '',
    '```' + lang,
    'body-text',
    '```',
    '',
  ].join('\n');
  const parsed = parseStateFile(record);
  check(
    `a fence tagged ${lang === '' ? '(untagged)' : lang} unwraps on read`,
    parsed.sections.Conditions === 'body-text',
    JSON.stringify(parsed.sections.Conditions),
  );
}

const onceTagged = renderThread(threadFm(), threadSections(fenced('{"a":1}', 'json5')));
const parsedTagged = parseStateFile(onceTagged);
check(
  're-rendering a tagged fence does not grow a fence layer',
  parsedTagged.sections['Attempt log'] === '{"a":1}',
  JSON.stringify(parsedTagged.sections['Attempt log']),
);
const twiceTagged = renderThread({ ...parsedTagged.frontmatter }, parsedTagged.sections);
check('render(parse(render(x))) is stable for tagged fences', onceTagged === twiceTagged);

// --- unknown frontmatter keys ---------------------------------------------
const handwritten = [
  '---',
  'id: thr-999',
  'engagement: example-202601',
  'status: active',
  'stage: validated',
  'operator_note: keep me across rewrites',
  'reviewed_by: researcher',
  '---',
  '',
  '# title',
  '',
  '## Conditions',
  '',
  'plain',
  '',
].join('\n');
const parsedHandwritten = parseStateFile(handwritten);
const rewritten = renderThread({ ...parsedHandwritten.frontmatter, status: 'blocked' }, parsedHandwritten.sections);
const reparsed = parseStateFile(rewritten);
check(
  'an unknown frontmatter key survives a rewrite',
  reparsed.frontmatter.operator_note === 'keep me across rewrites',
  String(reparsed.frontmatter.operator_note),
);
check('every unknown key survives, not just the first', reparsed.frontmatter.reviewed_by === 'researcher');
check('the rewrite still applied its own change', reparsed.frontmatter.status === 'blocked');

const injectedKey = parseStateFile([
  '---',
  'id: thr-999',
  'bad key: value',
  '---',
  '',
  '# title',
  '',
  '## Conditions',
  '',
  'plain',
  '',
].join('\n'));
const reinjected = renderThread({ ...injectedKey.frontmatter }, injectedKey.sections);
check(
  'a key that could not be read back is not emitted',
  parseStateFile(reinjected).frontmatter['bad key'] === undefined,
);

// --- unhashed citations are reported, not skipped -------------------------
const gateParsed = parseStateFile([
  '---',
  'id: thr-999',
  'status: active',
  'stage: validated',
  '---',
  '',
  '# title',
  '',
  '## Evidence',
  '',
  '- [E-001: check](evidence/E-001.md)',
  '',
].join('\n'));
const gateStates = [{
  id: 'E-001',
  path: 'evidence/E-001.md',
  exists: true,
  complete: true,
  missingSections: [],
  kind: 'execution',
  tier: 'function',
  artifacts: [{ path: 'out/report.json', unhashed: true }],
}];
const gate = evaluateGate(gateParsed, gateStates);
check(
  'a citation with no recorded hash is reported as a caveat',
  Array.isArray(gate.caveats) && gate.caveats.some((caveat) => caveat.includes('out/report.json')),
  JSON.stringify(gate.caveats),
);
check(
  'the caveat does not change the decision on its own',
  gate.decision === 'HOLD' && !gate.reasons.some((reason) => reason.includes('out/report.json')),
  `${gate.decision} / ${JSON.stringify(gate.reasons)}`,
);

const hashedStates = [{ ...gateStates[0], artifacts: [{ path: 'out/report.json', ok: true }] }];
const hashedGate = evaluateGate(gateParsed, hashedStates);
check(
  'a verified artifact produces no caveat',
  !Array.isArray(hashedGate.caveats) || hashedGate.caveats.length === 0,
  JSON.stringify(hashedGate.caveats),
);

// --- scope grounding ------------------------------------------------------
// Scope approval is refused unless allowed_hosts are covered by the hosts the judge listed. These
// are the comparisons that decision rests on, including the shapes that look right and are not.
check('a subdomain is grounded by its parent', hostGrounded('api.example.com', ['example.com']) === true);
check('a lookalike suffix is not grounded', hostGrounded('example.com.evil.test', ['example.com']) === false);
check('a wildcard entry grounds its own domain', hostGrounded('example.com', ['*.example.com']) === true);
check('a wildcard entry does not ground a different site', hostGrounded('evil.test', ['*.example.com']) === false);
check('a scheme and path are stripped before comparison', hostGrounded('https://api.example.com/v1/x', ['example.com']) === true);
check('an empty list grounds nothing', hostGrounded('example.com', []) === false);
check('a port on the scope entry does not defeat the comparison', hostGrounded('example.com', ['example.com:8443']) === true);
check('normaliseHost strips scheme, wildcard, path and port', normaliseHost('https://*.Example.com:8443/x') === 'example.com');

// --- new evidence invalidates readiness ------------------------------------
const readyInvalidation = readinessInvalidatedBy({
  stage: 'ready',
  reproduces: 'true',
  revalidated_revision: 'abc123',
  revalidated_at: '2026-01-01',
});
check('recording evidence drops a ready thread back to validated', readyInvalidation.changes.stage === 'validated');
check('recording evidence clears the revalidation it invalidates',
  readyInvalidation.changes.reproduces === undefined && readyInvalidation.changes.revalidated_revision === undefined);
check('both invalidations are explained to the researcher', readyInvalidation.notes.length === 2);

const validatedInvalidation = readinessInvalidatedBy({ stage: 'validated', reproduces: 'true' });
check('a validated thread keeps its stage but loses its revalidation',
  validatedInvalidation.changes.stage === undefined && validatedInvalidation.changes.reproduces === undefined);

const candidateInvalidation = readinessInvalidatedBy({ stage: 'candidate' });
check('a candidate thread is untouched by new evidence',
  Object.keys(candidateInvalidation.changes).length === 0 && candidateInvalidation.notes.length === 0);

const unsetInvalidation = readinessInvalidatedBy({});
check('a record with no stage is not moved', unsetInvalidation.changes.stage === undefined);

// --- dashboard request policy ---------------------------------------------
// Loopback binding does not stop DNS rebinding: the request arrives carrying the attacker's hostname.
check('a loopback Host is served', dashboardRequestAllowed({ host: '127.0.0.1:65451' }).allowed === true);
check('localhost is served', dashboardRequestAllowed({ host: 'localhost:65451' }).allowed === true);
check('an IPv6 loopback Host is served', dashboardRequestAllowed({ host: '[::1]:65451' }).allowed === true);
check('a rebound hostname is refused', dashboardRequestAllowed({ host: 'findings.attacker.example' }).allowed === false);
const foreignOrigin = dashboardRequestAllowed({ host: '127.0.0.1:65451', origin: 'https://attacker.example' });
check('a cross-origin read is refused', foreignOrigin.allowed === false);
check('the refusal says why', typeof foreignOrigin.reason === 'string' && foreignOrigin.reason.includes('Origin'));
check('a same-origin read is served',
  dashboardRequestAllowed({ host: '127.0.0.1:65451', origin: 'http://127.0.0.1:65451' }).allowed === true);
check('a configured tunnel host is served when named',
  dashboardRequestAllowed({ host: 'tunnel.example' }, ['tunnel.example']).allowed === true);
check('a configured tunnel host is still refused without its Origin',
  dashboardRequestAllowed({ host: 'tunnel.example', origin: 'https://other.example' }, ['tunnel.example']).allowed === false);

// --- executed evidence is attested against the ledger ----------------------
// The harness cannot see the target being run; it can see whether any tool call finished in the
// session that wrote the record. Silence about the difference was the defect.
const executedState = { id: 'E-001', exists: true, kind: 'execution', session: 'sess-a' };
const ledger = [{ event: 'tool_end', session: 'sess-a', tool: 'bash' }];
check('an execution whose session shows a finished tool call is not questioned',
  executionAttestation([executedState], ledger).length === 0);
check('an execution whose session shows nothing is reported',
  executionAttestation([executedState], []).length === 1);
check('a tool that started but never finished does not count',
  executionAttestation([executedState], [{ event: 'tool_start', session: 'sess-a' }]).length === 1);
check('another session does not attest it',
  executionAttestation([executedState], [{ event: 'tool_end', session: 'sess-b' }]).length === 1);
check('a record with no session is reported',
  executionAttestation([{ id: 'E-002', exists: true, kind: 'execution', session: '' }], ledger).length === 1);
check('static evidence is not questioned',
  executionAttestation([{ id: 'E-003', exists: true, kind: 'static', session: '' }], ledger).length === 0);
check('a missing evidence file is not questioned',
  executionAttestation([{ id: 'E-004', exists: false, kind: 'execution', session: '' }], ledger).length === 0);

// --- a fence inside a fence does not end the section early ------------------
const nestedFence = parseStateFile([
  '---', 'id: thr-911', '---',
  '# title',
  '## Attempt log', '',
  '````text',
  '```sh',
  'echo hi',
  '```',
  'done',
  '````', '',
  '## Next action', '',
  'file it',
].join('\n'));
check('a four-backtick block containing three backticks stays inside its section',
  nestedFence.sections['Attempt log'].includes('echo hi'), nestedFence.sections['Attempt log']);
check('the heading after the block is still parsed as a heading',
  nestedFence.sections['Next action'] === 'file it', JSON.stringify(nestedFence.sections['Next action']));

// --- a completion claim cannot complete a different goal -------------------
const now = Date.parse('2026-01-01T00:00:00.000Z');
const claim = { goalId: 'goal-1', objective: 'ship it', created: '2026-01-01T00:00:00.000Z' };
const freshView = { id: 'goal-1', objective: 'ship it' };
check('a matching claim is accepted',
  completionClaimProblem(claim, freshView, { nowMs: now + 1000, maxAgeMs: 3600000 }) === undefined,
  completionClaimProblem(claim, freshView, { nowMs: now + 1000, maxAgeMs: 3600000 }));
check('a claim for another goal is refused',
  String(completionClaimProblem(claim, { id: 'goal-2', objective: 'ship it' }, { nowMs: now, maxAgeMs: 3600000 })).includes('different goal'));
check('a changed objective is refused',
  String(completionClaimProblem(claim, { id: 'goal-1', objective: 'something else' }, { nowMs: now, maxAgeMs: 3600000 })).includes('objective changed'));
check('an expired claim is refused',
  String(completionClaimProblem(claim, freshView, { nowMs: now + 7200000, maxAgeMs: 3600000 })).includes('minutes old'));
check('a claim with no timestamp is refused',
  String(completionClaimProblem({ goalId: 'goal-1' }, freshView, { nowMs: now, maxAgeMs: 3600000 })).includes('no readable timestamp'));

// --- artifacts are re-checked at verdict time ------------------------------
const recorded = [
  { name: 'report.md', kind: 'file', sha: 'aaa' },
  { name: 'thr-001', kind: 'thread', gate: 'REPORT' },
];
check('unchanged artifacts produce no drift',
  artifactFingerprintDrift(recorded, recorded).length === 0);
check('a file that changed is reported',
  artifactFingerprintDrift(recorded, [{ name: 'report.md', kind: 'file', sha: 'bbb' }, recorded[1]]).length === 1);
check('a thread whose gate dropped is reported',
  artifactFingerprintDrift(recorded, [recorded[0], { name: 'thr-001', kind: 'thread', gate: 'HOLD' }]).length === 1);
check('a vanished artifact is reported',
  artifactFingerprintDrift(recorded, [recorded[0]]).length === 1);

console.log(failures === 0 ? 'all regression cases passed' : `${failures} regression case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
