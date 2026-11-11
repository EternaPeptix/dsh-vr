/**
 * Opt-in resolver: the Harness packages come from a real installation instead of the stubs.
 *
 * The stubs accept almost anything, so a call that the real `defineTool` would reject for a missing
 * argument, or a schema the real `schemastery` would refuse to build, passes the ordinary load test.
 * This runs the same test against the packages the Host itself loads.
 *
 *   DSH_PACKAGE_ROOT=<directory whose node_modules holds @deepseek-ai/> npm run test:real
 *
 * For the desktop app that directory is `<app>/Contents/Resources/app.asar/dsh`, and the test has to
 * run under the app's own runtime, which can read inside the archive.
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const REAL = new Set(['@deepseek-ai/schemastery', '@deepseek-ai/dsh-tools']);
const root = String(process.env.DSH_PACKAGE_ROOT ?? '').trim();

export async function resolve(specifier, context, nextResolve) {
  if (!REAL.has(specifier)) return nextResolve(specifier, context);
  if (root === '') {
    throw new Error('DSH_PACKAGE_ROOT is not set: name the directory whose node_modules holds @deepseek-ai/');
  }
  // Resolved as if imported by a file in that directory, so the package's own exports map decides.
  return nextResolve(specifier, { ...context, parentURL: pathToFileURL(path.join(path.resolve(root), 'resolve-from-here.js')).href });
}
