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

check('the module exports what the Loader expects',
  plugin?.name === 'dsh-vr' && Array.isArray(plugin?.inject) && typeof plugin?.apply === 'function',
  `name=${plugin?.name} inject=${Array.isArray(plugin?.inject)}`);
check('the injected services the tools depend on are declared',
  ['tools', 'workingDirectory', 'webServer'].every((service) => plugin.inject.includes(service)),
  JSON.stringify(plugin.inject));

let applyError;
try {
  plugin.apply(ctx, config);
} catch (error) {
  applyError = error;
}
check('apply() runs without throwing', applyError === undefined, applyError?.message);

check('tools were registered', registered.length >= 20, `registered ${registered.length}`);
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

await fs.rm(stateRoot, { recursive: true, force: true });

console.log(failures === 0 ? 'all load cases passed' : `${failures} load case(s) failed`);
process.exit(failures === 0 ? 0 : 1);
