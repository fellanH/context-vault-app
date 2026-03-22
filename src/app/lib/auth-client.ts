import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL || "https://api.context-vault.com";

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [organizationClient(), apiKeyClient()],
});
