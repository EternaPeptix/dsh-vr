/**
 * Minimal stand-in for @deepseek-ai/dsh-tools.
 *
 * `defineTool` is the only export the plugin uses. The stub keeps the tool definition as given, but
 * refuses one that is structurally unusable — which is the failure a load-time test should catch.
 */
export function defineTool(spec) {
  if (spec === null || typeof spec !== 'object') throw new Error('defineTool: spec must be an object');
  if (typeof spec.name !== 'string' || !/^[a-z][a-z0-9_]*$/.test(spec.name)) {
    throw new Error(`defineTool: invalid tool name ${JSON.stringify(spec.name)}`);
  }
  if (typeof spec.description !== 'string' || spec.description.trim() === '') {
    throw new Error(`defineTool: ${spec.name} has no description`);
  }
  if (spec.parameters === null || typeof spec.parameters !== 'object') {
    throw new Error(`defineTool: ${spec.name} has no parameters object`);
  }
  if (typeof spec.execute !== 'function') throw new Error(`defineTool: ${spec.name} has no execute`);
  return spec;
}

export default { defineTool };
