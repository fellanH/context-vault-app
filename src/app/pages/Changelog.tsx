import { Link } from "react-router";
import { ArrowLeft, Tag } from "lucide-react";
import { Badge } from "../components/ui/badge";
import entries from "../../data/changelog.json";

interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  bullets: string[];
}

const changelog = entries as ChangelogEntry[];

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function Changelog() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-10">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Changelog</h1>
          <p className="text-muted-foreground mt-2">
            New features, improvements, and fixes in Context Vault.
          </p>
        </div>

        {/* Release timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3 top-2 bottom-0 w-px bg-border" />

          <div className="space-y-12">
            {changelog.map((entry, idx) => (
              <div key={entry.version} className="relative pl-10">
                {/* Timeline dot */}
                <div
                  className={`absolute left-0 top-1.5 size-6 rounded-full border-2 flex items-center justify-center ${
                    idx === 0
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <Tag className="size-3" />
                </div>

                {/* Release header */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <Badge
                    variant={idx === 0 ? "default" : "secondary"}
                    className="font-mono text-xs"
                  >
                    v{entry.version}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(entry.date)}
                  </span>
                  {idx === 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 bg-emerald-500/5"
                    >
                      Latest
                    </Badge>
                  )}
                </div>

                <h2 className="text-lg font-semibold mb-3">{entry.title}</h2>

                <ul className="space-y-2">
                  {entry.bullets.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="mt-2 size-1.5 rounded-full bg-muted-foreground/60 flex-shrink-0" />
                      <span className="text-muted-foreground leading-relaxed">
                        {bullet}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-border text-center text-sm text-muted-foreground">
          <p>
            Have a feature request or found a bug?{" "}
            <a
              href="https://github.com/context-vault/app/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground hover:underline"
            >
              Open a GitHub issue
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
