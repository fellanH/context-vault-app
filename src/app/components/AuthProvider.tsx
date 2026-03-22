import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthContext, type AuthState } from "../lib/auth";
import { authClient } from "../lib/auth-client";
import {
  api,
  setStoredEncryptionSecret,
  clearStoredEncryptionSecret,
} from "../lib/api";
import type { User } from "../lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: check for existing session via better-auth
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      if (data?.user) {
        setUser({
          id: data.user.id,
          email: data.user.email,
          name: data.user.name || undefined,
          tier: (data.user as any).tier || "free",
          createdAt: new Date(data.user.createdAt),
        });
      }
      setIsLoading(false);
    });
  }, []);

  const loginWithApiKey = useCallback(async (key: string) => {
    // Legacy API key login for backwards compat
    const raw = await api.post<any>("/auth/session", { apiKey: key });
    setUser({
      id: raw.userId || raw.id,
      email: raw.email,
      name: raw.name,
      tier: raw.tier || "free",
      createdAt: new Date(raw.createdAt || Date.now()),
    });
  }, []);

  const register = useCallback(async (email: string, name?: string) => {
    // Legacy register for API key generation flow
    const raw = await api.post<any>("/register", { email, name });
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
    await authClient.signOut();
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
