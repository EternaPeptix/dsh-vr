/**
 * Minimal stand-in for @deepseek-ai/schemastery.
 *
 * The real package lives inside the Harness application bundle, which a plain `node` run cannot
 * resolve. This stub exists so the plugin module can be loaded and its tool registration exercised
 * outside the app: it accepts any schema-building call and returns itself, which is enough for module
 * scope evaluation. It validates nothing, so a test that needs schema semantics must not use it.
 */
const chain = () => {
  const callable = (..._args) => chain();
  return new Proxy(callable, {
    get(_target, property) {
      if (property === Symbol.toPrimitive) return () => '[schema]';
      if (property === 'toString') return () => '[schema]';
      if (property === 'then') return undefined;
      return (..._args) => chain();
    },
    apply() {
      return chain();
    },
  });
};

const z = {
  object: () => chain(),
  string: () => chain(),
  number: () => chain(),
  natural: () => chain(),
  boolean: () => chain(),
  array: () => chain(),
  union: () => chain(),
  any: () => chain(),
};

export default z;
export { z };
