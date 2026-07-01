import type { Entry, KnowledgeKind, EntityKind, EventKind } from "./types";

const VAULT_HANDLE_KEY = "localVaultHandle";

export interface LocalVaultEntry extends Entry {
  _fileHandle?: FileSystemFileHandle;
}

/**
 * Parse YAML frontmatter from a markdown file.
 * Simple inline parser for the subset of YAML used in vault entries.
 */
export function parseFrontmatter(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  if (!lines[0]?.startsWith("---")) return {};

  const result: Record<string, unknown> = {};
  let i = 1;

  while (i < lines.length && !lines[i]?.startsWith("---")) {
    const line = lines[i]!;
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      let value = line.substring(colonIdx + 1).trim();

      // Handle simple values, arrays, and quoted strings
      if (value.startsWith("[") && value.endsWith("]")) {
        // Parse array: ['a', 'b', 'c']
        const arrayContent = value.slice(1, -1);
        result[key] = arrayContent
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""));
      } else if (value.startsWith('"') && value.endsWith('"')) {
        result[key] = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        result[key] = value.slice(1, -1);
      } else {
        // Try to parse as JSON first (for null, numbers, booleans)
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
    }
    i++;
  }

  return result;
}

/**
 * Extract the first markdown heading from content.
 */
export function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.+?)$/m);
  return match ? match[1]!.trim() : "";
}

/**
 * Remove frontmatter from content, return just the body.
 */
export function extractBody(content: string): string {
  const lines = content.split("\n");
  if (!lines[0]?.startsWith("---")) return content;

  let i = 1;
  while (i < lines.length && !lines[i]?.startsWith("---")) i++;
  return lines.slice(i + 1).join("\n").trim();
}

const KNOWN_KINDS = new Set<string>([
  "insight", "decision", "pattern", "reference",
  "project", "contact", "tool",
  "session", "log",
]);

export function normalizeKind(name: string): KnowledgeKind | EntityKind | EventKind {
  return (KNOWN_KINDS.has(name) ? name : "reference") as KnowledgeKind | EntityKind | EventKind;
}

export interface LocalVaultScanOptions {
  onProgress?: (processed: number, total: number) => void;
  onBatch?: (entries: LocalVaultEntry[]) => void;
  concurrency?: number;
}

interface IndexEntry {
  id: string;
  kind: string;
  category: "knowledge" | "entity" | "event";
  title: string;
  tags: string[];
  source?: string;
  created_at?: string;
  bucket?: string;
  identity_key?: string;
  expires_at?: string;
  _path: string;
  _fileHandle: FileSystemFileHandle;
}

interface FileRef {
  fileHandle: FileSystemFileHandle;
  catName: string;
  kindName: string;
}

/**
 * Scan vault directory and return lightweight index entries.
 * Phase 1: fast directory traversal (no file reads).
 * Phase 2: parallel batched reads of first 1KB only (frontmatter + title).
 */
export async function scanVaultEntries(
  dirHandle: FileSystemDirectoryHandle,
  opts?: LocalVaultScanOptions,
): Promise<LocalVaultEntry[]> {
  const concurrency = opts?.concurrency ?? 50;
  const categoryDirs = ["knowledge", "entities", "events"];

  // Phase 1: collect all file handles (no file reads yet)
  const refs: FileRef[] = [];
  for (const catDir of categoryDirs) {
    try {
      const catHandle = await dirHandle.getDirectoryHandle(catDir, { create: false });
      for await (const kindEntry of catHandle.values()) {
        if (kindEntry.kind !== "directory") continue;
        const kindHandle = kindEntry as FileSystemDirectoryHandle;
        for await (const fileEntry of kindHandle.values()) {
          if (fileEntry.kind === "file" && fileEntry.name.endsWith(".md")) {
            refs.push({
              fileHandle: fileEntry as FileSystemFileHandle,
              catName: catDir,
              kindName: kindHandle.name,
            });
          }
        }
      }
    } catch {
      // Category dir doesn't exist, skip
    }
  }

  opts?.onProgress?.(0, refs.length);

  // Phase 2: process in parallel batches, reading only first 1KB per file
  const all: LocalVaultEntry[] = [];
  let processed = 0;

  for (let i = 0; i < refs.length; i += concurrency) {
    const batch = refs.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((ref) => parseFileRef(ref)));
    const valid = results.filter((e): e is LocalVaultEntry => e !== null);
    all.push(...valid);
    processed += batch.length;
    opts?.onProgress?.(processed, refs.length);
    opts?.onBatch?.(valid);
  }

  return all;
}

async function parseFileRef(ref: FileRef): Promise<LocalVaultEntry | null> {
  try {
    const file = await ref.fileHandle.getFile();
    // Read only first 1KB — enough for frontmatter + title line
    const slice = file.slice(0, 1024);
    const content = await slice.text();
    const frontmatter = parseFrontmatter(content);
    const body = extractBody(content);

    const category =
      ref.catName === "entities"
        ? ("entity" as const)
        : ref.catName === "events"
          ? ("event" as const)
          : ("knowledge" as const);

    const created = frontmatter.created
      ? new Date(frontmatter.created as string)
      : new Date();
    const updated = frontmatter.updated
      ? new Date(frontmatter.updated as string)
      : new Date();

    if (isNaN(created.getTime())) created.setTime(Date.now());
    if (isNaN(updated.getTime())) updated.setTime(Date.now());

    return {
      id: String(frontmatter.id || ref.fileHandle.name.replace(".md", "")),
      kind: normalizeKind(ref.kindName),
      category,
      title: extractTitle(body),
      body: "",
      tags: Array.isArray(frontmatter.tags)
        ? frontmatter.tags
        : typeof frontmatter.tags === "string"
          ? [frontmatter.tags]
          : [],
      source: typeof frontmatter.source === "string" ? frontmatter.source : undefined,
      created,
      updated,
      visibility: "private",
      metadata: {
        bucket: typeof frontmatter.bucket === "string" ? frontmatter.bucket : undefined,
        identity_key: typeof frontmatter.identity_key === "string" ? frontmatter.identity_key : undefined,
        expires_at: typeof frontmatter.expires_at === "string" ? frontmatter.expires_at : undefined,
      },
      _fileHandle: ref.fileHandle,
    };
  } catch {
    return null;
  }
}

/**
 * Load full body for a local entry.
 */
export async function loadEntryBody(entry: LocalVaultEntry): Promise<string> {
  if (!entry._fileHandle) throw new Error("No file handle for entry");

  const file = await entry._fileHandle.getFile();
  const content = await file.text();
  return extractBody(content);
}

/**
 * Open a vault directory using the File System Access API.
 */
export async function openVaultDirectory(): Promise<FileSystemDirectoryHandle> {
  const dirHandle = await window.showDirectoryPicker();

  // Try to store the handle in IndexedDB for later restoration
  try {
    const db = await openIDB();
    const tx = db.transaction("handles", "readwrite");
    const store = tx.objectStore("handles");
    await new Promise<void>((resolve, reject) => {
      const req = store.put(dirHandle, VAULT_HANDLE_KEY);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
  } catch (e) {
    console.warn("Failed to store directory handle in IndexedDB:", e);
  }

  return dirHandle;
}

/**
 * Try to restore the vault directory handle from IndexedDB.
 * May require re-granting permission if the handle is stale.
 */
export async function restoreVaultDirectory(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIDB();
    const tx = db.transaction("handles", "readonly");
    const store = tx.objectStore("handles");

    return new Promise((resolve) => {
      const req = store.get(VAULT_HANDLE_KEY);
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const handle = req.result;
        if (handle) {
          // Try to verify the handle is still valid
          handle
            .requestPermission({ mode: "read" })
            .then(() => resolve(handle))
            .catch(() => resolve(null));
        } else {
          resolve(null);
        }
      };
    });
  } catch (e) {
    console.warn("Failed to restore directory handle:", e);
    return null;
  }
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("context-vault", 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
    };
  });
}

/**
 * Simple client-side search across entries.
 */
export function searchEntries(
  entries: LocalVaultEntry[],
  query: string,
): LocalVaultEntry[] {
  if (!query.trim()) return entries;

  const lowerQuery = query.toLowerCase();
  return entries.filter((e) => {
    return (
      e.title.toLowerCase().includes(lowerQuery) ||
      e.tags.some((t) => t.toLowerCase().includes(lowerQuery)) ||
      e.kind.toLowerCase().includes(lowerQuery) ||
      e.category.toLowerCase().includes(lowerQuery)
    );
  });
}
