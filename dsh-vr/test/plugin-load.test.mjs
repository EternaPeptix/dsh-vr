/**
 * Load test for the plugin module.
 *
 * Every other test in this directory imports lib/rules.js, which is pure. This one imports the real
 * plugin entry point — the file that actually runs inside the Host — so it fails when the module does
 * not evaluate, when a tool definition is malformed, when a tool name is registered twice, or when
 * the code reads a config key that the schema does not define.
 *
 * The two Harness packages are redirected to the stubs in test/stubs by --import ./test/stub-register.mjs.
 * Config validation is therefore not exercised: this test is about the module loading and registering,
 * not about the schema's runtime semantics.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as plugin from '../lib/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}${detail === undefined ? '' : `  → ${detail}`}`);
  }
};

// Registration itself writes telemetry, so the state root must not be the repository.
const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vr-load-'));

/** Every Config default, spelled out: the schema cannot be introspected through the stub. */
const config = {
  enabled: true,
  root: stateRoot,
  telemetry: true,
  telemetryMaxBytes: 8 * 1024 * 1024,
  maxFileBytes: 4 * 1024 * 1024,
  maxEntries: 5000,
  maxAttempts: 6,
  maxActiveThreads: 5,
  enrich: true,
  enrichMaxLines: 8,
  enrichRoot: '',
  deniedHosts: '',
  enforceAllowedHosts: false,
  referenceHosts: '',
  allowLoopback: true,
  dashboardAllowHosts: '',
  dashboardCacheMs: 1500,
  questionTimeoutSeconds: 300,
  redirectQuestionTool: true,
  goalDiscipline: true,
  goalBlockPolicy: 'never',
  fanoutCeiling: 24,
  completionClaimMinutes: 60,
  deferralsMaxEntries: 200,
  minReportTier: '',
  requireExecutionAttestation: false,
  guardedTools: 'bash,pwsh,web_fetch',
  executionTools: 'bash,pwsh,shell,exec',
};

const registered = [];
const guards = [];
const services = new Map();
const listeners = [];
const ctx = {
  tools: {
    register(spec) {
      registered.push(spec);
      return () => {};
    },
    guard(fn) {
      guards.push(fn);
      return () => {};
    },
    get: () => undefined,
  },
  get(key) {
    return services.get(key);
  },
  on(event) {
    listeners.push(event);
    return () => {};
  },
  effect(fn) {
    const disposable = fn();
    return () => {
      if (typeof disposable === 'function') disposable();
    };
  },
};

/** Every tool call in this file shares one synthetic agent so session-bound tools behave normally. */
const repairExec = { agent: { session: { id: 'load-test' } } };

check('the module exports what the Loader expects',
  plugin?.name === 'dsh-vr' && Array.isArray(plugin?.inject) && typeof plugin?.apply === 'function',
  `name=${plugin?.name} inject=${Array.isArray(plugin?.inject)}`);
check('the injected services the tools depend on are declared',
  ['tools', 'workingDirectory'].every((service) => plugin.inject.includes(service)),
  JSON.stringify(plugin.inject));
check('webServer is optional, so a headless host still loads the guard and the gate',
  !plugin.inject.includes('webServer'), JSON.stringify(plugin.inject));

let applyError;
try {
  plugin.apply(ctx, config);
} catch (error) {
  applyError = error;
}
check('apply() runs without throwing', applyError === undefined, applyError?.message);

check('tools were registered', registered.length >= 21, `registered ${registered.length}`);
check('the repair tool is available', registered.some((spec) => spec.name === 'vr_repair'));
const names = registered.map((spec) => spec.name);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
check('no tool is registered twice', duplicates.length === 0, [...new Set(duplicates)].join(', '));
check('the tool guard that redirects a blocking question is installed', guards.length >= 1, `guards=${guards.length}`);
check('registered tools carry a non-trivial timeout',
  registered.every((spec) => typeof spec.timeoutMs === 'number' && spec.timeoutMs >= 15000),
  registered.filter((spec) => spec.timeoutMs < 15000).map((spec) => spec.name).join(', '));

// Config keys the code reads must exist in the schema defaults above. A typo here would surface in
// the Host as an undefined limit rather than as an error.
const source = await fs.readFile(path.join(here, '..', 'lib', 'index.js'), 'utf8');
const usedKeys = [...new Set([...source.matchAll(/\bconfig\.([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]))];
const unknownKeys = usedKeys.filter((key) => !(key in config));
check('every config key the code reads is defined in the test defaults',
  unknownKeys.length === 0, unknownKeys.join(', '));

// A service that is absent must produce the tool's own refusal, not an unhandled crash.
const contextTool = registered.find((spec) => spec.name === 'vr_context');
let thrown;
try {
  await contextTool.execute({}, {});
} catch (error) {
  thrown = error;
}
check('a missing service is reported as the tool refusing, not as a crash',
  thrown instanceof Error && thrown.message.startsWith('vr_context:'), thrown?.message);


// vr_repair must close the gap vr_evidence_add can leave: a file written but never linked.
const threadDir = path.join(stateRoot, 'threads', 'thr-001');
await fs.mkdir(path.join(threadDir, 'evidence'), { recursive: true });
await fs.writeFile(path.join(threadDir, 'index.md'), [
  '---',
  'id: thr-001',
  'engagement: test-202601',
  'status: active',
  'stage: validated',
  'target: example@abc',
  'created: 2026-01-01T00:00:00.000Z',
  'updated: 2026-01-01T00:00:00.000Z',
  '---',
  '',
  '# a thread',
  '',
  '## Evidence',
  '',
  'none',
  '',
  '## Question',
  '',
  'does the primitive reach the sink?',
  '',
].join('\n'));
await fs.writeFile(path.join(threadDir, 'evidence', 'E-001.md'), [
  '---',
  'id: E-001',
  'thread: thr-001',
  'kind: execution',
  'tier: function',
  'session: sess-a',
  'created: 2026-01-01T00:00:00.000Z',
  '---',
  '',
  '# the check',
  '',
].join('\n'));

const repairTool = registered.find((spec) => spec.name === 'vr_repair');
const dryRun = await repairTool.execute({}, repairExec);
const untouched = await fs.readFile(path.join(threadDir, 'index.md'), 'utf8');
check('vr_repair reports an unlinked evidence file without writing', dryRun.includes('would be linked') && !untouched.includes('E-001.md'), dryRun);

const applied = await repairTool.execute({ apply: true }, repairExec);
const linked = await fs.readFile(path.join(threadDir, 'index.md'), 'utf8');
check('vr_repair links it when asked', linked.includes('E-001.md'), applied);
check('the second pass has nothing left to do',
  (await repairTool.execute({}, repairExec)).includes('no inconsistencies'), 'still reports work');

// vr_defer must refuse a thread id that does not exist, and must not grow without bound.
const deferTool = registered.find((spec) => spec.name === 'vr_defer');
let deferError;
try {
  await deferTool.execute({ reason: 'waiting on a decision', thread_id: 'thr-999' }, repairExec);
} catch (error) {
  deferError = error;
}
check('vr_defer refuses a thread id that names no thread',
  deferError instanceof Error && deferError.message.includes('no such thread'), deferError?.message);
config.deferralsMaxEntries = 3;
for (let index = 0; index < 5; index += 1) {
  // eslint-disable-next-line no-await-in-loop
  await deferTool.execute({ reason: `blocker ${index}`, thread_id: 'thr-001' }, repairExec);
}
const deferrals = await fs.readFile(path.join(stateRoot, 'DEFERRALS.md'), 'utf8');
check('DEFERRALS.md keeps only the configured number of entries',
  (deferrals.match(/^## /gm) ?? []).length === 3, String((deferrals.match(/^## /gm) ?? []).length));
check('dropping old entries is stated rather than silent', deferrals.includes('dropped at the 3-entry cap'));
check('the newest entry survives the cap', deferrals.includes('blocker 4'));
config.deferralsMaxEntries = 200;

await fs.rm(stateRoot, { recursive: true, force: true });

console.log(failures === 0 ? 'all load cases passed' : `${failures} load case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
