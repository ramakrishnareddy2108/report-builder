// Vite plugin: after the build, list every file in dist/ and write the list (and a version made from the
// file contents) into dist/sw.js, so the service worker can store the whole app on the first visit.
// This replaces a PWA library: it is about thirty lines and has no dependencies.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin } from 'vite';

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

export function precachePlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'report-builder-precache',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split(sep).join('/'))
        .filter((f) => f !== 'sw.js' && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8')
        .replace('/*PRECACHE_LIST*/ []', JSON.stringify(files))
        .replace("/*CACHE_VERSION*/ 'dev'", JSON.stringify(hash.digest('hex').slice(0, 12)));
      writeFileSync(swPath, sw);
    },
  };
}
