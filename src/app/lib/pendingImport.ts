/**
 * pendingImport.ts
 *
 * Module-level store for vault files selected on the Login page before an
 * account exists. Survives SPA navigation (Login → Register) without needing
 * React context or localStorage (files can't be serialised to storage).
 */

let _pendingFiles: File[] | null = null;

export function setPendingFiles(files: File[]): void {
  _pendingFiles = files.length > 0 ? [...files] : null;
}

/** Consumes the stored files, clearing the store. */
export function consumePendingFiles(): File[] | null {
  const files = _pendingFiles;
  _pendingFiles = null;
  return files;
}

export function hasPendingFiles(): boolean {
  return (_pendingFiles?.length ?? 0) > 0;
}
