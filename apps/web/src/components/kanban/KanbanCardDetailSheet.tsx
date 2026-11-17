import type {
  KanbanCardThreadStatus,
  ScopedKanbanCard,
} from "@t3tools/client-runtime/state/kanban";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  ThreadId,
  type KanbanColumn,
  type KanbanPriority,
  type KanbanTag,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ExternalLinkIcon,
  Link2Icon,
  Link2OffIcon,
  MessageSquareIcon,
  PlayIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "../ui/sheet";
import { Textarea } from "../ui/textarea";
import {
  attentionBadgePresentation,
  COLUMN_LABELS,
  parseTagsInput,
  PRIORITY_BADGE_VARIANTS,
  PRIORITY_LABELS,
} from "./kanbanPresentation";

interface KanbanCardDetailSheetProps {
  readonly scopedCard: ScopedKanbanCard | null;
  readonly projectName: string | null;
  readonly threadStatus: KanbanCardThreadStatus | null;
  readonly projectThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onClose: () => void;
  readonly onSave: (
    scoped: ScopedKanbanCard,
    patch: {
      readonly title: string;
      readonly description: string;
      readonly priority: KanbanPriority;
      readonly tags: ReadonlyArray<KanbanTag>;
      readonly workspaceMode: ThreadEnvMode;
    },
  ) => Promise<void>;
  readonly onMoveColumn: (
    scoped: ScopedKanbanCard,
    column: KanbanColumn,
    reworkFeedback?: string,
  ) => Promise<void>;
  readonly onStartCard: (scoped: ScopedKanbanCard) => Promise<void>;
  readonly onLinkThread: (scoped: ScopedKanbanCard, threadId: ThreadId | null) => Promise<void>;
  readonly onToggleArchive: (scoped: ScopedKanbanCard) => Promise<void>;
  readonly onDeleteCard: (scoped: ScopedKanbanCard) => Promise<void>;
}

export function KanbanCardDetailSheet(props: KanbanCardDetailSheetProps) {
  const { scopedCard } = props;
  return (
    <Sheet
      open={scopedCard !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <SheetPopup side="right">
        {scopedCard !== null ? (
          <CardDetailBody
            key={`${scopedCard.environmentId}:${scopedCard.card.id}:${scopedCard.card.updatedAt}`}
            scopedCard={scopedCard}
            projectName={props.projectName}
            threadStatus={props.threadStatus}
            projectThreads={props.projectThreads}
            onClose={props.onClose}
            onSave={props.onSave}
            onMoveColumn={props.onMoveColumn}
            onStartCard={props.onStartCard}
            onLinkThread={props.onLinkThread}
            onToggleArchive={props.onToggleArchive}
            onDeleteCard={props.onDeleteCard}
          />
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}

function CardDetailBody({
  scopedCard,
  projectName,
  threadStatus,
  projectThreads,
  onClose,
  onSave,
  onMoveColumn,
  onStartCard,
  onLinkThread,
  onToggleArchive,
  onDeleteCard,
}: {
  readonly scopedCard: ScopedKanbanCard;
  readonly projectName: string | null;
  readonly threadStatus: KanbanCardThreadStatus | null;
  readonly projectThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onClose: () => void;
  readonly onSave: KanbanCardDetailSheetProps["onSave"];
  readonly onMoveColumn: KanbanCardDetailSheetProps["onMoveColumn"];
  readonly onStartCard: KanbanCardDetailSheetProps["onStartCard"];
  readonly onLinkThread: KanbanCardDetailSheetProps["onLinkThread"];
  readonly onToggleArchive: KanbanCardDetailSheetProps["onToggleArchive"];
  readonly onDeleteCard: KanbanCardDetailSheetProps["onDeleteCard"];
}) {
  const { card, environmentId } = scopedCard;
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [priority, setPriority] = useState<KanbanPriority>(card.priority);
  const [tagsText, setTagsText] = useState(card.tags.join(", "));
  const [workspaceMode, setWorkspaceMode] = useState<ThreadEnvMode>(
    card.launchPreset?.workspaceMode ?? "worktree",
  );
  const [reworkText, setReworkText] = useState("");
  const [selectedLinkThreadId, setSelectedLinkThreadId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const attention = threadStatus ? attentionBadgePresentation(threadStatus.attention) : null;
  const isDirty =
    title.trim() !== card.title ||
    description !== card.description ||
    priority !== card.priority ||
    parseTagsInput(tagsText).join(",") !== card.tags.join(",") ||
    workspaceMode !== (card.launchPreset?.workspaceMode ?? "worktree");

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (title.trim().length === 0 || busy) return;
    setBusy(true);
    await onSave(scopedCard, {
      title: title.trim(),
      description,
      priority,
      tags: parseTagsInput(tagsText),
      workspaceMode,
    });
    setBusy(false);
  };

  const handleSendFollowUp = async () => {
    const trimmed = reworkText.trim();
    if (trimmed.length === 0 || busy || card.threadId === null) return;
    setBusy(true);
    await onMoveColumn(scopedCard, "in_progress", trimmed);
    setReworkText("");
    setBusy(false);
  };

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    await onStartCard(scopedCard);
    setBusy(false);
  };

  const handleLinkSelectedThread = async () => {
    if (!selectedLinkThreadId || busy) return;
    setBusy(true);
    await onLinkThread(scopedCard, ThreadId.make(selectedLinkThreadId));
    setSelectedLinkThreadId("");
    setBusy(false);
  };

  const handleUnlinkThread = async () => {
    if (busy) return;
    setBusy(true);
    await onLinkThread(scopedCard, null);
    setBusy(false);
  };

  const handleArchive = async () => {
    if (busy) return;
    setBusy(true);
    await onToggleArchive(scopedCard);
    setBusy(false);
  };

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    await onDeleteCard(scopedCard);
    setBusy(false);
    onClose();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SheetHeader>
        <div className="flex flex-wrap items-center gap-1.5 pe-8">
          {projectName ? <Badge variant="outline">{projectName}</Badge> : null}
          <Badge variant={PRIORITY_BADGE_VARIANTS[card.priority]}>
            {PRIORITY_LABELS[card.priority]}
          </Badge>
          {card.archivedAt !== null ? <Badge variant="secondary">Archived</Badge> : null}
        </div>
        <SheetTitle>{card.title}</SheetTitle>
        <SheetDescription>
          Edit card specifications, manage the linked agent thread, or move status columns.
        </SheetDescription>
      </SheetHeader>

      <ScrollArea>
        <div className="space-y-6 px-6 pb-6">
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-foreground text-xs uppercase tracking-wide">
                Agent execution
              </span>
              {attention ? <Badge variant={attention.variant}>{attention.label}</Badge> : null}
            </div>

            {card.threadId !== null ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground text-sm">
                      {threadStatus?.threadTitle ?? "Linked thread"}
                    </div>
                    {threadStatus?.attention.kind === "failed" && threadStatus.attention.message ? (
                      <p className="mt-1 line-clamp-2 text-destructive-foreground text-xs">
                        {threadStatus.attention.message}
                      </p>
                    ) : null}
                  </div>
                  {threadStatus?.pullRequest ? (
                    <a
                      href={threadStatus.pullRequest.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground"
                    >
                      <span>#{threadStatus.pullRequest.number}</span>
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="default"
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={{ environmentId, threadId: card.threadId }}
                      />
                    }
                  >
                    <MessageSquareIcon />
                    <span>Open thread</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void handleUnlinkThread()}
                  >
                    <Link2OffIcon />
                    <span>Unlink</span>
                  </Button>
                </div>

                <div className="space-y-2 border-t border-border/60 pt-3">
                  <Label htmlFor="kanban-detail-rework">Send follow-up / rework instructions</Label>
                  <Textarea
                    id="kanban-detail-rework"
                    rows={2}
                    placeholder="Send feedback to resume this thread in In Progress..."
                    value={reworkText}
                    onChange={(event) => setReworkText(event.target.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy || reworkText.trim().length === 0}
                      onClick={() => void handleSendFollowUp()}
                    >
                      <SendIcon />
                      <span>Send & move to In Progress</span>
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-muted-foreground text-xs">
                  No thread linked yet. Start an agent run with this card's prompt, or bind an
                  existing project thread.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void handleStart()}>
                    <PlayIcon />
                    <span>Start with agent</span>
                  </Button>
                </div>

                {projectThreads.length > 0 ? (
                  <div className="flex items-center gap-2 border-t border-border/60 pt-3">
                    <div className="min-w-0 flex-1">
                      <Select
                        value={selectedLinkThreadId}
                        onValueChange={(value) => {
                          if (value !== null) setSelectedLinkThreadId(value);
                        }}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue placeholder="Link existing thread..." />
                        </SelectTrigger>
                        <SelectPopup>
                          {projectThreads.map((thread) => (
                            <SelectItem key={thread.id} value={thread.id}>
                              {thread.title}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!selectedLinkThreadId || busy}
                      onClick={() => void handleLinkSelectedThread()}
                    >
                      <Link2Icon />
                      <span>Link</span>
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <form className="space-y-4" onSubmit={(event) => void handleSave(event)}>
            <div className="space-y-1.5">
              <Label>Status column</Label>
              <Select
                value={card.column}
                onValueChange={(value) => {
                  if (value !== null && value !== card.column) {
                    void onMoveColumn(scopedCard, value as KanbanColumn);
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {KANBAN_COLUMNS.map((col) => (
                    <SelectItem key={col} value={col}>
                      {COLUMN_LABELS[col]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kanban-detail-title">Title</Label>
              <Input
                id="kanban-detail-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kanban-detail-description">Description & prompt (Markdown)</Label>
              <Textarea
                id="kanban-detail-description"
                rows={7}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Write task requirements and acceptance criteria..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(value) => {
                    if (value !== null) setPriority(value as KanbanPriority);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {KANBAN_PRIORITIES.map((prio) => (
                      <SelectItem key={prio} value={prio}>
                        {PRIORITY_LABELS[prio]}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Default workspace</Label>
                <Select
                  value={workspaceMode}
                  onValueChange={(value) => {
                    if (value !== null) setWorkspaceMode(value as ThreadEnvMode);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value="worktree">Worktree (isolated)</SelectItem>
                    <SelectItem value="local">Local checkout</SelectItem>
                  </SelectPopup>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="kanban-detail-tags">Tags (comma-separated)</Label>
              <Input
                id="kanban-detail-tags"
                value={tagsText}
                onChange={(event) => setTagsText(event.target.value)}
                placeholder="frontend, api, urgent"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="submit" size="sm" disabled={!isDirty || busy || title.trim() === ""}>
                Save changes
              </Button>
            </div>
          </form>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void handleArchive()}
            >
              {card.archivedAt !== null ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              <span>{card.archivedAt !== null ? "Restore card" : "Archive card"}</span>
            </Button>

            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              <Trash2Icon />
              <span>Delete card</span>
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
