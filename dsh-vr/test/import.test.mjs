/**
 * The one-off import: Markdown state written before the journal existed → a sealed journal.
 *
 * It runs once per research directory and cannot be undone in place, so what it keeps and what it
 * refuses is pinned here against a directory shaped like the early ones: evidence titles that live
 * only in the thread's link text, artifact lines with and without a hash, a record the thread
 * never linked.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadJournal } from '../lib/journal.js';
import { JOURNAL_FILE, journalKey, readAnchor } from '../lib/store.js';
import { evidenceDoc, threadDoc } from '../lib/views.js';
import { importLegacy } from '../tools/journal.mjs';

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail === undefined ? '' : `  → ${detail}`}`);
  }
};

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vr-import-'));
const root = path.join(scratch, 'research');
const keyFile = path.join(scratch, 'keys', 'journal.key');
const put = async (rel, text) => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
};

await put('ENGAGEMENT.md', [
  '---',
  'engagement: acme-202601',
  'programme: Acme BBP',
  'target: app.acme.test',
  'authorization: Acme permits testing of the listed hosts',
  'allowed_hosts: acme.test, api.acme.test',
  'concurrency: 5',
  'confirmed: true',
  'updated: 2026-01-02',
  '---',
  '',
  '## In scope',
  '',
  '- acme.test and api.acme.test',
  '',
  '## Scope decisions',
  '',
  '- 2026-01-02T00:00:00.000Z judge APPROVED (judge-1): both hosts are listed',
  '',
].join('\n'));
await put('threads/thr-001/index.md', [
  '---',
  'id: thr-001',
  'engagement: acme-202601',
  'status: active',
  'stage: validated',
  'target: app.acme.test@abc1234',
  'created: 2026-01-03T00:00:00.000Z',
  'updated: 2026-01-04T00:00:00.000Z',
  'attempts: 1',
  '---',
  '',
  '# does the unchecked length reach the copy?',
  '',
  '## Question',
  '',
  'does the unchecked length reach the copy?',
  '',
  '## Hypothesis',
  '',
  '```text',
  'parse_record() trusts the length field',
  '```',
  '',
  '## Evidence',
  '',
  '- [E-001: the reproducer overwrites the canary](evidence/E-001.md)',
  '- [E-002: E-002](evidence/E-002.md)',
  '',
  '## Next action',
  '',
  'none',
  '',
].join('\n'));
// An early record: no title of its own, and artifact lines in all three shapes.
await put('threads/thr-001/evidence/E-001.md', [
  '---',
  'id: E-001',
  'thread: thr-001',
  'target_revision: abc1234',
  'kind: execution',
  'tier: component',
  'created: 2026-01-03T01:00:00.000Z',
  '---',
  '',
  '## Conditions',
  '',
  '- default build',
  '',
  '## Observed response',
  '',
  '```text',
  'canary overwritten',
  '## not a heading, only output',
  '```',
  '',
  '## Target-state check',
  '',
  'the canary differs after the call',
  '',
  '## Artifacts',
  '',
  '- out/run.log — worker log',
  '- out/poc.bin (sha256:0123456789abcdef…, 12 bytes)',
  '- out/gone.txt (not readable when recorded: hash unavailable)',
  '',
].join('\n'));
await put('threads/thr-001/evidence/E-002.md', [
  '---',
  'id: E-002',
  'thread: thr-001',
  'title: with the bounds check restored the canary survives',
  'kind: static',
  'tier: function',
  'created: 2026-01-03T02:00:00.000Z',
  '---',
  '',
  '# with the bounds check restored the canary survives',
  '',
  '## Conditions',
  '',
  '- patched build',
  '',
  '## Observed response',
  '',
  'canary intact',
  '',
  '## Target-state check',
  '',
  'the canary is unchanged',
  '',
].join('\n'));
await put('threads/thr-001/evidence/E-003.md', [
  '---',
  'id: E-003',
  'thread: thr-001',
  'kind: static',
  'tier: function',
  '---',
  '',
  '## Conditions',
  '',
  '- never linked',
  '',
].join('\n'));
await put('DEFERRALS.md', [
  '# Deferrals',
  '',
  '## 2026-01-05T00:00:00.000Z',
  '- reason: the staging host was down',
  '- thread: thr-001',
  '- session: agent-a',
  '',
].join('\n'));

const before = (await fs.readdir(root, { recursive: true })).sort().join('\n');
const dry = await importLegacy(root, { keyFile, dryRun: true });
check('a dry run reads the directory and writes nothing to it',
  dry.written === false && dry.counts.threads === 1 && (await fs.readdir(root, { recursive: true })).sort().join('\n') === before,
  JSON.stringify(dry.counts));

const done = await importLegacy(root, { keyFile });
const key = await journalKey(keyFile);
const text = await fs.readFile(path.join(root, JOURNAL_FILE), 'utf8');
const { state, integrity } = loadJournal(text, key, await readAnchor(path.join(root, JOURNAL_FILE), keyFile));
check('the import writes a journal that verifies against the key and its recorded position',
  done.written === true && integrity.ok === true && integrity.events === done.entries, JSON.stringify(integrity));
check('threads, evidence and deferrals are all carried over',
  state.threads.size === 1 && state.evidence.size === 3 && state.deferrals.length === 1
    && done.counts.unlinkedEvidence === 1 && done.counts.missingEvidence === 0,
  JSON.stringify(done.counts));
check('the engagement keeps its verdict and its hosts as a list',
  state.engagement?.meta?.confirmed === 'true' && JSON.stringify(state.engagement.meta.allowed_hosts) === '["acme.test","api.acme.test"]',
  JSON.stringify(state.engagement?.meta));

const thread = state.threads.get('thr-001');
check('the evidence list is a field of the thread, in link order, without the unlinked record',
  JSON.stringify(thread.evidence) === '["E-001","E-002"]' && thread.sections.Evidence === undefined,
  JSON.stringify(thread.evidence));
check('a section that only said "none" is imported as empty', thread.sections['Next action'] === undefined, JSON.stringify(thread.sections['Next action']));
check('a fenced section is stored without its fence', thread.sections.Hypothesis === 'parse_record() trusts the length field', JSON.stringify(thread.sections.Hypothesis));

const first = state.evidence.get('thr-001/E-001');
const second = state.evidence.get('thr-001/E-002');
check('a title held only in the link text moves onto the record',
  first.meta.title === 'the reproducer overwrites the canary', JSON.stringify(first.meta.title));
check('a record with its own title keeps it, and a link that only repeats the id adds nothing',
  second.meta.title === 'with the bounds check restored the canary survives', JSON.stringify(second.meta.title));
check('captured output that looks like a heading stays inside its section',
  String(first.sections['Observed response']).includes('## not a heading, only output') && first.sections['Target-state check'] === 'the canary differs after the call',
  JSON.stringify(Object.keys(first.sections)));
check('artifact lines keep what they recorded: no hash, a hash and size, or unreadable',
  JSON.stringify(first.artifacts) === JSON.stringify([
    { path: 'out/run.log — worker log' },
    { path: 'out/poc.bin', sha256: '0123456789abcdef', bytes: 12 },
    { path: 'out/gone.txt', unreadable: true },
  ]),
  JSON.stringify(first.artifacts));

const shown = evidenceDoc(state, 'thr-001', 'E-001').sections.Artifacts.split('\n');
check('the view does not call a never-hashed artifact unreadable',
  shown[0] === '- out/run.log — worker log (no hash recorded)'
    && shown[1].startsWith('- out/poc.bin (sha256:0123456789abcdef')
    && shown[2] === '- out/gone.txt (not readable when recorded: hash unavailable)',
  shown.join(' | '));
check('the thread view lists its evidence under the titles the records now carry',
  threadDoc(state, 'thr-001').links.map((link) => `${link.id}: ${link.title}`).join(' | ')
    === 'E-001: the reproducer overwrites the canary | E-002: with the bounds check restored the canary survives',
  threadDoc(state, 'thr-001').links.map((link) => `${link.id}: ${link.title}`).join(' | '));

const again = await importLegacy(root, { keyFile }).then(() => undefined, (error) => error.message);
check('a directory that has a journal is not imported twice', typeof again === 'string' && again.includes('already exists'), again ?? 'ACCEPTED');
await fs.rm(path.join(root, JOURNAL_FILE));
const afterDelete = await importLegacy(root, { keyFile }).then(() => undefined, (error) => error.message);
check('deleting the journal does not turn its Markdown views back into state',
  typeof afterDelete === 'string' && afterDelete.includes('is gone') && !(await fs.access(path.join(root, JOURNAL_FILE)).then(() => true, () => false)),
  afterDelete ?? 'ACCEPTED');

await fs.rm(scratch, { recursive: true, force: true });
console.log(failures === 0 ? 'all import cases passed' : `${failures} import case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
