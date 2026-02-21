import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AuthContext,
  type AuthState,
  getStoredToken,
  setStoredToken,
  clearStoredToken,
} from "../lib/auth";
import {
  api,
  ApiError,
  setStoredEncryptionSecret,
  clearStoredEncryptionSecret,
} from "../lib/api";
import { transformUser } from "../lib/types";
import type { User, ApiUserResponse, ApiRegisterResponse } from "../lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: revalidate stored token
  useEffect(() => {
    const storedToken = getStoredToken();

    if (!storedToken) {
      setIsLoading(false);
      return;
    }

    api
      .get<ApiUserResponse>("/me")
      .then((raw) => {
        setUser(transformUser(raw));
        setToken(storedToken);
      })
      .catch((err) => {
        // Token invalid — request() already cleared localStorage on 401.
        // Don't wipe state: loginWithApiKey may be racing (OAuth callback).
        if (!(err instanceof ApiError) || err.status !== 401) {
          // Non-auth error: silently ignore, user stays unauthenticated
        }
      })
      .finally(() => setIsLoading(false));
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    setStoredToken(key);
    setToken(key);
    try {
      const raw = await api.get<ApiUserResponse>("/me");
      setUser(transformUser(raw));
    } catch (err) {
      clearStoredToken();
      setToken(null);
      setUser(null);
      throw err;
    }
  }, []);

  const register = useCallback(async (email: string, name?: string) => {
    const raw = await api.post<ApiRegisterResponse>("/register", {
      email,
      name,
    });

    setStoredToken(raw.apiKey.key);
    setToken(raw.apiKey.key);
    if (raw.encryptionSecret) {
      setStoredEncryptionSecret(raw.encryptionSecret);
    }
    setUser({
      id: raw.userId,
      email: raw.email,
      tier: raw.tier,
      name: name || undefined,
      createdAt: new Date(),
    });

    return { apiKey: raw.apiKey.key };
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    clearStoredEncryptionSecret();
    queryClient.clear();
    setToken(null);
    setUser(null);
  }, [queryClient]);

  const value: AuthState = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: !!token && !!user,
      isLoading,
      loginWithApiKey,
      register,
      logout,
    }),
    [user, token, isLoading, loginWithApiKey, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
