/**
 * Round-trip tests for the state-file format.
 *
 * Every bug these cover was invisible to the gate tests because they only ever parsed hand-written
 * fixtures. Rendering a record and parsing it back is the contract that actually matters: if the two
 * disagree, a rewrite silently damages the record.
 */
import {
  evaluateGate,
  evidenceLinks,
  parseStateFile,
  renderEvidence,
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

const evidenceSections = {
  Request: 'curl -s http://127.0.0.1:8787/api',
  'Observed response': 'HTTP/1.1 200 OK\n## not a heading, captured output\nbody',
  'Target state check': 'file created',
  Limitations: 'none',
};

const fm = {
  id: 'E-001',
  thread: 'thr-001',
  target_revision: 'deadbeef',
  configuration: 'local-test',
  kind: 'static',
  tier: 'function',
  created: '2026-01-01T00:00:00.000Z',
  title: 'title with ] bracket inside',
};

const once = renderEvidence(fm, evidenceSections);
const parsedEvidence = parseStateFile(once);

check('title survives a rewrite', parsedEvidence.title === fm.title, String(parsedEvidence.title));
check(
  'a ## line inside captured output is not a heading',
  parsedEvidence.sections['Observed response'].includes('## not a heading'),
  parsedEvidence.sections['Observed response'],
);
check(
  'request body is preserved',
  parsedEvidence.sections.Request.includes('127.0.0.1:8787'),
  parsedEvidence.sections.Request,
);

const twice = renderEvidence({ ...parsedEvidence.frontmatter, title: parsedEvidence.title }, parsedEvidence.sections);
check('render(parse(render(x))) === render(x)', once === twice, once === twice ? '' : 'differs');
check('no nested fence appears', !twice.includes('````'), twice.slice(0, 60));

const links = evidenceLinks({ Evidence: '- [E-001: title with ] bracket inside](evidence/E-001.md)' });
check('a ] in a link title does not break the link', links.length === 1 && links[0].id === 'E-001', JSON.stringify(links));

const threadText = renderThread(
  { id: 'thr-900', status: 'active', stage: 'candidate', target: 'line one\nstage: ready', engagement: 'demo' },
  { Question: 'q', Hypothesis: 'h', Scope: 's', 'Next action': 'n' },
);
const parsedThread = parseStateFile(threadText);
check('a newline in a value cannot forge another key', parsedThread.frontmatter.stage === 'candidate', String(parsedThread.frontmatter.stage));
check('the folded value keeps both lines', String(parsedThread.frontmatter.target).includes('stage: ready'), String(parsedThread.frontmatter.target));

const shaOnly = {
  frontmatter: { id: 'thr-901', status: 'active', stage: 'ready', title: 'sha' },
  sections: {
    Question: 'q',
    Hypothesis: 'h',
    Scope: 's',
    Evidence: '- [E-001: only check](evidence/E-001.md)',
    'Current assessment': 'We computed SHA-256 over the payload.',
    Attribution: 'Mechanism: m\nControl change: c\nSHA-256 confirms it.',
    Revalidation: 'reproduced',
    'Next action': 'report',
  },
  order: [],
};
const executed = [{ id: 'E-001', kind: 'execution', tier: 'function', artifacts: [] }];
const verdict = evaluateGate(shaOnly, executed);
const shaMentioned = verdict.reasons.some((reason) => reason.includes('cites no evidence id'));
check('SHA-256 is not read as evidence id A-256', shaMentioned, JSON.stringify(verdict.reasons));

console.log(failures === 0 ? 'all round-trip cases passed' : `${failures} round-trip case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
