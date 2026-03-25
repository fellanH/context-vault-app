import type { OnboardingStep } from "./types";

const DISMISSED_KEY = "context-vault-onboarding-dismissed";
const EXTENSION_INSTALLED_KEY = "context-vault-extension-installed";

interface OnboardingInputs {
  entriesUsed: number;
  hasMcpActivity: boolean;
}

export function getOnboardingSteps({
  entriesUsed,
  hasMcpActivity,
}: OnboardingInputs): OnboardingStep[] {
  return [
    {
      id: "create-api-key",
      label: "Create an API key",
      completed: hasMcpActivity || entriesUsed > 0,
      description: "Generate a key to authenticate CLI and MCP connections",
      action: "/settings/api-keys",
      actionLabel: "Open API Keys",
    },
    {
      id: "install-cli",
      label: "Install context-vault CLI",
      completed: hasMcpActivity,
      description: "Install globally with npm",
      action: "copy-install-command",
      actionLabel: "Copy command",
    },
    {
      id: "run-setup",
      label: "Run setup",
      completed: hasMcpActivity,
      description:
        "Detects your AI tools and installs MCP config automatically",
      action: "copy-setup-command",
      actionLabel: "Copy command",
    },
    {
      id: "connect-hosted",
      label: "Connect to hosted vault",
      completed: hasMcpActivity,
      description: "Link your CLI to this hosted vault with your API key",
      action: "copy-remote-setup-command",
      actionLabel: "Copy command",
    },
    {
      id: "install-extension",
      label: "Install Chrome extension",
      completed: isExtensionInstalled(),
      description: "Search your vault from ChatGPT, Claude, and Gemini",
      action: "chrome-web-store-link",
      actionLabel: "Install",
    },
  ];
}

export function isOnboardingDismissed(): boolean {
  return localStorage.getItem(DISMISSED_KEY) === "true";
}

export function dismissOnboarding() {
  localStorage.setItem(DISMISSED_KEY, "true");
}

export function resetOnboarding() {
  localStorage.removeItem(DISMISSED_KEY);
}

export function markExtensionInstalled(): void {
  localStorage.setItem(EXTENSION_INSTALLED_KEY, "true");
}

export function isExtensionInstalled(): boolean {
  return localStorage.getItem(EXTENSION_INSTALLED_KEY) === "true";
}

const ONBOARDING_MODE_KEY = "cv-onboarding-mode";
export type OnboardingMode = "new" | "migration";

export function getOnboardingMode(): OnboardingMode | null {
  const v = localStorage.getItem(ONBOARDING_MODE_KEY);
  return v === "new" || v === "migration" ? v : null;
}

export function setOnboardingMode(mode: OnboardingMode) {
  localStorage.setItem(ONBOARDING_MODE_KEY, mode);
}

export function getMigrationSteps({
  entriesUsed,
  hasMcpActivity,
}: OnboardingInputs): OnboardingStep[] {
  return [
    {
      id: "create-api-key",
      label: "Create an API key",
      completed: hasMcpActivity || entriesUsed > 0,
      description: "Generate a key to connect your local vault to hosted",
      action: "/settings/api-keys",
      actionLabel: "Open API Keys",
    },
    {
      id: "connect-hosted",
      label: "Connect to hosted vault",
      completed: hasMcpActivity,
      description:
        "Run context-vault remote setup and enter your API URL + key",
      action: "copy-remote-setup-command",
      actionLabel: "Copy command",
    },
    {
      id: "sync-vault",
      label: "Sync your local vault",
      completed: entriesUsed > 0,
      description:
        "Stream your local vault entries to hosted with one command",
      action: "copy-sync-command",
      actionLabel: "Copy command",
    },
  ];
}
