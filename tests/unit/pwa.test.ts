import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('installable app files', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; purpose: string }[];
  };

  it('has a manifest that opens as a standalone app from any sub-path', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url.startsWith('/')).toBe(false); // relative, so GitHub Pages sub-paths work
    const purposes = manifest.icons.map((i) => i.purpose);
    expect(purposes).toContain('maskable');
    expect(manifest.icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === '512x512')).toBe(true);
  });

  it('keeps the two placeholders the build fills in, so the offline file list is never empty', () => {
    const sw = readFileSync('public/sw.js', 'utf8');
    expect(sw).toContain('/*PRECACHE_LIST*/ []');
    expect(sw).toContain("/*CACHE_VERSION*/ 'dev'");
  });
});
