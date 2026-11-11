/**
 * Reader for research state written before the journal existed.
 *
 * Until then the Markdown files under research/ were the state, and these functions were how the
 * harness read it back. They are kept only so that state can be imported once. Nothing the plugin
 * loads imports this file: at run time no Markdown is ever parsed.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { executionAttestation, isFilled } from '../lib/rules.js';

/** Strip one fence layer from a stored block. The info string is any run without a newline or backtick. */
function unwrapFence(body) {
  const wrapped = /^(`{3,})[^\n`]*\n([\s\S]*)\n\1$/.exec(String(body));
  return wrapped === null ? String(body) : wrapped[2];
}

/** Older rewrites nested one fence per pass, so a stored block may carry several layers. */
function unwrapAll(body) {
  let text = String(body ?? '');
  for (;;) {
    const next = unwrapFence(text);
    if (next === text) return text;
    text = next;
  }
}

/**
 * Parse a legacy state file: `key: value` frontmatter, a `# ` title and `## ` sections.
 * Headings are recognised only outside fenced blocks, because captured output contains `## ` lines.
 */
export function parseStateFile(text) {
  text = String(text ?? '').replace(/\r\n/g, '\n');
  const frontmatter = {};
  let body = text;
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (match) {
    body = text.slice(match[0].length);
    for (const line of match[1].split('\n')) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const key = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).trim();
      if (key) frontmatter[key] = value;
    }
  }

  const sections = {};
  const order = [];
  const duplicates = [];
  let fenceRun = 0;
  let current;
  let buffer = [];
  const flush = () => {
    if (current !== undefined) {
      sections[current] = unwrapFence(buffer.join('\n').trim());
      if (order.filter((name) => name === current).length > 1) duplicates.push(current);
    }
    buffer = [];
  };
  let title;
  for (const line of body.split('\n')) {
    const fenceMatch = /^\s*(`{3,})/.exec(line);
    if (fenceMatch !== null) {
      const run = fenceMatch[1].length;
      if (fenceRun === 0) fenceRun = run;
      else if (run >= fenceRun && /^\s*`{3,}\s*$/.test(line)) fenceRun = 0;
      if (current !== undefined) buffer.push(line);
      continue;
    }
    if (fenceRun === 0) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading !== null) {
        flush();
        current = heading[1];
        order.push(current);
        continue;
      }
      const top = /^#\s+(.+?)\s*$/.exec(line);
      if (top !== null && current === undefined && title === undefined) {
        title = top[1];
        continue;
      }
    }
    if (current !== undefined) buffer.push(line);
  }
  flush();
  // `links` is what the gate rules read; in a legacy file the Evidence list is the only source.
  return { frontmatter, sections, order, title, duplicates, links: evidenceLinks(sections) };
}

/** Evidence links of a legacy thread: whole list items of the form `- [E-001: title](path)`. */
export function evidenceLinks(sections) {
  const links = [];
  for (const line of String(sections?.Evidence ?? '').split('\n')) {
    const found = /^\s*[-*]\s*\[([A-Z]-\d+):\s*(.*)\]\(([^()]+)\)\s*$/.exec(line);
    if (found !== null) links.push({ id: found[1], title: found[2], path: found[3] });
  }
  return links;
}

/** The hosts a legacy pending scope request asked for: only its leading `requested host:` lines. */
export function pendingRequestedHosts(sectionText) {
  const hosts = [];
  for (const line of String(sectionText ?? '').replace(/\r\n/g, '\n').trim().split('\n')) {
    const match = /^requested host:\s*(\S+)\s*$/i.exec(line);
    if (match === null) break;
    hosts.push(match[1]);
  }
  return hosts;
}

const present = (value) => {
  const text = String(value ?? '').trim();
  return text !== '' && text.toLowerCase() !== 'none';
};

function metaOf(frontmatter) {
  const meta = {};
  for (const [key, value] of Object.entries(frontmatter ?? {})) {
    if (key === '__proto__' || String(value ?? '') === '') continue;
    meta[key] = String(value);
  }
  return meta;
}

function sectionsOf(parsed, skip, transform = unwrapAll) {
  const sections = {};
  for (const [heading, body] of Object.entries(parsed.sections ?? {})) {
    if (heading === '__proto__' || skip.includes(heading) || !present(body)) continue;
    sections[heading] = transform(body);
  }
  return sections;
}

/** The engagement file escaped the lines its parser would have read as structure; undo that. */
const unescapeInert = (text) => String(text ?? '')
  .split('\n')
  .map((line) => (/^\\(?:#{1,2}[ \t]+\S|\s*`{3,})/.test(line) ? line.slice(1) : line))
  .join('\n');

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return undefined;
    throw error;
  }
}

function artifactsOf(sectionText) {
  const artifacts = [];
  for (const line of String(sectionText ?? '').split('\n')) {
    const trimmed = line.trim();
    const hashed = /^-\s+(.*?)\s+\(sha256:([0-9a-f]{16,64})/.exec(trimmed);
    if (hashed !== null) {
      const size = /,\s*(\d+) bytes\)\s*$/.exec(trimmed);
      artifacts.push({ path: hashed[1], sha256: hashed[2], ...(size === null ? {} : { bytes: Number(size[1]) }) });
      continue;
    }
    const bare = /^-\s+(.+)$/.exec(trimmed);
    if (bare === null) continue;
    // Only the note the old harness wrote is taken off. Anything else in brackets is part of what
    // the line cites, and a view worded some new way must fail to read back rather than pass.
    const note = /\s+\((?:not readable|hash unavailable)[^)]*\)\s*$/i;
    const cited = bare[1].replace(note, '').trim();
    // A line the harness marked unreadable keeps that mark; a bare line never had a hash at all.
    if (present(cited)) artifacts.push({ path: cited, ...(/\((?:not readable|hash unavailable)/i.test(bare[1]) ? { unreadable: true } : {}) });
  }
  return artifacts;
}

function evidenceRecord(text, threadId, evidenceId, notes) {
  const parsed = parseStateFile(text);
  const meta = metaOf(parsed.frontmatter);
  if (meta.id !== undefined && meta.id !== evidenceId) notes.push(`${threadId}/${evidenceId}: the file calls itself ${meta.id}; imported under the id it is filed and linked as`);
  if (meta.thread !== undefined && meta.thread !== threadId) notes.push(`${threadId}/${evidenceId}: the file names thread ${meta.thread}; imported under the thread that holds it`);
  meta.id = evidenceId;
  meta.thread = threadId;
  if (meta.title === undefined && present(parsed.title) && parsed.title !== evidenceId) meta.title = parsed.title;
  if (parsed.duplicates.length > 0) notes.push(`${threadId}/${evidenceId}: repeated section heading(s) ${[...new Set(parsed.duplicates)].join(', ')}; the last one was kept, as before`);
  return {
    meta,
    sections: sectionsOf(parsed, ['Artifacts']),
    artifacts: artifactsOf(parsed.sections.Artifacts),
  };
}

function requestOf(sectionText) {
  const body = String(sectionText ?? '').replace(/\r\n/g, '\n').trim();
  const hosts = pendingRequestedHosts(body);
  const labels = { 'Blocked work': 'blocked_work', Justification: 'justification', Evidence: 'evidence', 'Risk if wrong': 'risk', 'Requested at': 'at' };
  const request = { hosts };
  let field;
  for (const line of body.split('\n').slice(hosts.length)) {
    const label = /^(Blocked work|Justification|Evidence|Risk if wrong|Requested at):\s?(.*)$/.exec(line);
    if (label !== null) {
      field = labels[label[1]];
      request[field] = label[2];
    } else if (field !== undefined) {
      request[field] = `${request[field]}\n${line}`;
    }
  }
  for (const key of Object.keys(request)) {
    if (typeof request[key] === 'string') request[key] = request[key].trim();
  }
  return request;
}

function deferralsOf(text) {
  const names = { reason: 'reason', 'blocked on': 'blocked_on', thread: 'thread', 'next action': 'next_action', session: 'session' };
  const entries = [];
  let entry;
  let field;
  for (const line of String(text ?? '').replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      entry = { at: heading[1] };
      entries.push(entry);
      field = undefined;
      continue;
    }
    if (entry === undefined) continue;
    const item = /^- (reason|blocked on|thread|next action|session):\s?(.*)$/.exec(line);
    if (item !== null) {
      field = names[item[1]];
      entry[field] = item[2];
    } else if (field !== undefined && line.trim() !== '') {
      entry[field] = `${entry[field]}\n${line}`;
    }
  }
  return entries.filter((item) => present(item.reason));
}

async function telemetryTail(file, maxLines = 20000) {
  const text = await readIfExists(file);
  if (text === undefined) return [];
  const events = [];
  for (const line of text.split('\n').slice(-maxLines)) {
    if (line.trim() === '') continue;
    try {
      events.push(JSON.parse(line));
    } catch { /* a truncated line is not an event */ }
  }
  return events;
}

/**
 * Everything a legacy research directory holds, as journal changes.
 *
 * Returns `{ batches, notes, counts }`. Each batch becomes one journal entry: the engagement, then
 * one per thread (the thread together with its evidence records), then deferrals and any pending
 * completion claim. `notes` lists whatever was not in the canonical shape and what was done about it.
 */
export async function readLegacy(root, options = {}) {
  const notes = [];
  const batches = [];
  const counts = { threads: 0, evidence: 0, unlinkedEvidence: 0, missingEvidence: 0, deferrals: 0, completions: 0, attested: 0 };
  const ledger = await telemetryTail(path.join(root, 'telemetry', 'events.jsonl'));
  const executionTools = options.executionTools ?? ['bash', 'pwsh', 'shell', 'exec'];

  const engagementText = await readIfExists(path.join(root, 'ENGAGEMENT.md'));
  if (engagementText !== undefined) {
    const parsed = parseStateFile(engagementText);
    const meta = metaOf(parsed.frontmatter);
    meta.allowed_hosts = String(meta.allowed_hosts ?? '').split(',').map((host) => host.trim()).filter(Boolean);
    const record = { meta, sections: sectionsOf(parsed, ['Pending scope request'], unescapeInert) };
    // "none" is what an empty section was written as; an engagement section that says so is kept.
    for (const [heading, body] of Object.entries(parsed.sections)) {
      if (heading !== 'Pending scope request' && heading !== '__proto__' && String(body).trim() !== '' && record.sections[heading] === undefined) {
        record.sections[heading] = String(body);
      }
    }
    if (present(parsed.sections['Pending scope request'])) record.request = requestOf(parsed.sections['Pending scope request']);
    if (parsed.duplicates.length > 0) notes.push(`ENGAGEMENT.md: repeated section heading(s) ${[...new Set(parsed.duplicates)].join(', ')}; the last one was kept, as before`);
    batches.push({ label: 'engagement', ops: [{ kind: 'engagement', put: record }] });
  }

  let entries = [];
  try {
    entries = await fs.readdir(path.join(root, 'threads'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const id of entries.filter((entry) => /^thr-\d+$/.test(entry)).sort()) {
    const dir = path.join(root, 'threads', id);
    const text = await readIfExists(path.join(dir, 'index.md'));
    if (text === undefined) {
      notes.push(`${id}: the directory holds no index.md; not imported`);
      continue;
    }
    const parsed = parseStateFile(text);
    const meta = metaOf(parsed.frontmatter);
    if (meta.id !== undefined && meta.id !== id) notes.push(`${id}: the file calls itself ${meta.id}; imported under its directory name`);
    meta.id = id;
    if (meta.title === undefined && present(parsed.title) && parsed.title !== id) meta.title = parsed.title;

    const links = evidenceLinks(parsed.sections);
    const residue = unwrapAll(parsed.sections.Evidence ?? '').split('\n')
      .filter((line) => present(line) && evidenceLinks({ Evidence: line }).length === 0);
    const sections = sectionsOf(parsed, ['Evidence']);
    if (residue.length > 0) {
      sections.Evidence = residue.join('\n');
      notes.push(`${id}: the Evidence section holds ${residue.length} line(s) that are not links; kept as text`);
    }

    const ops = [];
    const listed = [];
    const taken = new Set();
    for (const link of links) {
      if (listed.includes(link.id)) {
        notes.push(`${id}: ${link.id} is linked more than once; listed once`);
        continue;
      }
      listed.push(link.id);
      if (link.path !== `evidence/${link.id}.md`) notes.push(`${id}: ${link.id} is linked at ${link.path}, not evidence/${link.id}.md; the linked file was imported`);
      const evidenceText = await readIfExists(path.join(dir, link.path));
      if (evidenceText === undefined) {
        counts.missingEvidence += 1;
        notes.push(`${id}: ${link.id} is linked but its file does not exist; the gate reports it missing, as before`);
        continue;
      }
      taken.add(path.normalize(link.path));
      const linked = evidenceRecord(evidenceText, id, link.id, notes);
      // Early records carry their title only in the thread's link text. The link is not kept as text
      // any more, so the title moves onto the record or it would be lost.
      if (linked.meta.title === undefined && present(link.title) && link.title.trim() !== link.id) {
        linked.meta.title = link.title.trim();
      }
      ops.push({ kind: 'evidence', thread: id, id: link.id, put: linked });
    }
    let files = [];
    try {
      files = await fs.readdir(path.join(dir, 'evidence'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    for (const file of files.filter((name) => /^E-\d+\.md$/.test(name)).sort()) {
      const evidenceId = file.slice(0, -3);
      if (taken.has(path.normalize(`evidence/${file}`)) || listed.includes(evidenceId)) continue;
      counts.unlinkedEvidence += 1;
      notes.push(`${id}: ${evidenceId} exists but the thread does not link it; imported unlinked (vr_repair reports it)`);
      ops.push({ kind: 'evidence', thread: id, id: evidenceId, put: evidenceRecord(await fs.readFile(path.join(dir, 'evidence', file), 'utf8'), id, evidenceId, notes) });
    }
    for (const op of ops) {
      const record = op.put;
      if (String(record.meta.kind ?? '').trim().toLowerCase() !== 'execution') continue;
      // Kept only when the ledger supports the record today: that support is what would be lost as the
      // ledger rotates. A record it does not support stays undecided and is judged as it was before.
      const caveats = executionAttestation(
        [{ id: op.id, exists: true, kind: 'execution', session: String(record.meta.session ?? '').trim(), created: String(record.meta.created ?? '').trim() }],
        ledger,
        { executionTools },
      );
      if (caveats.length === 0) {
        record.attested = true;
        counts.attested += 1;
      }
    }
    counts.evidence += ops.length;
    counts.threads += 1;
    const thread = { meta, sections, evidence: listed };
    if (parsed.duplicates.length > 0) {
      thread.duplicates = [...new Set(parsed.duplicates)];
      notes.push(`${id}: repeated section heading(s) ${thread.duplicates.join(', ')}; the last one was kept and the gate still reports it`);
    }
    batches.push({ label: id, ops: [{ kind: 'thread', id, put: thread }, ...ops] });
  }

  const deferrals = deferralsOf(await readIfExists(path.join(root, 'DEFERRALS.md')));
  if (deferrals.length > 0) {
    counts.deferrals = deferrals.length;
    batches.push({ label: 'deferrals', ops: deferrals.map((add) => ({ kind: 'deferral', add })) });
  }

  const claimText = await readIfExists(path.join(root, 'COMPLETION-PENDING.json'));
  if (claimText !== undefined) {
    try {
      const claim = JSON.parse(claimText);
      if (!isFilled(String(claim?.goalId ?? ''))) throw new Error('it names no goal');
      counts.completions = 1;
      batches.push({ label: 'completion', ops: [{ kind: 'completion', key: String(claim.goalId), put: claim }] });
    } catch (error) {
      notes.push(`COMPLETION-PENDING.json: not imported (${error instanceof Error ? error.message : String(error)}); claim again with vr_finish_goal`);
    }
  }
  return { batches, notes, counts };
}
