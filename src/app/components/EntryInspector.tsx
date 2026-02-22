import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Entry } from "../lib/types";
import { useDeleteEntry, useUpdateEntry } from "../lib/hooks";
import { ApiError } from "../lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { ScrollArea } from "./ui/scroll-area";
import {
  Edit,
  Trash2,
  Copy,
  FileText,
  Tag,
  Calendar,
  Hash,
  Link2,
  X,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

interface EntryInspectorProps {
  entry: Entry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EntryInspector({
  entry,
  open,
  onOpenChange,
}: EntryInspectorProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [pendingClose, setPendingClose] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [liveEntry, setLiveEntry] = useState<Entry | null>(entry);

  // Edit form state
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editSource, setEditSource] = useState("");
  const [editTagInput, setEditTagInput] = useState("");

  const deleteEntry = useDeleteEntry();
  const updateEntry = useUpdateEntry();
  const qc = useQueryClient();

  // Reset local state when a different entry is opened (getDerivedStateFromProps pattern)
  const [prevId, setPrevId] = useState(entry?.id);
  if (entry?.id !== prevId) {
    setPrevId(entry?.id);
    setLiveEntry(entry);
    setIsEditing(false);
  }

  if (!liveEntry) return null;

  const isDirty =
    isEditing &&
    (editTitle !== liveEntry.title ||
      editBody !== liveEntry.body ||
      JSON.stringify(editTags) !== JSON.stringify(liveEntry.tags) ||
      editSource !== (liveEntry.source || ""));

  const requiresConfirmation =
    liveEntry.category === "knowledge" || liveEntry.category === "entity";
  const confirmSlug =
    liveEntry.source?.split("/").pop()?.replace(".md", "") ||
    liveEntry.id.slice(0, 8);

  const startEditing = () => {
    setEditTitle(liveEntry.title);
    setEditBody(liveEntry.body);
    setEditTags([...liveEntry.tags]);
    setEditSource(liveEntry.source || "");
    setEditTagInput("");
    setIsEditing(true);
  };

  const cancelEditing = () => {
    if (isDirty) {
      setPendingClose(false);
      setDiscardDialogOpen(true);
    } else {
      setIsEditing(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && isDirty) {
      setPendingClose(true);
      setDiscardDialogOpen(true);
      return;
    }
    if (!open) setIsEditing(false);
    onOpenChange(open);
  };

  const handleDiscardConfirm = () => {
    setDiscardDialogOpen(false);
    setIsEditing(false);
    if (pendingClose) onOpenChange(false);
  };

  const handleAddTag = () => {
    const tag = editTagInput.trim();
    if (tag && !editTags.includes(tag)) {
      setEditTags([...editTags, tag]);
    }
    setEditTagInput("");
  };

  const handleSave = () => {
    // Snapshot for rollback
    const snapshot = qc.getQueriesData<{ entries: Entry[]; total: number }>({
      queryKey: ["entries"],
    });

    const updated: Entry = {
      ...liveEntry,
      title: editTitle,
      body: editBody,
      tags: editTags,
      source: editSource || undefined,
    };

    // Optimistic cache update
    qc.setQueriesData<{ entries: Entry[]; total: number }>(
      { queryKey: ["entries"] },
      (old) =>
        old
          ? {
              ...old,
              entries: old.entries.map((e) =>
                e.id === liveEntry.id ? updated : e,
              ),
            }
          : old,
    );

    // Update local display immediately
    setLiveEntry(updated);
    setIsEditing(false);

    const prevEntry = liveEntry;
    updateEntry.mutate(
      {
        id: liveEntry.id,
        title: editTitle,
        body: editBody,
        tags: editTags,
        source: editSource || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Entry saved");
        },
        onError: (err) => {
          // Rollback optimistic update
          for (const [key, data] of snapshot) {
            qc.setQueryData(key, data);
          }
          setLiveEntry(prevEntry);
          if (err instanceof ApiError) {
            toast.error("Failed to save entry", { description: err.message });
          } else {
            toast.error("Failed to save entry");
          }
        },
      },
    );
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(liveEntry, null, 2));
    toast.success("JSON copied to clipboard");
  };

  const handleDelete = () => {
    if (requiresConfirmation && deleteConfirmText !== confirmSlug) {
      toast.error(`Type "${confirmSlug}" to confirm deletion`);
      return;
    }

    setDeleteDialogOpen(false);
    setDeleteConfirmText("");
    onOpenChange(false);

    const snapshot = qc.getQueriesData<{ entries: Entry[]; total: number }>({
      queryKey: ["entries"],
    });

    qc.setQueriesData<{ entries: Entry[]; total: number }>(
      { queryKey: ["entries"] },
      (old) =>
        old
          ? {
              entries: old.entries.filter((e) => e.id !== liveEntry.id),
              total: old.total - 1,
            }
          : old,
    );

    const entryId = liveEntry.id;

    const timeoutId = setTimeout(() => {
      deleteEntry.mutate(entryId, {
        onError: (err) => {
          for (const [key, data] of snapshot) {
            qc.setQueryData(key, data);
          }
          if (err instanceof ApiError) {
            toast.error("Failed to delete entry", { description: err.message });
          } else {
            toast.error("Failed to delete entry");
          }
        },
      });
    }, 5000);

    toast("Entry deleted", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timeoutId);
          for (const [key, data] of snapshot) {
            qc.setQueryData(key, data);
          }
        },
      },
    });
  };

  const breadcrumbs = liveEntry.source?.split("/") || [];

  return (
    <>
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent className="sm:max-w-2xl p-0 gap-0">
          <SheetHeader>
            <div className="space-y-3">
              {/* Breadcrumbs (view mode only) */}
              {!isEditing && breadcrumbs.length > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {breadcrumbs.map((crumb, i) => (
                    <div
                      key={`${i}-${crumb}`}
                      className="flex items-center gap-1.5"
                    >
                      <span
                        className={
                          i === breadcrumbs.length - 1
                            ? "text-foreground font-medium"
                            : ""
                        }
                      >
                        {crumb}
                      </span>
                      {i < breadcrumbs.length - 1 && <span>/</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Title */}
              <SheetTitle className="text-xl">
                {isEditing ? "Edit Entry" : liveEntry.title}
              </SheetTitle>

              {/* Actions */}
              <div className="flex items-center gap-2">
                {isEditing ? (
                  <>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={updateEntry.isPending}
                    >
                      {updateEntry.isPending ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <Check className="size-4 mr-2" />
                      )}
                      Save
                    </Button>
                    <Button variant="outline" size="sm" onClick={cancelEditing}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={startEditing}>
                      <Edit className="size-4 mr-2" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      <Trash2 className="size-4 mr-2" />
                      Delete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyJson}
                    >
                      <Copy className="size-4 mr-2" />
                      Copy JSON
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SheetHeader>

          <Separator />

          <div className="px-4 pb-4">
            {isEditing ? (
              <ScrollArea className="h-[calc(100vh-13rem)] pr-2">
                <div className="space-y-4 pt-4 pr-2">
                  <div className="space-y-2">
                    <Label>Title</Label>
                    <Input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Entry title..."
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Body (Markdown)</Label>
                    <Textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      placeholder="Your content in Markdown..."
                      className="min-h-[300px] font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <div className="flex gap-2">
                      <Input
                        value={editTagInput}
                        onChange={(e) => setEditTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        placeholder="Add tag..."
                      />
                      <Button
                        type="button"
                        onClick={handleAddTag}
                        variant="outline"
                      >
                        Add
                      </Button>
                    </div>
                    {editTags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {editTags.map((tag) => (
                          <Badge key={tag} variant="outline" className="gap-1">
                            {tag}
                            <button
                              onClick={() =>
                                setEditTags(editTags.filter((t) => t !== tag))
                              }
                              className="ml-1 hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label>Kind</Label>
                    <div>
                      <Badge variant="secondary">{liveEntry.kind}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        Kind cannot be changed after creation.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Source</Label>
                    <Input
                      value={editSource}
                      onChange={(e) => setEditSource(e.target.value)}
                      placeholder="e.g. vault/notes/my-note.md"
                    />
                  </div>
                </div>
              </ScrollArea>
            ) : (
              <Tabs defaultValue="content" className="h-[calc(100vh-13rem)]">
                <TabsList className="grid w-full grid-cols-2 mt-4">
                  <TabsTrigger value="content">Content</TabsTrigger>
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                </TabsList>

                <TabsContent value="content" className="h-full">
                  <ScrollArea className="h-full pr-2">
                    <div className="prose prose-sm dark:prose-invert max-w-none pr-2">
                      <pre className="whitespace-pre-wrap font-['Inter'] text-sm bg-transparent border-none p-0 m-0">
                        {liveEntry.body}
                      </pre>
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="metadata" className="h-full">
                  <ScrollArea className="h-full pr-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pr-2">
                      <div className="space-y-1.5 rounded-md border border-border/60 p-3 sm:col-span-2">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Hash className="size-3" />
                          ID
                        </Label>
                        <code className="block bg-muted rounded px-2.5 py-2 text-xs font-mono break-all">
                          {liveEntry.id}
                        </code>
                      </div>

                      <div className="space-y-1.5 rounded-md border border-border/60 p-3">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <FileText className="size-3" />
                          Category
                        </Label>
                        <div>
                          <Badge variant="outline">{liveEntry.category}</Badge>
                        </div>
                      </div>

                      <div className="space-y-1.5 rounded-md border border-border/60 p-3">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Tag className="size-3" />
                          Kind
                        </Label>
                        <div>
                          <Badge
                            variant={
                              liveEntry.category === "knowledge"
                                ? "default"
                                : liveEntry.category === "entity"
                                  ? "outline"
                                  : "secondary"
                            }
                          >
                            {liveEntry.kind}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-1.5 rounded-md border border-border/60 p-3">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="size-3" />
                          Created
                        </Label>
                        <div className="text-sm">
                          {liveEntry.created.toLocaleString()}
                        </div>
                      </div>

                      <div className="space-y-1.5 rounded-md border border-border/60 p-3">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="size-3" />
                          Updated
                        </Label>
                        <div className="text-sm">
                          {liveEntry.updated.toLocaleString()}
                        </div>
                      </div>

                      <div className="space-y-1.5 rounded-md border border-border/60 p-3 sm:col-span-2">
                        <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Tag className="size-3" />
                          Tags
                        </Label>
                        <div className="flex flex-wrap gap-1">
                          {liveEntry.tags.length > 0 ? (
                            liveEntry.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-xs"
                              >
                                {tag}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              No tags
                            </span>
                          )}
                        </div>
                      </div>

                      {liveEntry.source && (
                        <div className="space-y-1.5 rounded-md border border-border/60 p-3 sm:col-span-2">
                          <Label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Link2 className="size-3" />
                            Source
                          </Label>
                          <code className="block bg-muted rounded px-2.5 py-2 text-xs font-mono break-all">
                            {liveEntry.source}
                          </code>
                        </div>
                      )}

                      {liveEntry.metadata &&
                        Object.keys(liveEntry.metadata).length > 0 && (
                          <div className="space-y-1.5 rounded-md border border-border/60 p-3 sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">
                              Metadata
                            </Label>
                            <pre className="bg-muted rounded px-2.5 py-2 text-xs font-mono overflow-x-auto">
                              {JSON.stringify(liveEntry.metadata, null, 2)}
                            </pre>
                          </div>
                        )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Discard Changes Dialog */}
      <AlertDialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. They will be lost if you continue.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={handleDiscardConfirm}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {requiresConfirmation ? (
                <div className="space-y-3">
                  <p>
                    Type{" "}
                    <code className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">
                      {confirmSlug}
                    </code>{" "}
                    to confirm. You'll have 5 seconds to undo.
                  </p>
                  <Input
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder={confirmSlug}
                    className="font-mono"
                  />
                </div>
              ) : (
                <p>
                  This entry will be deleted. You'll have 5 seconds to undo.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirmText("")}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
