import { getStoredToken, clearStoredToken } from "./auth";

const HOSTED_API_URL = import.meta.env.VITE_API_URL || "/api";

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
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {}),
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const encryptionSecret = getStoredEncryptionSecret();
  if (encryptionSecret) {
    headers["X-Vault-Secret"] = encryptionSecret;
  }

  const res = await fetch(`${HOSTED_API_URL}${path}`, {
    ...options,
    headers,
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

    // Only clear the stored token if it still matches the one that was
    // rejected. A concurrent register() or loginWithApiKey() may have already
    // stored a fresh token, and we must not wipe it.
    if (res.status === 401 && token && getStoredToken() === token) {
      clearStoredToken();
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
