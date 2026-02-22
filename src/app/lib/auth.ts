import { createContext, useContext } from "react";
import type { User } from "./types";

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginWithApiKey: (key: string) => Promise<void>;
  register: (email: string, name?: string) => Promise<{ apiKey: string }>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
