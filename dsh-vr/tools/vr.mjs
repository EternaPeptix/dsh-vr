#!/usr/bin/env node
/**
 * vr — read-only terminal view over a research directory.
 *
 * It reads the journal the way the plugin does: verified against the key, never from the Markdown
 * views, and judged by the rules in lib/rules.js. It never writes: no key is created, no lock is
 * taken and no view is refreshed.
 *
 *   node tools/vr.mjs [--root <research dir>] [--key <file>] <command> [args]
 *
 * The research directory is --root, else $VR_RESEARCH_DIR, else ./research. The key is --key, else
 * $DSH_VR_JOURNAL_KEY, else ~/.dsh-vr/journal.key.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evidenceStates } from '../lib/evidence.js';
import { STAGES, STAGE_RULES, evaluateGate, renderThread } from '../lib/rules.js';
import { readResearch } from '../lib/store.js';
import { threadDoc } from '../lib/views.js';

const EXIT = { REPORT: 0, CLOSED: 0, HOLD: 2, REFUTE: 3, ERROR: 1 };

const USAGE = `usage: vr [--root <research dir>] [--key <file>] <command> [args]

Read-only view over the research journal. Records are verified against the journal key and judged
by harness/dsh-vr/lib/rules.js, the rules the vr_* tools use. The Markdown files under research/
are generated views and are not read.

Commands:
  list                 one line per thread: id, status, stage, evidence count, question (60 chars)
  show <thr-NNN>       print that thread as recorded
  gate <thr-NNN>       report-readiness gate: REPORT, HOLD, REFUTE or CLOSED, then one
                       indented line per reason
  stages               the pipeline stages in order with their requirements
  telemetry [n]        last n telemetry events as "ts tool status duration_ms" (default 20)
  decisions            how often each gate rule has blocked, from recorded verdicts

Options:
  --root <dir>         the research directory (default $VR_RESEARCH_DIR, else ./research)
  --key <file>         the journal key (default $DSH_VR_JOURNAL_KEY, else ~/.dsh-vr/journal.key)
  -h, --help           show this help

Exit codes:
  0  success, or gate decision REPORT or CLOSED
  2  gate decision HOLD
  3  gate decision REFUTE
  1  usage error, IO error, or a journal that fails verification

The gate here applies the rules alone. Two plugin settings change what vr_gate says and are not
read by this command: minReportTier, and requireExecutionAttestation.`;

const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Clip to `width` characters, adding an ellipsis only when something was removed. */
function truncate(value, width) {
  const text = collapse(value);
  if (text.length <= width) return text;
  if (width <= 3) return text.slice(0, width);
  return `${text.slice(0, width - 3)}...`;
}

class Failure extends Error {}

/** The verified state, or a failure that says why it cannot be shown. */
async function stateOf(env) {
  const { state, integrity, refusal } = await readResearch(env.root, { keyFile: env.keyFile });
  if (refusal !== undefined) throw new Failure(refusal);
  if (integrity.absent === true) return undefined;
  return state;
}

async function listThreads(args, env) {
  if (args.length > 0) throw new Failure('list takes no arguments');
  const state = await stateOf(env);
  const ids = state === undefined ? [] : [...state.threads.keys()].sort((a, b) => a.localeCompare(b));
  if (ids.length === 0) {
    env.out('no threads');
    return 0;
  }
  const rows = ids.map((id) => {
    const doc = threadDoc(state, id);
    return {
      id,
      status: collapse(doc.frontmatter.status) || 'unknown',
      stage: collapse(doc.frontmatter.stage) || 'none',
      count: doc.links.length,
      question: collapse(doc.sections.Question),
    };
  });
  const idWidth = Math.max(...rows.map((row) => row.id.length));
  const statusWidth = Math.max(...rows.map((row) => row.status.length), 'status'.length);
  const stageWidth = Math.max(...rows.map((row) => row.stage.length), 'stage'.length);
  const countWidth = Math.max(...rows.map((row) => String(row.count).length), 1);
  env.out(rows.map((row) => [
    row.id.padEnd(idWidth),
    row.status.padEnd(statusWidth),
    row.stage.padEnd(stageWidth),
    String(row.count).padStart(countWidth),
    truncate(row.question, 60),
  ].join('  ')).join('\n'));
  return 0;
}

async function loadThread(id, env) {
  const state = await stateOf(env);
  const doc = state === undefined ? undefined : threadDoc(state, String(id));
  if (doc === undefined) throw new Failure(`no such thread: ${id}`);
  return { state, doc };
}

async function showThread(args, env) {
  if (args.length !== 1) throw new Failure('usage: vr show <thr-NNN>');
  const { doc } = await loadThread(args[0], env);
  env.out(renderThread(doc.frontmatter, doc.sections));
  return 0;
}

async function gateThread(args, env) {
  if (args.length !== 1) throw new Failure('usage: vr gate <thr-NNN>');
  const { state, doc } = await loadThread(args[0], env);
  const gate = evaluateGate(doc, await evidenceStates(state, env.root, args[0], doc.links));
  const decision = String(gate?.decision);
  const reasons = Array.isArray(gate?.reasons) ? gate.reasons : [];
  env.out([`decision: ${decision}`, ...reasons.map((reason) => `  ${reason}`)].join('\n'));
  if (!Object.hasOwn(EXIT, decision) || decision === 'ERROR') {
    throw new Failure(`gate returned an unknown decision: ${decision}`);
  }
  return EXIT[decision];
}

function stageRequirement(rule) {
  if (!rule || typeof rule !== 'object') return 'requires: (stage details not exported)';
  const parts = [];
  if (Array.isArray(rule.requires)) parts.push(...rule.requires.map(String));
  if (rule.evidence === true) parts.push('one complete evidence record');
  if (rule.gate === true) parts.push('gate decision REPORT');
  return parts.length > 0 ? `requires: ${parts.join(', ')}` : 'requires: nothing stated';
}

function stages(args, env) {
  if (args.length > 0) throw new Failure('stages takes no arguments');
  const texts = STAGES.map((stage) => stageRequirement(STAGE_RULES?.[stage]));
  const width = Math.max(...STAGES.map((stage) => stage.length));
  const textWidth = Math.max(...texts.map((text) => text.length));
  const lines = STAGES.map((stage, index) => {
    const label = typeof STAGE_RULES?.[stage]?.label === 'string' ? STAGE_RULES[stage].label : '';
    const base = `${stage.padEnd(width)}  ${texts[index].padEnd(textWidth)}`;
    return label ? `${base}  ${label}` : base.trimEnd();
  });
  env.out([
    ...lines,
    '',
    'Stages are ordered and may not be skipped: a stage is entered only when its own artifact',
    "exists, and every earlier stage's artifact exists too.",
  ].join('\n'));
  return 0;
}

/** Every parseable object line of the telemetry ledger, oldest first; undefined when there is none. */
async function telemetryEvents(env) {
  let raw;
  try {
    raw = await fs.readFile(path.join(env.root, 'telemetry', 'events.jsonl'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw new Failure(`cannot read telemetry: ${error.message}`);
  }
  const events = [];
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) events.push(value);
    } catch {
      /* an unparseable line is skipped */
    }
  }
  return events;
}

async function decisions(args, env) {
  if (args.length > 0) throw new Failure('usage: vr decisions');
  const verdicts = ((await telemetryEvents(env)) ?? []).filter((record) => record.event === 'gate');
  if (verdicts.length === 0) {
    env.out('no gate verdicts recorded yet');
    return 0;
  }
  const counts = new Map();
  const seen = new Map();
  for (const record of verdicts) {
    seen.set(record.status, (seen.get(record.status) ?? 0) + 1);
    for (const code of Array.isArray(record.codes) ? record.codes : []) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  env.out([
    `gate verdicts recorded: ${verdicts.length} (${[...seen.entries()].map(([key, n]) => `${key}=${n}`).join(' ')})`,
    '',
    'blocking rules by frequency:',
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => `  ${String(n).padStart(4)}  ${code}`),
    '',
    'A rule that never fires is dead weight; a rule that fires constantly is either doing its job',
    'or blocking work that should be dispositioned. Only measuring the outcome can tell them apart.',
  ].join('\n'));
  return 0;
}

async function telemetry(args, env) {
  if (args.length > 1) throw new Failure('usage: vr telemetry [n]');
  let limit = 20;
  if (args.length === 1) {
    if (!/^\d+$/.test(args[0]) || Number(args[0]) < 1) {
      throw new Failure(`invalid count: ${args[0]} (expected a positive integer)`);
    }
    limit = Number(args[0]);
  }
  const events = (await telemetryEvents(env)) ?? [];
  if (events.length === 0) {
    env.out('no telemetry events');
    return 0;
  }
  const field = (value) => {
    if (value === null || value === undefined || value === '') return '-';
    return collapse(typeof value === 'object' ? JSON.stringify(value) : value);
  };
  env.out(events.slice(-limit)
    .map((event) => [event.ts, event.tool, event.status, event.duration_ms].map(field).join(' '))
    .join('\n'));
  return 0;
}

const COMMANDS = { list: listThreads, show: showThread, gate: gateThread, stages, telemetry, decisions };

/**
 * Run one command and return its exit code. `defaults.root` and `defaults.keyFile` are what a
 * launcher installed next to a workspace passes; --root and --key override them.
 */
export async function main(argv, defaults = {}) {
  const write = (stream) => (text) => stream.write(String(text).endsWith('\n') ? String(text) : `${text}\n`);
  const out = defaults.out ?? write(process.stdout);
  const err = defaults.err ?? write(process.stderr);
  let root = defaults.root ?? process.env.VR_RESEARCH_DIR ?? 'research';
  let keyFile = defaults.keyFile ?? process.env.DSH_VR_JOURNAL_KEY;
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--root' || argv[index] === '--key') {
      const value = argv[index + 1];
      if (value === undefined || value === '') {
        err(`error: ${argv[index]} needs a value`);
        return EXIT.ERROR;
      }
      if (argv[index] === '--root') root = value;
      else keyFile = value;
      index += 1;
    } else {
      args.push(argv[index]);
    }
  }
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    out(USAGE);
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    err(`error: unknown command: ${command}\n\n${USAGE}`);
    return EXIT.ERROR;
  }
  const env = {
    root: path.resolve(root),
    keyFile: keyFile === undefined || keyFile === '' ? undefined : path.resolve(keyFile),
    out,
  };
  try {
    return await COMMANDS[command](rest, env);
  } catch (error) {
    err(`error: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT.ERROR;
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.on('error', (error) => {
    if (error?.code === 'EPIPE') process.exit(0);
  });
  process.exitCode = await main(process.argv.slice(2));
}
