#!/usr/bin/env node
/**
 * Operator commands for the research journal. The plugin never runs these.
 *
 *   node tools/journal.mjs import <research dir> [--dry-run]   one-off: Markdown state → journal
 *   node tools/journal.mjs verify <research dir>               check every line and its seal
 *   node tools/journal.mjs render <research dir>               rewrite every Markdown view
 *   node tools/journal.mjs reseal <research dir>               accept the journal as it stands
 *
 * Options: --key <file>   the journal key (default ~/.dsh-vr/journal.key)
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { applyEvent, emptyState, journalEntries, loadJournal, sealEvent, storable } from '../lib/journal.js';
import { JOURNAL_FILE, anchorFile, defaultKeyFile, journalKey, openStore, readAnchor, writeAnchor } from '../lib/store.js';
import { readLegacy } from './legacy-markdown.mjs';

async function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await fs.open(temp, 'wx');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, file);
}

const exists = (file) => fs.access(file).then(() => true, () => false);

/** Seal a list of `{ session, tool, call, ts, ops }` into journal text, checking each one applies. */
export function sealAll(entries, key) {
  const state = emptyState();
  const lines = [];
  for (const entry of entries) {
    const { line, event } = sealEvent({ ...entry, seq: state.seq + 1 }, state.head, key);
    applyEvent(state, event);
    lines.push(line);
  }
  return { text: lines.length === 0 ? '' : `${lines.join('\n')}\n`, state };
}

const summary = (state) => `${state.threads.size} thread(s), ${state.evidence.size} evidence record(s), ${state.deferrals.length} deferral(s), ${state.completions.size} pending completion claim(s), engagement ${state.engagement === undefined ? 'none' : `${state.engagement.meta?.engagement ?? '?'} (confirmed ${state.engagement.meta?.confirmed ?? 'false'})`}`;

export async function importLegacy(root, options = {}) {
  const file = path.join(root, JOURNAL_FILE);
  if (await exists(file)) throw new Error(`${file} already exists: this directory has been imported. Nothing was changed.`);
  // The Markdown left behind by a journal is its views, which anything in the workspace can edit.
  // Importing them again would turn whatever they now say into state.
  const anchor = await readAnchor(file, options.keyFile);
  if (anchor !== undefined && anchor.seq > 0) {
    throw new Error(`${file} is gone, but a journal of ${anchor.seq} entries was written here before. Restore it from a backup. To start over from the Markdown instead, delete ${anchorFile(file, options.keyFile)} yourself first. Nothing was changed.`);
  }
  const { batches, notes, counts } = await readLegacy(root, options);
  const ts = new Date().toISOString();
  const key = await journalKey(options.keyFile);
  const { text, state } = sealAll(
    batches.map((batch) => ({ ts, session: '-', tool: 'import', call: batch.label, ops: storable(batch.ops) })),
    key,
  );
  // Read back exactly as the plugin will read it before anything is written.
  const reread = loadJournal(text, key);
  if (!reread.integrity.ok) throw new Error(`the journal built from this directory does not verify: line ${reread.integrity.problem.line} ${reread.integrity.problem.reason}`);
  if (options.dryRun !== true && batches.length > 0) {
    await writeAtomic(file, text);
    await writeAnchor(file, options.keyFile, state);
  }
  return { state, notes, counts, entries: batches.length, written: options.dryRun !== true && batches.length > 0 };
}

async function main(argv) {
  const args = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') options.dryRun = true;
    else if (argv[index] === '--key') options.keyFile = path.resolve(argv[index += 1] ?? '');
    else if (argv[index] === '--execution-tools') options.executionTools = String(argv[index += 1] ?? '').split(',').map((tool) => tool.trim()).filter(Boolean);
    else args.push(argv[index]);
  }
  const [command, dir] = args;
  if (command === undefined || dir === undefined) {
    console.error('usage: node tools/journal.mjs <import|verify|render|reseal> <research dir> [--dry-run] [--key <file>]');
    return 2;
  }
  const root = path.resolve(dir);
  const file = path.join(root, JOURNAL_FILE);
  const keyFile = options.keyFile ?? defaultKeyFile();

  if (command === 'import') {
    const result = await importLegacy(root, options);
    console.log(`${result.written ? 'imported' : 'would import'}: ${summary(result.state)}`);
    console.log(`journal entries: ${result.entries}; execution records the ledger attests today: ${result.counts.attested}; linked files missing: ${result.counts.missingEvidence}; unlinked records: ${result.counts.unlinkedEvidence}`);
    for (const note of result.notes) console.log(`note: ${note}`);
    if (result.written) console.log(`wrote ${file}\nThe Markdown files are now views. Run \`render\` to rewrite them from the journal.`);
    return 0;
  }

  if (command === 'verify') {
    if (!(await exists(file))) {
      console.error(`${file} does not exist`);
      return 1;
    }
    const { state, integrity } = loadJournal(await fs.readFile(file, 'utf8'), await journalKey(keyFile), await readAnchor(file, options.keyFile));
    if (!integrity.ok) {
      console.error(`FAILED at line ${integrity.problem.line}: it ${integrity.problem.reason}`);
      console.error(`${integrity.events} line(s) before it verify: ${summary(state)}`);
      return 1;
    }
    console.log(`ok: ${integrity.events} line(s) verify against ${keyFile}${integrity.partialTail ? ' (an interrupted append at the end is ignored)' : ''}`);
    console.log(summary(state));
    return 0;
  }

  if (command === 'render') {
    const store = openStore(root, { keyFile: options.keyFile });
    const state = await store.state();
    const problem = await store.writeViews(state, undefined);
    if (problem !== undefined) {
      console.error(problem);
      return 1;
    }
    console.log(`rewrote the Markdown views of ${summary(state)}`);
    return 0;
  }

  if (command === 'reseal') {
    const text = await fs.readFile(file, 'utf8');
    const key = await journalKey(keyFile);
    const before = loadJournal(text, key, await readAnchor(file, options.keyFile).catch(() => undefined));
    const entries = journalEntries(text);
    const { text: resealed, state } = sealAll(entries.map((entry) => ({ ts: entry.ts, session: entry.session, tool: entry.tool, call: entry.call, ops: entry.ops })), key);
    const backup = `${file}.before-reseal-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await fs.copyFile(file, backup);
    await writeAtomic(file, resealed);
    await writeAnchor(file, options.keyFile, state);
    console.log(before.integrity.ok
      ? 'the journal already verified; it was resealed anyway'
      : `line ${before.integrity.problem.line} did not verify (it ${before.integrity.problem.reason}); every line is now accepted as it stands`);
    console.log(`kept the previous file as ${backup}`);
    console.log(summary(state));
    return 0;
  }

  console.error(`unknown command: ${command}`);
  return 2;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
