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
      id: "connect-tools",
      label: "Connect AI tools",
      completed: hasMcpActivity,
      description:
        "Run one command to configure Claude Code, Cursor, and other tools",
      action: "copy-connect-command",
      actionLabel: "Copy command",
    },
    {
      id: "first-entry",
      label: "Save your first entry",
      completed: entriesUsed > 0,
      action: "/vault/knowledge",
      actionLabel: "Add entry",
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
      id: "import-local-vault",
      label: "Import your local vault",
      completed: entriesUsed > 0,
      description:
        "Upload your markdown files to bring entries into the hosted vault",
      action: "/import",
      actionLabel: "Open import",
    },
    {
      id: "switch-to-hosted-mcp",
      label: "Switch to hosted MCP",
      completed: hasMcpActivity,
      description:
        "Update your tools to use the hosted MCP — works from any machine",
      action: "copy-connect-command",
      actionLabel: "Copy command",
    },
  ];
}
