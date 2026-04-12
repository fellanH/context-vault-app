const API_URL = process.env.API_URL || "https://api.context-vault.com";

interface RequestOptions {
  headers?: Record<string, string>;
}

function authHeader(token?: string): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function apiGet(
  path: string,
  token?: string,
  opts?: RequestOptions
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "GET",
    headers: {
      ...authHeader(token),
      ...opts?.headers,
    },
  });
}

export async function apiPost(
  path: string,
  body: unknown,
  token?: string,
  opts?: RequestOptions
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token),
      ...opts?.headers,
    },
    body: JSON.stringify(body),
  });
}

export async function apiPostRaw(
  path: string,
  body: string | Buffer,
  token?: string,
  opts?: RequestOptions
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token),
      ...opts?.headers,
    },
    body,
  });
}

export async function apiPut(
  path: string,
  body: unknown,
  token?: string,
  opts?: RequestOptions
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeader(token),
      ...opts?.headers,
    },
    body: JSON.stringify(body),
  });
}

export async function apiDelete(
  path: string,
  token?: string,
  opts?: RequestOptions
): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: "DELETE",
    headers: {
      ...authHeader(token),
      ...opts?.headers,
    },
  });
}

export function hasTestKey(): boolean {
  return !!process.env.API_TEST_KEY;
}

export function getTestKey(): string {
  const key = process.env.API_TEST_KEY;
  if (!key) throw new Error("API_TEST_KEY not set");
  return key;
}
