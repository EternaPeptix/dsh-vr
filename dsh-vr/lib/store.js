/**
 * The journal on disk: one file, appended to under a lock, verified on every read.
 *
 * `journal.js` decides what a line means; this module only reads the file, appends to it and
 * rewrites the Markdown views after each append.
 */
import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { applyEvent, emptyState, integrityRefusal, loadJournal, sealEvent, storable } from './journal.js';
import { viewFiles } from './views.js';

export const JOURNAL_FILE = 'journal.jsonl';
const LOCK_FILE = 'journal.lock';
const LOCK_STALE_MS = 30000;
const LOCK_WAIT_MS = 10000;

export const defaultKeyFile = () => path.join(os.homedir(), '.dsh-vr', 'journal.key');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function writeAtomic(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.open(temp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

const keys = new Map();

/**
 * The secret journal lines are sealed with. It lives outside the research directory so that writing
 * a file in the workspace is not enough to add a line the harness will believe. Created on first use,
 * unless the caller is a reader that must not write (`create: false`).
 */
export async function journalKey(keyFile, options = {}) {
  const file = keyFile && keyFile !== '' ? keyFile : defaultKeyFile();
  if (keys.has(file)) return keys.get(file);
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`the journal key ${file} cannot be read: ${error.message}`);
    if (options.create === false) throw new Error(`the journal key ${file} does not exist, so the journal cannot be verified`);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(file, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    } catch (inner) {
      if (inner?.code !== 'EEXIST') throw new Error(`the journal key ${file} cannot be created: ${inner.message}`);
    }
    text = await fs.readFile(file, 'utf8');
  }
  const hex = text.trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`the journal key ${file} is not the 64 hexadecimal characters this harness writes`);
  const key = Buffer.from(hex, 'hex');
  keys.set(file, key);
  return key;
}

/**
 * Where the journal's last written position is remembered: next to the key, outside the research
 * directory, one file per journal path.
 */
export function anchorFile(journalFile, keyFile) {
  const dir = path.join(path.dirname(keyFile && keyFile !== '' ? keyFile : defaultKeyFile()), 'heads');
  return path.join(dir, `${createHash('sha256').update(path.resolve(journalFile)).digest('hex').slice(0, 24)}.json`);
}

/** `{ seq, head }` as last written for this journal, or undefined when none was ever written. */
export async function readAnchor(journalFile, keyFile) {
  let text;
  try {
    text = await fs.readFile(anchorFile(journalFile, keyFile), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw new Error(`the journal position file ${anchorFile(journalFile, keyFile)} cannot be read: ${error.message}`);
  }
  let anchor;
  try {
    anchor = JSON.parse(text);
  } catch {
    anchor = undefined;
  }
  if (!Number.isInteger(anchor?.seq) || typeof anchor?.head !== 'string') {
    throw new Error(`the journal position file ${anchorFile(journalFile, keyFile)} is not what this harness writes; an operator has to look at it`);
  }
  return { seq: anchor.seq, head: anchor.head };
}

export async function writeAnchor(journalFile, keyFile, state) {
  await writeAtomic(
    anchorFile(journalFile, keyFile),
    `${JSON.stringify({ journal: path.resolve(journalFile), seq: state.seq, head: state.head })}\n`,
  );
}

function cloneState(state) {
  return {
    ...state,
    engagementHistory: [...state.engagementHistory],
    threads: new Map(state.threads),
    evidence: new Map(state.evidence),
    deferrals: [...state.deferrals],
    completions: new Map(state.completions),
  };
}

/** Whether a directory holds research state written before the journal existed. */
async function legacyStatePresent(root) {
  try {
    await fs.access(path.join(root, 'ENGAGEMENT.md'));
    return true;
  } catch { /* fall through to the thread directory */ }
  try {
    const entries = await fs.readdir(path.join(root, 'threads'));
    return entries.some((entry) => /^thr-\d{3,}$/.test(entry));
  } catch {
    return false;
  }
}

async function stampOf(file) {
  try {
    const stat = await fs.stat(file);
    return `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
  } catch (error) {
    if (error?.code === 'ENOENT') return 'absent';
    throw error;
  }
}

/** One verified read of the journal as it stands on disk. With `createKey: false` nothing is written. */
async function loadVerified(root, file, keyFile, stamp, createKey) {
  // A reader that must not write needs the key only when there is a journal to verify.
  const key = createKey || stamp !== 'absent' ? await journalKey(keyFile, { create: createKey }) : undefined;
  const anchor = await readAnchor(file, keyFile);
  if (stamp === 'absent' && anchor !== undefined && anchor.seq > 0) {
    // The Markdown views are still on disk at this point, so without this check a deleted journal
    // would look like state from before the journal existed, ready to be imported again.
    return {
      state: emptyState(),
      integrity: {
        ok: false,
        keyed: true,
        events: 0,
        partialTail: false,
        absent: true,
        problem: { line: 1, reason: `is missing: the journal held ${anchor.seq} entries when this harness last wrote to it, and the file is gone` },
      },
      validBytes: 0,
    };
  }
  if (stamp === 'absent') {
    return {
      state: emptyState(),
      integrity: { ok: true, keyed: true, events: 0, partialTail: false, absent: true, legacy: await legacyStatePresent(root) },
      validBytes: 0,
    };
  }
  return loadJournal(await fs.readFile(file, 'utf8'), key, anchor);
}

/** Why a journal may not be used, or undefined. */
function refusalOf(integrity) {
  if (integrity.legacy === true) {
    return 'this research directory holds state written before the journal existed, and no journal. Import it once with `node tools/journal.mjs import <research dir>`; until then nothing is read from or written to it.';
  }
  return integrityRefusal(integrity);
}

/**
 * The verified state of a research directory, for a reader that must not write: no key is created,
 * no lock is taken and no view is rewritten. `refusal` says why the state may not be used.
 */
export async function readResearch(root, options = {}) {
  const file = path.join(root, JOURNAL_FILE);
  const loaded = await loadVerified(root, file, options.keyFile, await stampOf(file), false);
  return { state: loaded.state, integrity: loaded.integrity, refusal: refusalOf(loaded.integrity) };
}

class Store {
  constructor(root, options) {
    this.root = root;
    this.options = options;
    this.file = path.join(root, JOURNAL_FILE);
    this.cached = undefined;
  }

  stamp() {
    return stampOf(this.file);
  }

  /** `{ state, integrity, validBytes }`, re-read whenever the file changed underneath. */
  async read() {
    const stamp = await this.stamp();
    if (this.cached !== undefined && this.cached.stamp === stamp) return this.cached;
    this.cached = { ...(await loadVerified(this.root, this.file, this.options.keyFile, stamp, true)), stamp };
    return this.cached;
  }

  /** Identifies the journal file as it was last read by this process. */
  lastStamp() {
    return this.cached?.stamp;
  }

  /** Why this journal may not be used, or undefined. */
  refusal(integrity) {
    return refusalOf(integrity);
  }

  /** The verified state, or a refusal an operator can act on. */
  async state() {
    const { state, integrity } = await this.read();
    const refusal = this.refusal(integrity);
    if (refusal !== undefined) throw new Error(refusal);
    return state;
  }

  async lock() {
    const file = path.join(this.root, LOCK_FILE);
    await fs.mkdir(this.root, { recursive: true });
    const deadline = Date.now() + LOCK_WAIT_MS;
    for (;;) {
      try {
        const handle = await fs.open(file, 'wx');
        await handle.writeFile(`${process.pid}\n`);
        await handle.close();
        return async () => { await fs.rm(file, { force: true }); };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const stat = await fs.stat(file).catch(() => undefined);
        // A writer holds the lock for one append. One this old belongs to a process that died.
        if (stat !== undefined && Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          await fs.rm(file, { force: true });
          continue;
        }
        if (Date.now() > deadline) throw new Error('the research journal is locked by another writer; nothing was written — call again');
        await sleep(25);
      }
    }
  }

  /**
   * Append one entry holding `ops`. The entry is applied to a copy of the state first, so a change
   * the journal would refuse on reload is never written.
   *
   * `expected` is the stamp of the journal the caller decided from; the append is refused if the
   * file has moved on since.
   */
  async commit(who, ops, expected) {
    const wanted = (storable(ops) ?? []).filter((op) => op !== null && op !== undefined);
    if (wanted.length === 0) return { event: undefined, state: (await this.read()).state };
    const release = await this.lock();
    try {
      const current = await this.read();
      const refusal = this.refusal(current.integrity);
      if (refusal !== undefined) throw new Error(refusal);
      // The caller decided what to write from the state it read. If another process appended since,
      // that decision was made about a state that no longer exists.
      if (expected !== undefined && expected !== current.stamp) {
        throw new Error('the research journal changed while this call was running (another process wrote to it); nothing was written — call again');
      }
      const key = await journalKey(this.options.keyFile);
      const { line, event } = sealEvent({
        seq: current.state.seq + 1,
        ts: new Date().toISOString(),
        session: String(who?.session ?? '-'),
        tool: String(who?.tool ?? '-'),
        call: who?.call === undefined ? undefined : String(who.call),
        ops: wanted,
      }, current.state.head, key);
      const next = applyEvent(cloneState(current.state), event);
      await fs.mkdir(this.root, { recursive: true });
      const handle = await fs.open(this.file, 'a+');
      try {
        // An append that was cut short left an unterminated line; it was never part of the state.
        if (current.integrity.partialTail) await handle.truncate(current.validBytes);
        await handle.appendFile(`${line}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.cached = {
        state: next,
        integrity: { ok: true, keyed: true, events: current.integrity.events + 1, partialTail: false },
        validBytes: current.validBytes + Buffer.byteLength(line, 'utf8') + 1,
        stamp: await this.stamp(),
      };
      // Written after the line it describes, so it can only ever be behind the journal, never ahead.
      const anchorProblem = await writeAnchor(this.file, this.options.keyFile, next).then(
        () => undefined,
        (error) => `the change is recorded, but its position could not be remembered outside the workspace, so removing it later would go unnoticed (${error instanceof Error ? error.message : String(error)})`,
      );
      const viewProblem = await this.writeViews(next, event);
      return { event, state: next, viewProblem: [anchorProblem, viewProblem].filter((part) => part !== undefined).join('; ') || undefined };
    } finally {
      await release();
    }
  }

  /** Rewrite the Markdown a change made stale. A failure here loses no state: the journal has it. */
  async writeViews(state, event) {
    try {
      for (const [relative, text] of viewFiles(state, event, this.options)) {
        await writeAtomic(path.join(this.root, relative), text);
      }
      return undefined;
    } catch (error) {
      return `the change is recorded, but a Markdown view could not be rewritten (${error instanceof Error ? error.message : String(error)})`;
    }
  }
}

const stores = new Map();

export function openStore(root, options = {}) {
  const key = `${root}\u0000${options.keyFile ?? ''}`;
  if (!stores.has(key)) stores.set(key, new Store(root, options));
  const store = stores.get(key);
  store.options = options;
  return store;
}

let queue = Promise.resolve();

/**
 * Run one state-changing call at a time. A tool reads the state, decides, then writes; two calls
 * interleaved between those steps used to allocate the same id and overwrite each other.
 */
export function exclusive(work) {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}
