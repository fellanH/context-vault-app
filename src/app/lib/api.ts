import { API_BASE_URL } from "./auth-client";

const HOSTED_API_URL = `${API_BASE_URL}/api`;

// One-time cleanup of old localStorage/sessionStorage keys from the port-based local server era
try {
  localStorage.removeItem("cv_local_port_persist");
  sessionStorage.removeItem("cv_local_port");
} catch {
  // ignore
}

/** Get stored encryption secret for split-authority encryption. */
function getStoredEncryptionSecret(): string | null {
  try {
    return localStorage.getItem("cv_encryption_secret");
  } catch {
    return null;
  }
}

/** Store encryption secret in localStorage. */
export function setStoredEncryptionSecret(secret: string): void {
  localStorage.setItem("cv_encryption_secret", secret);
}

/** Clear stored encryption secret. */
export function clearStoredEncryptionSecret(): void {
  localStorage.removeItem("cv_encryption_secret");
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const encryptionSecret = getStoredEncryptionSecret();
  if (encryptionSecret) {
    headers["X-Vault-Secret"] = encryptionSecret;
  }

  const res = await fetch(`${HOSTED_API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // use statusText fallback
    }

    throw new ApiError(res.status, message, code);
  }

  if (res.status === 204) return undefined as T;

  return res.json();
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },

  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  del<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};

// Keep legacy export for any existing usage
export const apiFetch = request;

export async function streamImport(ndjson: string): Promise<{ job_id: string; entries_uploaded: number; errors: string[] }> {
  const url = `${HOSTED_API_URL}/vault/import/stream`;
  const encryptionSecret = getStoredEncryptionSecret();
  const res = await fetch(url, {
    method: "POST",
    body: ndjson,
    credentials: "include",
    headers: encryptionSecret ? { "X-Vault-Secret": encryptionSecret } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || "Import failed", body.code);
  }
  return res.json();
}

/** GET /api/vault/jobs/:id — import / embedding job status */
export type VaultImportJob = {
  id: string;
  status: string;
  total_entries: number;
  entries_uploaded: number;
  entries_embedded: number;
  errors: string[];
  created_at: string;
  completed_at: string | null;
};

export async function getVaultImportJob(jobId: string): Promise<VaultImportJob> {
  return api.get<VaultImportJob>(`/vault/jobs/${jobId}`);
}

/**
 * Poll until job reaches `complete` or `failed`.
 * Sequential multi-batch imports must await between batches so embedding jobs do not overlap.
 */
export async function pollVaultImportJobUntilTerminal(
  jobId: string,
  options?: { signal?: AbortSignal; maxWaitMs?: number },
): Promise<VaultImportJob> {
  const maxWaitMs = options?.maxWaitMs ?? 4 * 60 * 60 * 1000;
  const started = Date.now();
  for (;;) {
    if (options?.signal?.aborted) {
      throw new DOMException("Import cancelled", "AbortError");
    }
    if (Date.now() - started > maxWaitMs) {
      throw new Error("Import indexing timed out. Try again or use the CLI for very large vaults.");
    }
    const job = await getVaultImportJob(jobId);
    if (job.status === "complete" || job.status === "failed") {
      return job;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
