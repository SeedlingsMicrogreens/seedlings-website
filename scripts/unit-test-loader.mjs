/**
 * Node test loader for the TypeScript unit tests (npm run test:unit):
 * resolves the `@/` path alias, extensionless relative imports, and
 * extensionless package subpaths (e.g. `next/server`) the way the Next.js
 * bundler does. Used only by tests.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('data:text/javascript,' + encodeURIComponent(`
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
const root = ${JSON.stringify(pathToFileURL(process.cwd() + '/').href)};
export async function resolve(specifier, context, next) {
  let target = specifier;
  if (target.startsWith('@/')) target = new URL(target.slice(2), root).href;
  if ((target.startsWith('.') || target.startsWith('file:')) && !/\\.[cm]?[jt]sx?$/.test(target)) {
    const base = new URL(target, target.startsWith('file:') ? undefined : context.parentURL);
    for (const extension of ['.ts', '.tsx', '/index.ts']) {
      if (fs.existsSync(new URL(base.href + extension))) return next(base.href + extension, context);
    }
  }
  try {
    return await next(target, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && /^[a-z@][^:]*\\/[^.]+$/.test(target)) return next(target + '.js', context);
    throw error;
  }
}`), pathToFileURL('./'));
