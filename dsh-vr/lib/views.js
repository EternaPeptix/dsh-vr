/**
 * What the journal's state looks like to a reader.
 *
 * Two kinds of output, both derived and neither ever read back as state:
 *   - documents: the `{ frontmatter, sections }` shape the gate rules and the tools work with;
 *   - files: the Markdown a person opens under research/. Editing one changes nothing, and the next
 *     write replaces it.
 */
import { evidenceKey } from './journal.js';
import { fmValue, inertSectionBody, isFilled, renderEvidence, renderThread } from './rules.js';

const clip = (value, cap) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
};

export const hostsOf = (value) => (Array.isArray(value)
  ? value.map((host) => String(host).trim()).filter(Boolean)
  : String(value ?? '').split(',').map((host) => host.trim()).filter(Boolean));

/** The engagement as the scope tools read it, or undefined before any intake. */
export function engagementDoc(state) {
  const record = state.engagement;
  if (record === undefined) return undefined;
  return {
    frontmatter: { ...record.meta, allowed_hosts: hostsOf(record.meta?.allowed_hosts).join(', ') },
    sections: { ...(record.sections ?? {}) },
    // A scope expansion awaiting a judge, as data: `{ hosts, blocked_work, justification, evidence, risk, at }`.
    request: record.request,
  };
}

/** The engagement as ENGAGEMENT.md shows it: a pending request appears as a section of its own. */
function engagementView(state) {
  const doc = engagementDoc(state);
  const request = doc.request;
  if (request !== undefined && request !== null) {
    doc.sections['Pending scope request'] = [
      ...hostsOf(request.hosts).map((host) => `requested host: ${host}`),
      '',
      `Blocked work: ${request.blocked_work ?? ''}`,
      '',
      `Justification: ${request.justification ?? ''}`,
      '',
      `Evidence: ${request.evidence ?? ''}`,
      '',
      `Risk if wrong: ${request.risk ?? ''}`,
      '',
      `Requested at: ${request.at ?? ''}`,
    ].join('\n');
  }
  return doc;
}

/** The engagement record a `{ frontmatter, sections }` document stands for. */
export function engagementRecord(frontmatter, sections) {
  const meta = {};
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    meta[key] = key === 'allowed_hosts' ? hostsOf(value) : String(value);
  }
  const kept = {};
  for (const [heading, text] of Object.entries(sections ?? {})) {
    if (text === undefined || text === null) continue;
    kept[heading] = String(text);
  }
  return { meta, sections: kept };
}

export function evidenceLinksOf(state, threadId) {
  const record = state.threads.get(threadId);
  return (record?.evidence ?? []).map((id) => ({
    id,
    title: String(state.evidence.get(evidenceKey(threadId, id))?.meta?.title ?? id),
    path: `evidence/${id}.md`,
  }));
}

/**
 * A thread as the rules read it. `links` is the evidence list itself; the Evidence section is only
 * its display form, so nothing has to find links by matching text.
 */
export function threadDoc(state, threadId) {
  const record = state.threads.get(threadId);
  if (record === undefined) return undefined;
  const links = evidenceLinksOf(state, threadId);
  const sections = { ...(record.sections ?? {}) };
  sections.Evidence = [
    ...links.map((link) => `- [${link.id}: ${fmValue(link.title)}](${link.path})`),
    ...(isFilled(record.sections?.Evidence) ? [record.sections.Evidence] : []),
  ].join('\n');
  return {
    frontmatter: { ...(record.meta ?? {}) },
    sections,
    links,
    order: Object.keys(sections),
    title: record.meta?.title,
    duplicates: [...(record.duplicates ?? [])],
  };
}

export function artifactLines(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : []).map((artifact) => {
    if (typeof artifact?.sha256 === 'string' && artifact.sha256 !== '') {
      const size = Number.isInteger(artifact.bytes) ? `, ${artifact.bytes} bytes` : '';
      return `- ${fmValue(artifact.path)} (sha256:${artifact.sha256.slice(0, 16)}…${size})`;
    }
    // Two histories end without a hash, and the view says which: the file could not be read when the
    // record was written, or the record predates hashing and never had one.
    return artifact?.unreadable === true
      ? `- ${fmValue(artifact.path)} (not readable when recorded: hash unavailable)`
      : `- ${fmValue(artifact?.path)} (no hash recorded)`;
  }).join('\n');
}

export function evidenceDoc(state, threadId, evidenceId) {
  const record = state.evidence.get(evidenceKey(threadId, evidenceId));
  if (record === undefined) return undefined;
  return {
    frontmatter: { ...(record.meta ?? {}) },
    sections: { ...(record.sections ?? {}), Artifacts: artifactLines(record.artifacts) },
    title: record.meta?.title,
  };
}

/**
 * ENGAGEMENT.md. Values are still made inert, although nothing parses this file any more: a reader
 * should not be shown a forged `confirmed: true` line either.
 */
export function renderEngagement(frontmatter, sections) {
  const order = ['engagement', 'programme', 'programme_url', 'target', 'revision', 'authorization', 'allowed_hosts', 'concurrency', 'confirmed', 'updated'];
  const lines = ['---'];
  for (const key of order) {
    const value = fmValue(frontmatter[key]);
    if (value !== '') lines.push(`${key}: ${value}`);
  }
  lines.push('---', '');
  for (const [heading, text] of Object.entries(sections)) {
    lines.push(`## ${fmValue(heading)}`, '', inertSectionBody(text).trim() || 'none', '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

export function renderIndex(state) {
  const rows = [];
  for (const id of [...state.threads.keys()].sort()) {
    const doc = threadDoc(state, id);
    const fm = doc.frontmatter;
    const cell = (text) => text.replaceAll('|', '\\|');
    rows.push(
      `| ${id} | ${fmValue(fm.status ?? 'unknown')} | ${fmValue(fm.stage ?? 'none')} | ${cell(clip(doc.sections.Question ?? '', 120))} | ${doc.links.map((link) => link.id).join(', ') || 'none'} | ${cell(clip(doc.sections['Next action'] ?? '', 80) || 'none')} |`,
    );
  }
  return [
    '# Research threads',
    '',
    'Generated by the harness from the research journal. Editing it changes nothing.',
    '',
    '| id | status | stage | question | evidence | next action |',
    '|----|--------|-------|----------|----------|-------------|',
    ...rows,
    '',
  ].join('\n');
}

export function renderDeferrals(state, cap = 200) {
  const all = state.deferrals;
  const kept = all.slice(Math.max(0, all.length - cap));
  const dropped = all.length - kept.length;
  const lines = ['# Deferrals', '', 'Obstacles recorded instead of ending a goal. Newest last.', ''];
  if (dropped > 0) lines.push(`(${dropped} older entr${dropped === 1 ? 'y is' : 'ies are'} kept in the journal and not shown here.)`, '');
  for (const entry of kept) {
    lines.push(`## ${fmValue(entry.at)}`, '', `- reason: ${fmValue(entry.reason)}`);
    if (isFilled(entry.blocked_on)) lines.push(`- blocked on: ${fmValue(entry.blocked_on)}`);
    if (isFilled(entry.thread)) lines.push(`- thread: ${fmValue(entry.thread)}`);
    if (isFilled(entry.next_action)) lines.push(`- next action: ${fmValue(entry.next_action)}`);
    lines.push(`- session: ${fmValue(entry.session ?? '-')}`, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The files one journal entry makes stale, as `relative path → text`.
 * With no entry, every file the state gives rise to.
 */
export function viewFiles(state, event, options = {}) {
  const files = new Map();
  const threads = new Set();
  const evidence = new Set();
  let engagement = false;
  let deferrals = false;
  let archived = false;
  if (event === undefined) {
    for (const id of state.threads.keys()) threads.add(id);
    for (const key of state.evidence.keys()) evidence.add(key);
    engagement = state.engagement !== undefined;
    deferrals = state.deferrals.length > 0;
  } else {
    for (const op of event.ops ?? []) {
      if (op.kind === 'thread') threads.add(op.id);
      if (op.kind === 'evidence') {
        evidence.add(evidenceKey(op.thread, op.id));
        threads.add(op.thread);
      }
      if (op.kind === 'engagement') {
        engagement = true;
        archived = archived || op.archive === true;
      }
      if (op.kind === 'deferral') deferrals = true;
    }
  }
  for (const id of threads) {
    const doc = threadDoc(state, id);
    if (doc !== undefined) files.set(`threads/${id}/index.md`, renderThread(doc.frontmatter, doc.sections));
  }
  for (const key of evidence) {
    const [threadId, evidenceId] = key.split('/');
    const doc = evidenceDoc(state, threadId, evidenceId);
    if (doc !== undefined) files.set(`threads/${threadId}/evidence/${evidenceId}.md`, renderEvidence(doc.frontmatter, doc.sections));
  }
  if (threads.size > 0 || event === undefined) files.set('threads/INDEX.md', renderIndex(state));
  if (engagement && state.engagement !== undefined) {
    const doc = engagementView(state);
    files.set('ENGAGEMENT.md', renderEngagement(doc.frontmatter, doc.sections));
  }
  if (archived && state.engagementHistory.length > 0) {
    const last = state.engagementHistory[state.engagementHistory.length - 1];
    const doc = engagementView({ engagement: last.record });
    files.set(`ENGAGEMENT.${String(last.at).replace(/[:.]/g, '-')}.md`, renderEngagement(doc.frontmatter, doc.sections));
  }
  if (deferrals) files.set('DEFERRALS.md', renderDeferrals(state, options.deferralsMaxEntries));
  return files;
}
