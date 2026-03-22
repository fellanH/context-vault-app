import { useState, useCallback, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthContext, type AuthState } from "../lib/auth";
import { authClient } from "../lib/auth-client";
import { clearStoredEncryptionSecret } from "../lib/api";
import type { User } from "../lib/types";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On mount: check for existing session via better-auth
  useEffect(() => {
    authClient
      .getSession()
      .then(({ data }) => {
        if (data?.user) {
          setUser({
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || undefined,
            tier: (data.user as any).tier || "free",
            createdAt: new Date(data.user.createdAt),
          });
        }
      })
      .finally(() => setIsLoading(false));
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
      logout,
    }),
    [user, isLoading, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
