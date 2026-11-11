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
  evaluateGate,
  fenced,
  parseStateFile,
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

console.log(failures === 0 ? 'all regression cases passed' : `${failures} regression case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
