// node:test runs outside the Next bundler: teach the loader the tsconfig `@/*`
// alias, the extensionless imports Next resolves for us, and `server-only`.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'server-only')
    return {
      url: 'data:text/javascript,',
      shortCircuit: true,
      format: 'module',
    };
  if (specifier.startsWith('@/'))
    return nextResolve(
      new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href,
      context,
    );
  const candidates = [specifier];
  candidates.push(
    specifier.startsWith('.') ? specifier + '.ts' : specifier + '.js',
  );
  let failure;
  for (const candidate of candidates) {
    try {
      return await nextResolve(candidate, context);
    } catch (error) {
      failure ??= error;
    }
  }
  throw failure;
}
