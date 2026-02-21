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
