import { getStoredToken, clearStoredToken } from "./auth";

const HOSTED_API_URL = import.meta.env.VITE_API_URL || "/api";
const LOCAL_PORT_KEY = "cv_local_port";
const LOCAL_PORT_PERSIST_KEY = "cv_local_port_persist"; // localStorage — survives tab close
const DISCOVERY_PORTS = [3141, 3000];

// ─── Local connection detection ──────────────────────────────────────────────

/** Persist port to both sessionStorage (tab) and localStorage (cross-session). */
function setLocalPort(port: number): void {
  sessionStorage.setItem(LOCAL_PORT_KEY, String(port));
  localStorage.setItem(LOCAL_PORT_PERSIST_KEY, String(port));
}

/** On page load: detect ?local=PORT, store in sessionStorage, strip from URL. */
export function detectLocalPort(): void {
  const params = new URLSearchParams(window.location.search);
  const portStr = params.get("local");
  if (!portStr) return;

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) return;

  setLocalPort(port);

  // Strip ?local= from URL without reload
  params.delete("local");
  const search = params.toString();
  const newUrl =
    window.location.pathname +
    (search ? `?${search}` : "") +
    window.location.hash;
  window.history.replaceState(null, "", newUrl);
}

/** Whether this tab is connected to a local vault server. */
export function isLocalConnection(): boolean {
  return sessionStorage.getItem(LOCAL_PORT_KEY) !== null;
}

/** Get the local server port, or null. */
export function getLocalPort(): number | null {
  const v = sessionStorage.getItem(LOCAL_PORT_KEY);
  return v ? parseInt(v, 10) : null;
}

/** Drop local connection state (used when upgrading to hosted). */
export function clearLocalConnection(): void {
  sessionStorage.removeItem(LOCAL_PORT_KEY);
  localStorage.removeItem(LOCAL_PORT_PERSIST_KEY);
}

/**
 * Probe a local port to see if a context-vault server is running.
 * Uses targetAddressSpace: "loopback" for Chrome 142+ Local Network Access compliance.
 * Note: @context-vault/core must respond with Access-Control-Allow-Private-Network: true
 * on OPTIONS preflights for full LNA compliance (separate package — not changed here).
 */
async function probeLocalPort(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 500);
    const res = await fetch(`http://localhost:${port}/api/me`, {
      signal: ctrl.signal,
      targetAddressSpace: "loopback", // Chrome 142+ LNA compliance for loopback fetches
    } as RequestInit & { targetAddressSpace: string });
    clearTimeout(t);
    if (!res.ok) return false;
    const data = await res.json();
    return data.userId === "local";
  } catch {
    return false;
  }
}

/**
 * Auto-discover a running local vault server.
 * 1. Returns existing tab port if already connected.
 * 2. Tries persisted port from localStorage (instant reconnect).
 * 3. Probes well-known ports in parallel.
 * Returns the port number if found, null otherwise.
 */
export async function autoDiscoverLocalPort(): Promise<number | null> {
  // 1. Already set this tab
  if (isLocalConnection()) return getLocalPort();

  // 2. Try persisted port from last session (instant reconnect for returning users)
  const persisted = localStorage.getItem(LOCAL_PORT_PERSIST_KEY);
  if (persisted) {
    const port = parseInt(persisted, 10);
    if (await probeLocalPort(port)) {
      setLocalPort(port);
      return port;
    }
  }

  // 3. Try well-known ports in parallel
  const port = await Promise.any(
    DISCOVERY_PORTS.filter((p) => String(p) !== persisted).map(async (p) => {
      if (await probeLocalPort(p)) return p;
      throw new Error("not found");
    }),
  ).catch(() => null);

  if (port !== null) setLocalPort(port);
  return port;
}

/** Resolve the API base URL: local server if connected, else hosted. */
function getApiBase(): string {
  const port = getLocalPort();
  if (port) return `http://localhost:${port}/api`;
  return HOSTED_API_URL;
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
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Include encryption secret for split-authority decryption
  const encryptionSecret = getStoredEncryptionSecret();
  if (encryptionSecret) {
    headers["X-Vault-Secret"] = encryptionSecret;
  }

  // Chrome 142+ LNA: signal loopback intent so the browser grants local network access
  if (isLocalConnection()) {
    (
      options as RequestInit & { targetAddressSpace: string }
    ).targetAddressSpace = "loopback";
  }

  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    // Try to parse error body
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // use statusText fallback
    }

    // On 401, clear stored token — but only if we actually sent one.
    // An unauthenticated request racing against loginWithApiKey must not
    // wipe a token that was just stored by the successful login.
    if (res.status === 401 && token) {
      clearStoredToken();
    }

    throw new ApiError(res.status, message, code);
  }

  // Handle 204 No Content
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

/**
 * Upload local vault entries to a hosted vault.
 * Reads entries from the local server, posts them to the hosted import endpoint.
 */
export async function uploadLocalVault(
  hostedToken: string,
): Promise<{ imported: number; failed: number }> {
  // Fetch all entries from local server
  const localEntries = await request<{
    entries: Array<Record<string, unknown>>;
    total: number;
  }>("/vault/entries?limit=100");

  if (!localEntries.entries.length) {
    return { imported: 0, failed: 0 };
  }

  // Post to hosted bulk import
  const hostedUrl =
    import.meta.env.VITE_HOSTED_URL || "https://api.context-vault.com";
  const res = await fetch(`${hostedUrl}/api/vault/import/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${hostedToken}`,
    },
    body: JSON.stringify({ entries: localEntries.entries }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new ApiError(res.status, body.error || "Upload failed");
  }

  return res.json();
}

// Keep legacy export for any existing usage
export const apiFetch = request;
