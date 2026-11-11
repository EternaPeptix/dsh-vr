/**
 * What the gate is told about the evidence a thread lists.
 *
 * The plugin's tools and the operator's terminal view both call this, so the same facts reach the
 * same rules whichever of them asks.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { evidenceKey } from './journal.js';
import { isFilled } from './rules.js';
import { evidenceLinksOf } from './views.js';

/** The sections that decide whether one evidence record is complete. */
export const REQUIRED_EVIDENCE_SECTIONS = ['Conditions', 'Observed response', 'Target-state check'];

/**
 * The state of every evidence record a thread lists.
 *
 * `root` is the research directory; a relative artifact path is resolved against its parent, the
 * workspace the record was written in. `links` defaults to the thread's own evidence list.
 */
export async function evidenceStates(state, root, threadId, links) {
  const states = [];
  for (const link of Array.isArray(links) ? links : evidenceLinksOf(state, threadId)) {
    const record = state.evidence.get(evidenceKey(threadId, link.id));
    if (record === undefined) {
      states.push({ id: link.id, path: link.path, exists: false, complete: false, missingSections: [] });
      continue;
    }
    const missingSections = REQUIRED_EVIDENCE_SECTIONS.filter((section) => !isFilled(record.sections?.[section]));
    // Byte identity: an artifact cited as evidence must still hash to what the record says.
    const artifacts = [];
    for (const artifact of Array.isArray(record.artifacts) ? record.artifacts : []) {
      const cited = String(artifact?.path ?? '');
      if (typeof artifact?.sha256 !== 'string' || artifact.sha256 === '') {
        // Named without a hash: drift cannot be detected, and the gate says so as a caveat.
        artifacts.push({ path: cited, unhashed: true });
        continue;
      }
      let ok;
      try {
        const resolved = path.isAbsolute(cited) ? cited : path.resolve(path.dirname(root), cited);
        const bytes = await fs.readFile(resolved);
        ok = createHash('sha256').update(bytes).digest('hex').startsWith(artifact.sha256);
      } catch {
        ok = false;
      }
      artifacts.push({ path: cited, ok });
    }
    states.push({
      id: link.id,
      path: link.path,
      exists: true,
      complete: missingSections.length === 0,
      missingSections,
      artifacts,
      // How the claim was established, and how far the harness that established it reaches.
      kind: String(record.meta?.kind ?? '').trim().toLowerCase() || undefined,
      tier: String(record.meta?.tier ?? '').trim().toLowerCase() || undefined,
      // Which session wrote the record, so the gate can ask whether anything ran there.
      session: String(record.meta?.session ?? '').trim(),
      created: String(record.meta?.created ?? '').trim(),
      // Whether an execution tool had finished in that session when the record was written.
      attested: record.attested,
    });
  }
  return states;
}
