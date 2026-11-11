/**
 * Deterministic gate evaluations.
 *
 * Every rule change in this harness was verified by hand once; nothing protected it afterwards.
 * These scenarios are the regression suite: each one states a thread state and the decision the
 * gate must reach, with no model, no network and no filesystem.
 *
 * Run: node harness/dsh-vr/test/rules.eval.mjs
 */
import { evaluateGate, missingStageRequirements, parseStateFile } from '../lib/rules.js';

const SECTIONS = {
  Question: 'Does the thing happen?',
  Hypothesis: 'It does.',
  Scope: 'src/x.c, reachable by the threat-model actor.',
  'Current assessment': 'E-001 supports it.',
  Evidence: '- [E-001: check](evidence/E-001.md)',
  'Impact assessment': 'Crosses a privilege boundary.',
  Attribution: 'Mechanism: m\nControl change: c (E-001)\nObserved after the control change: gone',
  Revalidation: 'Revision checked: r',
  'Open questions': 'none recorded',
  'Rejected paths': 'none recorded',
  'Attempt log': 'none',
  'Next action': 'submit',
  Limitations: 'none recorded',
};

const body = (overrides = {}) => {
  const sections = { ...SECTIONS, ...overrides };
  return Object.entries(sections).map(([heading, text]) => `## ${heading}\n\n${text}`).join('\n\n');
};

const thread = (frontmatter, overrides) => parseStateFile(
  `---\n${Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n${body(overrides)}`,
);

const evidence = (kind) => ({
  id: 'E-001',
  path: 'evidence/E-001.md',
  exists: true,
  complete: true,
  missingSections: [],
  kind,
});

const ACTIVE_READY = {
  id: 'thr-900', status: 'active', stage: 'ready', reproduces: 'true',
  revalidated_revision: 'abc1234',
};

const SCENARIOS = [
  {
    name: 'ready thread with executed evidence reports',
    parsed: thread(ACTIVE_READY),
    evidence: [evidence('execution')],
    expect: 'REPORT',
  },
  {
    name: 'static evidence cannot report',
    parsed: thread(ACTIVE_READY),
    evidence: [evidence('static')],
    expect: 'HOLD',
    reasonIncludes: 'no executed evidence',
  },
  {
    name: 'unclassified evidence cannot report',
    parsed: thread(ACTIVE_READY),
    evidence: [evidence(undefined)],
    expect: 'HOLD',
    reasonIncludes: 'do not say how they were established',
  },
  {
    name: 'ready thread with no evidence at all cannot report',
    parsed: thread(ACTIVE_READY, { Evidence: 'none' }),
    evidence: [],
    expect: 'HOLD',
    reasonIncludes: 'no evidence records are linked',
  },
  {
    name: 'evidence linked but missing on disk cannot report',
    parsed: thread(ACTIVE_READY),
    evidence: [{ id: 'E-001', path: 'evidence/E-001.md', exists: false, complete: false, missingSections: [] }],
    expect: 'HOLD',
    reasonIncludes: 'referenced evidence missing',
  },
  {
    name: 'artifact that no longer hashes as recorded cannot report',
    parsed: thread(ACTIVE_READY),
    evidence: [{ ...evidence('execution'), artifacts: [{ path: 'cf-lab/run/x.js', ok: false }] }],
    expect: 'HOLD',
    reasonIncludes: 'no longer matches what the record hashed',
  },
  {
    name: 'stage short of ready holds',
    parsed: thread({ ...ACTIVE_READY, stage: 'assessed' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'not "ready"',
  },
  {
    name: 'no attribution holds',
    parsed: thread(ACTIVE_READY, { Attribution: 'none' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'no attribution record',
  },
  {
    name: 'attribution that cites no evidence cannot report',
    parsed: thread(ACTIVE_READY, { Attribution: 'Mechanism: m\nControl change: c\nObserved: gone' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'attribution cites no evidence id',
  },
  {
    name: 'attribution citing non-executed evidence cannot report',
    parsed: thread(ACTIVE_READY, { Attribution: 'Mechanism: m\nControl change: c (E-999)' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'not executed',
  },
  {
    name: 'no revalidation holds',
    parsed: thread(ACTIVE_READY, { Revalidation: 'none' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'no revalidation record',
  },
  {
    name: 'revalidation that no longer reproduces blocks reporting',
    parsed: thread({ ...ACTIVE_READY, reproduces: 'false' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'no longer reproduces',
  },
  {
    name: 'revalidation without a revision holds',
    parsed: thread({ id: 'thr-907', status: 'active', stage: 'ready', reproduces: 'true' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'does not name the revision',
  },
  {
    name: 'a function-tier execution carries no weight when the engagement requires component',
    parsed: thread(ACTIVE_READY),
    evidence: [{ ...evidence('execution'), tier: 'function' }],
    options: { minTier: 'component' },
    expect: 'HOLD',
    reasonIncludes: 'no executed evidence at tier',
  },
  {
    name: 'component-tier execution satisfies the component floor',
    parsed: thread(ACTIVE_READY),
    evidence: [{ ...evidence('execution'), tier: 'component' }],
    options: { minTier: 'component' },
    expect: 'REPORT',
  },
  {
    name: 'a duplicated section is reported as a caveat rather than silently last-wins',
    parsed: parseStateFile([
      '---', 'id: thr-908', 'status: active', 'stage: ready', 'reproduces: true',
      'revalidated_revision: abc1234', '---',
      '## Evidence', '', '- [E-001: check](evidence/E-001.md)', '',
      '## Current assessment', '', 'E-001 supports it.', '',
      '## Impact assessment', '', 'crosses the boundary', '',
      '## Attribution', '', 'mechanism m; control E-001', '',
      '## Revalidation', '', 're-probed', '',
      '## Next action', '', 'file it', '',
      '## Impact assessment', '', 'second copy', '',
    ].join('\n')),
    evidence: [evidence('execution')],
    expect: 'REPORT',
    caveatIncludes: 'appears more than once',
  },
  {
    name: 'refuted with a deferral disposition is a result',
    parsed: thread({ id: 'thr-901', status: 'refuted', stage: 'ready', disposition: 'deferred-out-of-scope' }),
    evidence: [evidence('execution')],
    expect: 'REFUTE',
  },
  {
    name: 'closed without a disposition holds',
    parsed: thread({ id: 'thr-902', status: 'closed', stage: 'ready' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'no disposition recorded',
  },
  {
    name: 'closed as tested-and-rejected without execution holds',
    parsed: thread({ id: 'thr-903', status: 'closed', stage: 'ready', disposition: 'tested-and-rejected' }),
    evidence: [evidence('static')],
    expect: 'HOLD',
    reasonIncludes: 'reading the source is not a test',
  },
  {
    name: 'closed as tested-and-rejected with execution closes',
    parsed: thread({ id: 'thr-904', status: 'closed', stage: 'ready', disposition: 'tested-and-rejected' }),
    evidence: [evidence('execution')],
    expect: 'CLOSED',
  },
  {
    name: 'infrastructure-inconclusive never passes as a result',
    parsed: thread({ id: 'thr-905', status: 'closed', stage: 'ready', disposition: 'inconclusive-infrastructure' }),
    evidence: [evidence('execution')],
    expect: 'HOLD',
    reasonIncludes: 'not a research result',
  },
];

const STAGE_SCENARIOS = [
  { name: 'validated refuses static-only support', evidence: [evidence('static')], refuse: true },
  { name: 'validated accepts executed support', evidence: [evidence('execution')], refuse: false },
];

// Stage requirements read free-text sections. A placeholder there used to count as content, so the
// stage could be entered with "TBD" where the reasoning belongs.
const PLACEHOLDER_SCENARIOS = ['TBD', 'n/a', 'pending', 'wip', 'unknown', 'later', 'TODO', 'draft'];
const PLACEHOLDER_RESULTS = PLACEHOLDER_SCENARIOS.map((placeholder) => {
  const parsed = thread({ id: 'thr-909', status: 'candidate', stage: 'validated' }, { 'Impact assessment': placeholder });
  const reasons = missingStageRequirements('assessed', parsed, [evidence('execution')]);
  return { placeholder, refused: reasons.length > 0, detail: reasons.join(' | ') };
});
const REAL_ASSESSMENT_RESULT = (() => {
  const parsed = thread(
    { id: 'thr-910', status: 'candidate', stage: 'validated' },
    { 'Impact assessment': "crosses the tenant boundary: any local user can read another group's files" },
  );
  const reasons = missingStageRequirements('assessed', parsed, [evidence('execution')]);
  return { refused: reasons.length > 0, detail: reasons.join(' | ') };
})();

let failures = 0;
const check = (label, pass, detail) => {
  if (!pass) failures += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${pass ? '' : `  → ${detail}`}`);
};

for (const scenario of SCENARIOS) {
  const gate = evaluateGate(scenario.parsed, scenario.evidence, scenario.options);
  const reasons = gate.reasons.join(' | ');
  const caveats = (gate.caveats ?? []).join(' | ');
  const decisionOk = gate.decision === scenario.expect;
  const reasonOk = scenario.reasonIncludes === undefined || reasons.includes(scenario.reasonIncludes);
  const caveatOk = scenario.caveatIncludes === undefined || caveats.includes(scenario.caveatIncludes);
  check(
    `${scenario.name} [${scenario.expect}]`,
    decisionOk && reasonOk && caveatOk,
    `got ${gate.decision}: ${reasons}${caveatOk ? '' : ` / caveats: ${caveats}`}`,
  );
}

for (const result of PLACEHOLDER_RESULTS) {
  check(`"${result.placeholder}" does not satisfy the assessed stage`, result.refused, result.detail || 'accepted');
}
check('a real impact assessment satisfies the assessed stage', REAL_ASSESSMENT_RESULT.refused === false, REAL_ASSESSMENT_RESULT.detail);

for (const scenario of STAGE_SCENARIOS) {
  const parsed = thread({ id: 'thr-906', status: 'candidate', stage: 'candidate' });
  const reasons = missingStageRequirements('validated', parsed, scenario.evidence);
  const refused = reasons.length > 0;
  check(`${scenario.name} [${scenario.refuse ? 'refuse' : 'allow'}]`, refused === scenario.refuse, reasons.join(' | '));
}

console.log(failures === 0 ? '\nall scenarios passed' : `\n${failures} scenario(s) failed`);
process.exit(failures === 0 ? 0 : 1);
