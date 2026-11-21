// In-memory FsDir for tests. Names are case-insensitive, like Windows folders.

import type { FsDir, FsEntry, FsWriteData } from '@/storage/fs';

type Node = { kind: 'file'; name: string; data: Uint8Array } | { kind: 'directory'; dir: MemoryDir };

export class MemoryDir implements FsDir {
  private readonly children = new Map<string, Node>();
  /** Every write and rename, in order, for asserting the temp-file dance. */
  readonly log: string[];

  constructor(
    readonly name: string,
    log: string[] = [],
  ) {
    this.log = log;
  }

  private key(name: string): string {
    if (name.includes('/') || name === '' || name === '.' || name === '..') {
      throw new Error(`MemoryDir: bad name "${name}"`);
    }
    return name.toLowerCase();
  }

  async entries(): Promise<FsEntry[]> {
    return [...this.children.values()]
      .map((n): FsEntry => (n.kind === 'file' ? { name: n.name, kind: 'file' } : { name: n.dir.name, kind: 'directory' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDir(name: string, create: boolean): Promise<FsDir | null> {
    const node = this.children.get(this.key(name));
    if (node?.kind === 'directory') return node.dir;
    if (node?.kind === 'file') {
      if (create) throw new DOMException('A file has that name', 'TypeMismatchError');
      return null;
    }
    if (!create) return null;
    const dir = new MemoryDir(name, this.log);
    this.children.set(this.key(name), { kind: 'directory', dir });
    return dir;
  }

  async readFile(name: string): Promise<Blob | null> {
    const node = this.children.get(this.key(name));
    return node?.kind === 'file' ? new Blob([new Uint8Array(node.data)]) : null;
  }

  async writeFile(name: string, data: FsWriteData): Promise<void> {
    const existing = this.children.get(this.key(name));
    if (existing?.kind === 'directory') throw new DOMException('A folder has that name', 'TypeMismatchError');
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await data.arrayBuffer());
    this.children.set(this.key(name), { kind: 'file', name, data: bytes });
    this.log.push(`write ${name}`);
  }

  async renameFile(from: string, to: string): Promise<void> {
    const node = this.children.get(this.key(from));
    if (node?.kind !== 'file') throw new DOMException(`${from} not found`, 'NotFoundError');
    this.children.delete(this.key(from));
    this.children.set(this.key(to), { kind: 'file', name: to, data: node.data });
    this.log.push(`rename ${from} -> ${to}`);
  }

  async removeFile(name: string): Promise<void> {
    const node = this.children.get(this.key(name));
    if (node?.kind === 'file') this.children.delete(this.key(name));
  }

  // --- test conveniences -----------------------------------------------------

  /** Every file path under this folder, sorted. */
  allPaths(prefix = ''): string[] {
    const out: string[] = [];
    for (const node of this.children.values()) {
      if (node.kind === 'file') out.push(prefix + node.name);
      else out.push(...node.dir.allPaths(`${prefix}${node.dir.name}/`));
    }
    return out.sort();
  }

  /** Every folder path under this folder (with trailing slash), sorted. */
  allDirs(prefix = ''): string[] {
    const out: string[] = [];
    for (const node of this.children.values()) {
      if (node.kind === 'directory') {
        const p = `${prefix}${node.dir.name}/`;
        out.push(p, ...node.dir.allDirs(p));
      }
    }
    return out.sort();
  }
}
