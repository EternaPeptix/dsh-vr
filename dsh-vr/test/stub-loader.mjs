/**
 * Resolver hook used only by the load test.
 *
 * The plugin imports two packages that ship inside the Harness application bundle. Redirecting those
 * two specifiers to local stubs lets the real lib/index.js be evaluated by a plain `node` run.
 */
export async function resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/schemastery') {
    return { url: new URL('./stubs/schemastery.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (specifier === '@deepseek-ai/dsh-tools') {
    return { url: new URL('./stubs/dsh-tools.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
