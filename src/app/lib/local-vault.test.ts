import { describe, expect, it } from "vitest";
import {
  extractBody,
  extractTitle,
  normalizeKind,
  parseFrontmatter,
  searchEntries,
  type LocalVaultEntry,
} from "./local-vault";

describe("parseFrontmatter", () => {
  it("parses simple key: value pairs", () => {
    const content = `---\ntitle: Hello\nsource: cli\n---\nbody`;
    expect(parseFrontmatter(content)).toEqual({ title: "Hello", source: "cli" });
  });

  it("parses array values", () => {
    const content = `---\ntags: ['a', 'b', "c"]\n---\nbody`;
    expect(parseFrontmatter(content)).toEqual({ tags: ["a", "b", "c"] });
  });

  it("strips matching double or single quotes", () => {
    const content = `---\ndouble: "hi there"\nsingle: 'hi there'\n---\n`;
    expect(parseFrontmatter(content)).toEqual({
      double: "hi there",
      single: "hi there",
    });
  });

  it("parses JSON-coercible scalars (numbers, booleans, null)", () => {
    const content = `---\ncount: 3\nactive: true\nempty: null\n---\n`;
    expect(parseFrontmatter(content)).toEqual({
      count: 3,
      active: true,
      empty: null,
    });
  });

  it("falls back to a raw string when a bare value isn't valid JSON", () => {
    const content = `---\nid: abc-123\n---\n`;
    expect(parseFrontmatter(content)).toEqual({ id: "abc-123" });
  });

  it("returns an empty object when content has no frontmatter fence", () => {
    expect(parseFrontmatter("# Just a heading\nbody text")).toEqual({});
  });

  it("ignores lines without a colon", () => {
    const content = `---\ntitle: Hello\nno colon here\n---\n`;
    expect(parseFrontmatter(content)).toEqual({ title: "Hello" });
  });
});

describe("extractTitle", () => {
  it("extracts the first level-1 heading", () => {
    expect(extractTitle("intro\n# My Title\nmore text")).toBe("My Title");
  });

  it("trims surrounding whitespace from the heading", () => {
    expect(extractTitle("#   Spaced Title   \n")).toBe("Spaced Title");
  });

  it("returns an empty string when there is no heading", () => {
    expect(extractTitle("just some text, no heading")).toBe("");
  });

  it("does not match a heading with no space after #", () => {
    expect(extractTitle("#NoSpace\nbody")).toBe("");
  });
});

describe("extractBody", () => {
  it("strips the frontmatter block and returns the remaining body", () => {
    const content = `---\ntitle: Hello\n---\n\n# Hello\n\nBody text.`;
    expect(extractBody(content)).toBe("# Hello\n\nBody text.");
  });

  it("returns the content unchanged when there is no frontmatter fence", () => {
    expect(extractBody("# Hello\n\nBody text.")).toBe("# Hello\n\nBody text.");
  });

  it("returns an empty string when frontmatter is the entire content", () => {
    expect(extractBody(`---\ntitle: Hello\n---\n`)).toBe("");
  });
});

describe("normalizeKind", () => {
  it("passes through known kind names", () => {
    expect(normalizeKind("insight")).toBe("insight");
    expect(normalizeKind("project")).toBe("project");
    expect(normalizeKind("session")).toBe("session");
  });

  it("falls back to reference for unknown kind names", () => {
    expect(normalizeKind("made-up-kind")).toBe("reference");
    expect(normalizeKind("")).toBe("reference");
  });
});

describe("searchEntries", () => {
  const entries: LocalVaultEntry[] = [
    {
      id: "1",
      category: "knowledge",
      kind: "insight",
      title: "React hooks patterns",
      body: "",
      tags: ["react", "frontend"],
      created: new Date(),
      updated: new Date(),
      visibility: "private",
    },
    {
      id: "2",
      category: "entity",
      kind: "tool",
      title: "Turso",
      body: "",
      tags: ["database"],
      created: new Date(),
      updated: new Date(),
      visibility: "private",
    },
  ];

  it("returns all entries when the query is empty or whitespace", () => {
    expect(searchEntries(entries, "")).toEqual(entries);
    expect(searchEntries(entries, "   ")).toEqual(entries);
  });

  it("matches case-insensitively on title", () => {
    expect(searchEntries(entries, "REACT")).toEqual([entries[0]]);
  });

  it("matches on tags", () => {
    expect(searchEntries(entries, "database")).toEqual([entries[1]]);
  });

  it("matches on kind and category", () => {
    expect(searchEntries(entries, "tool")).toEqual([entries[1]]);
    expect(searchEntries(entries, "knowledge")).toEqual([entries[0]]);
  });

  it("returns no results for a query that matches nothing indexed", () => {
    expect(searchEntries(entries, "nonexistent")).toEqual([]);
  });

  it("does not match against body, since it is empty at index time", () => {
    const withBody: LocalVaultEntry[] = [
      { ...entries[0]!, body: "mentions turso somewhere in the body" },
    ];
    expect(searchEntries(withBody, "turso")).toEqual([]);
  });
});
