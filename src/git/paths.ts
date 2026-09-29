import { realpathSync } from 'node:fs';
import path from 'node:path';

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Ids/slugs that end up in branch names or paths must be boring. */
export function assertSafeId(id: string, what = 'id'): string {
  if (!ID_RE.test(id) || id.includes('..')) throw new Error(`Unsafe ${what}: ${JSON.stringify(id)}`);
  return id;
}

export function slugify(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'task';
}

function realOrResolved(p: string): string {
  // Resolve symlinks for the deepest existing ancestor, then re-append the rest.
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** Throws unless `target` is strictly inside `base` (symlinks resolved, `..` rejected). */
export function assertInside(base: string, target: string): string {
  const b = realOrResolved(base);
  const t = realOrResolved(target);
  const rel = path.relative(b, t);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path ${target} is outside allowed root ${base}`);
  }
  return t;
}
