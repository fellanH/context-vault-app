import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { ExternalLink, CheckCircle2, Circle, Copy, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const RULES_VERSION = "1.0";

const RULES_CONTENT = `# Context Vault — Agent Rules

You have access to a persistent knowledge vault via MCP tools (\`get_context\`, \`save_context\`, \`list_context\`, \`delete_context\`). Use it to build lasting memory across sessions.

## When to Retrieve

Check the vault when you're about to invest effort that past knowledge could shortcut. Apply this test: "Might I or a previous session have encountered this before?" If yes, search first.

Retrieval triggers:
- **Starting a session**: call \`session_start()\` or \`get_context(query: "<project or task context>")\` to load relevant prior knowledge
- **Hitting an error**: search for the error message or root cause before debugging from scratch
- **Making a decision**: check if this architectural or design choice was already made and why
- **Integrating with an API, library, or service**: search for known quirks, gotchas, or working patterns
- **Entering an unfamiliar area of the codebase**: check for prior insights about that module or domain
- **Before saving**: search to avoid duplicates and to update existing entries instead

A vault search takes milliseconds. Debugging from scratch takes minutes. Always check first.

## When to Save

Save when you encounter something a future session would benefit from knowing. Apply this test: "Would I tell a colleague about this to save them time?" If yes, save it.

Save triggers:
- Solved a non-obvious bug (root cause was not apparent from the error)
- Discovered undocumented API/library/tool behavior
- Found a working integration pattern requiring non-obvious configuration
- Hit a framework limitation and found a workaround
- Made an architectural decision with tradeoffs worth preserving

## When NOT to Save

- Facts derivable from reading the current code or git history
- The fix itself (that belongs in the commit, not the vault)
- Generic programming knowledge you already know
- Session-specific state (files edited, commands run)

## How to Save

Every entry must have:
- \`title\`: clear, specific (not "auth fix" but "Express 5 raw body parser breaks Stripe webhook verification")
- \`tags\`: at minimum a \`bucket:<project>\` tag for scoping
- \`kind\`: insight, pattern, reference, decision, or event
- \`tier\`: \`working\` for active context, \`durable\` for long-term reference

Capture what was learned (the insight), why it matters (what problem it prevents), and when it applies (what context makes it relevant).

## Session Review

At the end of significant work sessions, review what you learned. If the session produced novel knowledge (not every session does), save 1-3 consolidated entries. Prefer one solid entry over multiple fragments.`;

interface ToolStatus {
  name: string;
  installPath: string;
  installed: boolean;
}

const TOOL_STATUSES: ToolStatus[] = [
  {
    name: "Claude Code",
    installPath: "~/.claude/rules/context-vault.md",
    installed: true,
  },
  {
    name: "Cursor",
    installPath: ".cursorrules (appended)",
    installed: false,
  },
  {
    name: "Windsurf",
    installPath: ".windsurfrules (appended)",
    installed: false,
  },
];

export function AgentRules() {
  const [copied, setCopied] = useState(false);

  const copyRules = async () => {
    await navigator.clipboard.writeText(RULES_CONTENT);
    setCopied(true);
    toast.success("Rules copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Rules</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Rules installed by <code className="text-xs">context-vault setup</code> that teach AI agents how to use your vault.
        </p>
      </div>

      {/* Version + Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Installation Status</CardTitle>
            <span className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
              v{RULES_VERSION}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {TOOL_STATUSES.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center justify-between py-1.5"
            >
              <div className="flex items-center gap-2">
                {tool.installed ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <Circle className="size-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">{tool.name}</span>
              </div>
              <code className="text-xs text-muted-foreground">
                {tool.installPath}
              </code>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-2 border-t border-border">
            Install or update rules via the CLI:{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded">
              npx context-vault setup
            </code>
          </p>
        </CardContent>
      </Card>

      {/* Rules Content */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Rules File</CardTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={copyRules}
            >
              {copied ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-lg p-4 overflow-auto max-h-[500px]">
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed text-foreground/90">
              {RULES_CONTENT}
            </pre>
          </div>
        </CardContent>
      </Card>

      {/* Documentation Link */}
      <Card>
        <CardContent className="pt-6">
          <a
            href="https://context-vault.com/docs/agent-rules"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between group"
          >
            <div>
              <p className="text-sm font-medium group-hover:underline">
                Agent Rules Documentation
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Full reference, manual installation instructions, and version history.
              </p>
            </div>
            <ExternalLink className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
          </a>
        </CardContent>
      </Card>
    </div>
  );
}
