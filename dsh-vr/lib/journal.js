/**
 * The research journal: an append-only list of state changes, and the state they add up to.
 *
 * Research state used to live in Markdown files that were parsed back on every read. Text supplied
 * by the agent, or copied off a target, was written into a format whose structure is carried by the
 * text itself — a line that starts with `## `, a `---`, a run of backticks — so every writer had to
 * escape, every reader had to agree with every writer, and each disagreement was a way for stored
 * text to become structure: a forged section, a second `confirmed: true`.
 *
 * Here structure is never carried by the text. One line of JSON records one change; a field is a
 * JSON key, a list is a JSON array, and a value is only ever a value. The Markdown files still exist,
 * but they are written from this state and never read back.
 *
 * Nothing in this module touches the filesystem or a plugin API. `store.js` does the I/O.
 */
import { createHmac } from 'node:crypto';

export const JOURNAL_VERSION = 1;

/** What the first line names as the line before it. */
export const GENESIS = '0'.repeat(64);

export const THREAD_ID = /^thr-\d{3,}$/;
export const EVIDENCE_ID = /^E-\d{3,}$/;

/** Used when no key file can be read or created: the chain still links, but anyone can extend it. */
const UNKEYED = Buffer.from('dsh-vr journal without a key', 'utf8');

/** Record fields that are maps of independent entries; every other field is replaced as a whole. */
const MAP_FIELDS = new Set(['meta', 'sections']);

export const evidenceKey = (thread, id) => `${thread}/${id}`;

export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * What a value becomes once it has been written and read back.
 *
 * Applied before a change is compared or stored, so the state held in memory is always the state a
 * reload would produce: `undefined` entries are absent, not present-and-empty.
 */
export function storable(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function refuseKey(key) {
  // Assigning this key on an ordinary object changes its prototype instead of storing a value.
  if (key === '__proto__') throw new Error('refusing to store a field named "__proto__"');
}

/**
 * The change that turns `base` into `next`, or undefined when there is none.
 *
 * Only what changed is recorded, so the journal reads as a history of decisions rather than a pile
 * of snapshots: one line shows that a status moved, not the whole thread again.
 */
export function diffRecord(base, next) {
  const set = {};
  const unset = {};
  for (const field of new Set([...Object.keys(base ?? {}), ...Object.keys(next ?? {})])) {
    refuseKey(field);
    const before = base?.[field];
    const after = next?.[field];
    if (MAP_FIELDS.has(field)) {
      const changed = {};
      const removed = [];
      for (const key of Object.keys(after ?? {})) {
        refuseKey(key);
        if (!same(before?.[key], after[key])) changed[key] = after[key];
      }
      for (const key of Object.keys(before ?? {})) {
        if (after === undefined || !(key in after)) removed.push(key);
      }
      if (Object.keys(changed).length > 0) set[field] = changed;
      if (removed.length > 0) unset[field] = removed;
    } else if (after === undefined) {
      if (before !== undefined) (unset.fields ??= []).push(field);
    } else if (!same(before, after)) {
      set[field] = after;
    }
  }
  const hasSet = Object.keys(set).length > 0;
  const hasUnset = Object.keys(unset).length > 0;
  if (!hasSet && !hasUnset) return undefined;
  return { ...(hasSet ? { set } : {}), ...(hasUnset ? { unset } : {}) };
}

/** The record `delta` describes, starting from `record`. Never changes `record`. */
export function applyDelta(record, delta) {
  if (record === undefined || record === null) throw new Error('a change was recorded for something that does not exist');
  const next = { ...record };
  for (const [field, value] of Object.entries(delta.set ?? {})) {
    refuseKey(field);
    if (MAP_FIELDS.has(field)) {
      for (const key of Object.keys(value)) refuseKey(key);
      next[field] = { ...(record[field] ?? {}), ...value };
    } else {
      next[field] = value;
    }
  }
  for (const [field, keys] of Object.entries(delta.unset ?? {})) {
    if (field === 'fields') {
      for (const key of keys) delete next[key];
      continue;
    }
    refuseKey(field);
    const map = { ...(next[field] ?? {}) };
    for (const key of keys) delete map[key];
    next[field] = map;
  }
  return next;
}

export function emptyState() {
  return {
    /** The current engagement record, or undefined before any intake. */
    engagement: undefined,
    /** Engagements that were replaced: `{ at, record }`, oldest first. */
    engagementHistory: [],
    /** thread id → `{ meta, sections, evidence: [ids] }` */
    threads: new Map(),
    /** `thr-NNN/E-NNN` → `{ meta, sections, artifacts, attestation }` */
    evidence: new Map(),
    deferrals: [],
    /** goal id → pending completion claim */
    completions: new Map(),
    seq: 0,
    head: GENESIS,
  };
}

function applyOp(state, op, event) {
  switch (op?.kind) {
    case 'thread': {
      if (!THREAD_ID.test(String(op.id))) throw new Error(`names a thread id that is not one: ${JSON.stringify(op.id)}`);
      const next = op.put !== undefined ? op.put : applyDelta(state.threads.get(op.id), op);
      state.threads.set(op.id, deepFreeze(next));
      return;
    }
    case 'evidence': {
      if (!THREAD_ID.test(String(op.thread)) || !EVIDENCE_ID.test(String(op.id))) {
        throw new Error(`names an evidence record that is not one: ${JSON.stringify([op.thread, op.id])}`);
      }
      const key = evidenceKey(op.thread, op.id);
      const next = op.put !== undefined ? op.put : applyDelta(state.evidence.get(key), op);
      state.evidence.set(key, deepFreeze(next));
      return;
    }
    case 'engagement': {
      if (op.archive === true && state.engagement !== undefined) {
        state.engagementHistory.push(deepFreeze({ at: event.ts, record: state.engagement }));
      }
      if (op.put !== undefined) state.engagement = op.put === null ? undefined : deepFreeze(op.put);
      else state.engagement = deepFreeze(applyDelta(state.engagement, op));
      return;
    }
    case 'deferral':
      state.deferrals.push(deepFreeze(op.add));
      return;
    case 'completion':
      if (op.put === null) state.completions.delete(String(op.key));
      else state.completions.set(String(op.key), deepFreeze(op.put));
      return;
    default:
      throw new Error(`holds a change of a kind this harness does not know: ${JSON.stringify(op?.kind)}`);
  }
}

/** Fold one journal entry into the state. Changes `state`. */
export function applyEvent(state, event) {
  if (!Array.isArray(event.ops)) throw new Error('holds no list of changes');
  for (const op of event.ops) applyOp(state, op, event);
  state.seq = event.seq;
  state.head = event.mac;
  state.updated = event.ts;
  return state;
}

const seal = (body, key) => createHmac('sha256', key ?? UNKEYED).update(body).digest('hex');

/**
 * One journal line for a change.
 *
 * The seal covers the whole entry, and the entry names the seal of the line before it, so a line
 * cannot be edited, removed or reordered without every later seal failing. The seal is keyed with a
 * secret kept outside the workspace: appending a well-formed line is then not enough to be believed.
 * That is evidence of tampering, not a wall — a process that can read the key can still forge a line.
 */
export function sealEvent(fields, prev, key) {
  const body = JSON.stringify({
    v: JOURNAL_VERSION,
    seq: fields.seq,
    ts: fields.ts,
    session: fields.session,
    tool: fields.tool,
    call: fields.call,
    ops: fields.ops,
    prev,
  });
  const mac = seal(body, key);
  // The entry as a reload will see it: whatever JSON dropped or normalised is already gone.
  return { line: `${body.slice(0, -1)},"mac":"${mac}"}`, event: { ...JSON.parse(body), mac } };
}

const SEALED_LINE = /^(\{.*),"mac":"([0-9a-f]{64})"\}$/s;

function openLine(line, key) {
  const match = SEALED_LINE.exec(line);
  if (match === null) throw new Error('is not a sealed journal entry');
  const body = `${match[1]}}`;
  if (seal(body, key) !== match[2]) throw new Error('does not carry the seal this harness would have written');
  return { ...JSON.parse(body), mac: match[2] };
}

/**
 * The state a journal adds up to, and whether every line of it can be believed.
 *
 * Reading stops at the first line that fails: what follows a broken line cannot be placed in the
 * chain, so nothing after it is applied. An unterminated last line is an append that was interrupted
 * and is ignored rather than treated as tampering.
 *
 * `anchor` is `{ seq, head }`: the last entry this harness wrote, remembered somewhere the journal's
 * own directory cannot reach. A chain proves that no line was edited; it cannot prove that the last
 * lines are still there, because a journal cut short is a shorter valid journal. The anchor can.
 */
export function loadJournal(text, key, anchor) {
  const state = emptyState();
  const raw = String(text ?? '');
  const lines = raw.split('\n');
  const tail = lines.pop();
  const integrity = { ok: true, keyed: key !== undefined, events: 0, partialTail: tail !== '' };
  let anchored;
  for (let index = 0; index < lines.length; index += 1) {
    try {
      const event = openLine(lines[index], key);
      if (event.v !== JOURNAL_VERSION) throw new Error(`was written as format ${JSON.stringify(event.v)}; this harness reads format ${JOURNAL_VERSION}`);
      if (event.prev !== state.head) throw new Error('does not follow the line before it');
      if (event.seq !== state.seq + 1) throw new Error(`is numbered ${JSON.stringify(event.seq)} where ${state.seq + 1} belongs`);
      applyEvent(state, event);
      integrity.events += 1;
      if (event.seq === anchor?.seq) anchored = event.mac;
    } catch (error) {
      integrity.ok = false;
      integrity.problem = { line: index + 1, reason: error instanceof Error ? error.message : String(error) };
      break;
    }
  }
  if (integrity.ok && Number.isInteger(anchor?.seq) && anchor.seq > 0) {
    if (state.seq < anchor.seq) {
      integrity.ok = false;
      integrity.problem = {
        line: integrity.events + 1,
        reason: `is missing: the journal ends at entry ${state.seq}, and this harness last wrote entry ${anchor.seq} — lines were removed from the end, or an older copy was put back`,
      };
    } else if (anchored !== anchor.head) {
      integrity.ok = false;
      integrity.problem = {
        line: anchor.seq,
        reason: 'is not the entry this harness wrote at that position: the journal was replaced by another one',
      };
    }
  }
  return { state, integrity, validBytes: Buffer.byteLength(raw, 'utf8') - Buffer.byteLength(tail, 'utf8') };
}

/** Every entry of a journal, unverified: for inspection and for resealing by an operator. */
export function journalEntries(text) {
  const entries = [];
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue;
    const match = SEALED_LINE.exec(line);
    entries.push(JSON.parse(match === null ? line : `${match[1]}}`));
  }
  return entries;
}

/** The next id in a zero-padded series such as thr-007 or E-012. */
export function nextNumbered(prefix, ids) {
  let highest = 0;
  for (const id of ids) {
    const text = String(id);
    if (!text.startsWith(prefix)) continue;
    const number = Number.parseInt(text.slice(prefix.length), 10);
    if (Number.isInteger(number) && number > highest) highest = number;
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

/** Evidence records of one thread, in id order. */
export function evidenceOfThread(state, threadId) {
  const prefix = `${threadId}/`;
  const records = [];
  for (const [key, record] of state.evidence) {
    if (key.startsWith(prefix)) records.push(record);
  }
  return records.sort((a, b) => String(a.meta?.id).localeCompare(String(b.meta?.id), 'en', { numeric: true }));
}

/** Why the journal cannot be written to, in words an operator can act on. */
export function integrityRefusal(integrity) {
  if (integrity?.ok !== false) return undefined;
  return [
    `the research journal failed verification at line ${integrity.problem?.line}: it ${integrity.problem?.reason}.`,
    'It was changed outside the harness, or its key was replaced. Nothing is written and no scope is treated as qualified until an operator has looked at it:',
    '`node tools/journal.mjs verify <research dir>` shows the line, and `reseal` accepts the journal as it stands.',
  ].join(' ');
}
