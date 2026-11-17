import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  type KanbanColumn,
  type KanbanPriority,
  type KanbanTag,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { useState, type FormEvent } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { COLUMN_LABELS, parseTagsInput, PRIORITY_LABELS } from "./kanbanPresentation";

interface KanbanCreateCardDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly defaultProjectKey: string | null;
  readonly defaultColumn: KanbanColumn;
  readonly onSubmit: (input: {
    readonly project: EnvironmentProject;
    readonly title: string;
    readonly description: string;
    readonly column: KanbanColumn;
    readonly priority: KanbanPriority;
    readonly tags: ReadonlyArray<KanbanTag>;
    readonly workspaceMode: ThreadEnvMode;
  }) => Promise<boolean>;
}

export function projectSelectionKey(project: Pick<EnvironmentProject, "environmentId" | "id">) {
  return `${project.environmentId}:${project.id}`;
}

export function KanbanCreateCardDialog(props: KanbanCreateCardDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>New kanban card</DialogTitle>
          <DialogDescription>
            Add a task to your project board. Cards placed in In Progress immediately launch an
            agent thread.
          </DialogDescription>
        </DialogHeader>
        {props.open ? (
          <CreateCardForm
            key={`${props.defaultProjectKey ?? "first"}:${props.defaultColumn}`}
            projects={props.projects}
            defaultProjectKey={props.defaultProjectKey}
            defaultColumn={props.defaultColumn}
            onClose={() => props.onOpenChange(false)}
            onSubmit={props.onSubmit}
          />
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

function CreateCardForm({
  projects,
  defaultProjectKey,
  defaultColumn,
  onClose,
  onSubmit,
}: {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly defaultProjectKey: string | null;
  readonly defaultColumn: KanbanColumn;
  readonly onClose: () => void;
  readonly onSubmit: KanbanCreateCardDialogProps["onSubmit"];
}) {
  const initialProjectKey =
    (defaultProjectKey !== null &&
    projects.some((p) => projectSelectionKey(p) === defaultProjectKey)
      ? defaultProjectKey
      : null) ?? (projects[0] ? projectSelectionKey(projects[0]) : "");

  const [selectedProjectKey, setSelectedProjectKey] = useState(initialProjectKey);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [column, setColumn] = useState<KanbanColumn>(defaultColumn);
  const [priority, setPriority] = useState<KanbanPriority>("medium");
  const [tagsText, setTagsText] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<ThreadEnvMode>("worktree");
  const [submitting, setSubmitting] = useState(false);

  const effectiveProject =
    projects.find((p) => projectSelectionKey(p) === selectedProjectKey) ?? projects[0] ?? null;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!effectiveProject || title.trim().length === 0 || submitting) return;
    setSubmitting(true);
    const ok = await onSubmit({
      project: effectiveProject,
      title: title.trim(),
      description: description.trim(),
      column,
      priority,
      tags: parseTagsInput(tagsText),
      workspaceMode,
    });
    setSubmitting(false);
    if (ok) {
      onClose();
    }
  };

  return (
    <form className="flex min-h-0 flex-col" onSubmit={(event) => void handleSubmit(event)}>
      <DialogPanel>
        <div className="space-y-4">
          {projects.length > 1 ? (
            <div className="space-y-1.5">
              <Label>Project</Label>
              <Select
                value={effectiveProject ? projectSelectionKey(effectiveProject) : ""}
                onValueChange={(value) => {
                  if (value !== null) setSelectedProjectKey(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectPopup>
                  {projects.map((project) => {
                    const key = projectSelectionKey(project);
                    return (
                      <SelectItem key={key} value={key}>
                        {project.title}
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="kanban-create-title">Title</Label>
            <Input
              id="kanban-create-title"
              placeholder="e.g. Implement OAuth token refresh"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kanban-create-description">Description & prompt (Markdown)</Label>
            <Textarea
              id="kanban-create-description"
              placeholder="Context, acceptance criteria, and instructions sent to the agent when started..."
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Column</Label>
              <Select
                value={column}
                onValueChange={(value) => {
                  if (value !== null) setColumn(value as KanbanColumn);
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
              <Label>Workspace</Label>
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
            <Label htmlFor="kanban-create-tags">Tags (comma-separated)</Label>
            <Input
              id="kanban-create-tags"
              placeholder="auth, backend, bug"
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
            />
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button
          type="submit"
          disabled={!effectiveProject || title.trim().length === 0 || submitting}
          data-slot="dialog-action"
        >
          {column === "in_progress" ? "Create & start agent" : "Create card"}
        </Button>
      </DialogFooter>
    </form>
  );
}
