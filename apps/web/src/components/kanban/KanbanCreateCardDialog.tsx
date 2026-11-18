import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  type KanbanColumn,
  type KanbanPriority,
  type KanbanTag,
  type ThreadEnvMode,
} from "@t3tools/contracts";
import { T, useGT, useMessages } from "gt-react";
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
import {
  COLUMN_LABELS,
  parseTagsInput,
  PRIORITY_LABELS,
  WORKSPACE_MODE_LABELS,
} from "./kanbanPresentation";

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
          <DialogTitle>
            <T>New kanban card</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Add a task to your project board. Cards placed in In Progress immediately launch an
              agent thread.
            </T>
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
  const gt = useGT();
  const m = useMessages();
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

  const projectItems = Object.fromEntries(
    projects.map((project) => [projectSelectionKey(project), project.title]),
  );
  const columnItems = Object.fromEntries(KANBAN_COLUMNS.map((col) => [col, m(COLUMN_LABELS[col])]));
  const priorityItems = Object.fromEntries(
    KANBAN_PRIORITIES.map((prio) => [prio, m(PRIORITY_LABELS[prio])]),
  );
  const workspaceItems = {
    worktree: m(WORKSPACE_MODE_LABELS.worktree),
    local: m(WORKSPACE_MODE_LABELS.local),
  };

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
              <Label>
                <T>Project</T>
              </Label>
              <Select
                value={effectiveProject ? projectSelectionKey(effectiveProject) : null}
                items={projectItems}
                onValueChange={(value) => {
                  if (value !== null) setSelectedProjectKey(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={gt("Choose project")} />
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
            <Label htmlFor="kanban-create-title">
              <T>Title</T>
            </Label>
            <Input
              id="kanban-create-title"
              placeholder={gt("e.g. Implement OAuth token refresh")}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kanban-create-description">
              <T>Description & prompt (Markdown)</T>
            </Label>
            <Textarea
              id="kanban-create-description"
              placeholder={gt(
                "Context, acceptance criteria, and instructions sent to the agent when started...",
              )}
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>
                <T>Column</T>
              </Label>
              <Select
                value={column}
                items={columnItems}
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
                      {m(COLUMN_LABELS[col])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                <T>Priority</T>
              </Label>
              <Select
                value={priority}
                items={priorityItems}
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
                      {m(PRIORITY_LABELS[prio])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                <T>Workspace</T>
              </Label>
              <Select
                value={workspaceMode}
                items={workspaceItems}
                onValueChange={(value) => {
                  if (value !== null) setWorkspaceMode(value as ThreadEnvMode);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="worktree">{m(WORKSPACE_MODE_LABELS.worktree)}</SelectItem>
                  <SelectItem value="local">{m(WORKSPACE_MODE_LABELS.local)}</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kanban-create-tags">
              <T>Tags (comma-separated)</T>
            </Label>
            <Input
              id="kanban-create-tags"
              placeholder={gt("auth, backend, bug")}
              value={tagsText}
              onChange={(event) => setTagsText(event.target.value)}
            />
          </div>
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>
          <T>Cancel</T>
        </DialogClose>
        <Button
          type="submit"
          disabled={!effectiveProject || title.trim().length === 0 || submitting}
          data-slot="dialog-action"
        >
          {column === "in_progress" ? gt("Create & start agent") : gt("Create card")}
        </Button>
      </DialogFooter>
    </form>
  );
}
