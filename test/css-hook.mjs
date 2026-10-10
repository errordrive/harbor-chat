// Stub out CSS imports for node:test (Vite handles them in the real build).
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return { url: new URL('./empty-css.mjs', import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
