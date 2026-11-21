// The small file-system interface the workspace code is written against.
//
// The real implementation wraps a File System Access `FileSystemDirectoryHandle`.
// Tests use an in-memory implementation (tests/helpers/memoryFs.ts).
// Names passed to these methods are single path segments, never paths.

export type FsEntry = { name: string; kind: 'file' | 'directory' };

export type FsWriteData = Blob | string;

export interface FsDir {
  readonly name: string;
  /** Entries directly inside this folder, sorted by name. */
  entries(): Promise<FsEntry[]>;
  /** A sub-folder, or null if it does not exist and `create` is false. */
  getDir(name: string, create: boolean): Promise<FsDir | null>;
  /** File contents, or null if there is no such file. */
  readFile(name: string): Promise<Blob | null>;
  /** Create or overwrite a file. */
  writeFile(name: string, data: FsWriteData): Promise<void>;
  /** Rename a file in this folder, replacing `to` if it exists. */
  renameFile(from: string, to: string): Promise<void>;
  /** Remove a file. Does nothing if it is not there. */
  removeFile(name: string): Promise<void>;
}

function isDomError(err: unknown, ...names: string[]): boolean {
  return err instanceof DOMException && names.includes(err.name);
}

/** Wraps a File System Access directory handle. */
export function fsDirFromHandle(handle: FileSystemDirectoryHandle): FsDir {
  async function fileHandle(name: string): Promise<FileSystemFileHandle | null> {
    try {
      return await handle.getFileHandle(name);
    } catch (err) {
      if (isDomError(err, 'NotFoundError', 'TypeMismatchError')) return null;
      throw err;
    }
  }

  async function write(name: string, data: FsWriteData): Promise<void> {
    const fh = await handle.getFileHandle(name, { create: true });
    // Chrome writes to a swap file and only replaces the target on close(),
    // so a failed write never leaves a half-written file behind.
    const w = await fh.createWritable();
    try {
      await w.write(data);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => undefined);
      throw err;
    }
  }

  return {
    name: handle.name,

    async entries() {
      const out: FsEntry[] = [];
      for await (const entry of handle.values()) {
        out.push({ name: entry.name, kind: entry.kind });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },

    async getDir(name, create) {
      try {
        return fsDirFromHandle(await handle.getDirectoryHandle(name, { create }));
      } catch (err) {
        if (!create && isDomError(err, 'NotFoundError', 'TypeMismatchError')) return null;
        throw err;
      }
    },

    async readFile(name) {
      const fh = await fileHandle(name);
      return fh ? fh.getFile() : null;
    },

    writeFile: write,

    async renameFile(from, to) {
      const fh = await fileHandle(from);
      if (!fh) throw new Error(`Cannot rename "${from}": file not found`);
      // FileSystemFileHandle.move() is not in every Chrome/Edge version and
      // may refuse to overwrite. Fall back to copy-then-delete.
      const move = (fh as { move?: (name: string) => Promise<void> }).move;
      if (typeof move === 'function') {
        try {
          await move.call(fh, to);
          return;
        } catch {
          // fall through
        }
      }
      await write(to, await fh.getFile());
      await handle.removeEntry(from);
    },

    async removeFile(name) {
      try {
        await handle.removeEntry(name);
      } catch (err) {
        if (isDomError(err, 'NotFoundError')) return;
        throw err;
      }
    },
  };
}
