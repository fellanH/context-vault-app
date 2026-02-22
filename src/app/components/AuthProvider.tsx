import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthContext, type AuthState } from "../lib/auth";
import {
  api,
  setStoredEncryptionSecret,
  clearStoredEncryptionSecret,
} from "../lib/api";
import { transformUser } from "../lib/types";
import type { User, ApiUserResponse, ApiRegisterResponse } from "../lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: call /me unconditionally — session cookie is sent automatically
  useEffect(() => {
    api
      .get<ApiUserResponse>("/me")
      .then((raw) => {
        setUser(transformUser(raw));
      })
      .catch(() => {
        // Not authenticated — stay unauthenticated
      })
      .finally(() => setIsLoading(false));
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    const raw = await api.post<ApiUserResponse>("/auth/session", {
      apiKey: key,
    });
    setUser(transformUser(raw));
  }, []);

  const register = useCallback(async (email: string, name?: string) => {
    const raw = await api.post<ApiRegisterResponse>("/register", {
      email,
      name,
    });

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

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    clearStoredEncryptionSecret();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const value: AuthState = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      loginWithApiKey,
      register,
      logout,
    }),
    [user, isLoading, loginWithApiKey, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
