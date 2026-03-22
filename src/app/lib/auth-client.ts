import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";

const API_URL = import.meta.env.VITE_API_URL || "";

export const authClient = createAuthClient({
  baseURL: API_URL || window.location.origin,
  plugins: [organizationClient(), apiKeyClient()],
});
