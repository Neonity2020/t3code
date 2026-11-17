import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  deriveKanbanCardThreadStatus,
  filterAndGroupKanbanCards,
  resolveDropBeforeCardId,
  type KanbanCardThreadStatus,
  type ScopedKanbanCard,
} from "@t3tools/client-runtime/state/kanban";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import * as Cause from "effect/Cause";
import {
  DEFAULT_SERVER_SETTINGS,
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  type EnvironmentId,
  type KanbanCardId,
  type KanbanColumn,
  type KanbanPriority,
  type KanbanTag,
  type ThreadEnvMode,
  type ThreadId,
  resolveBuiltinPluginEnabled,
} from "@t3tools/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BlocksIcon,
  MessageSquareIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useState, type CSSProperties } from "react";

import { PULL_REQUEST_STATE_PRESENTATION } from "../pullRequest/pullRequestIcons";

import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProjects, useQuietThreadShells } from "~/state/entities";
import { useKanbanMutations, useScopedKanbanCards, useSettingsByEnvironment } from "~/state/kanban";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { KanbanCardDetailSheet } from "./KanbanCardDetailSheet";
import { KanbanCreateCardDialog, projectSelectionKey } from "./KanbanCreateCardDialog";
import {
  attentionBadgePresentation,
  COLUMN_DOT_CLASSES,
  COLUMN_LABELS,
  isValidKanbanColumn,
  PRIORITY_BADGE_VARIANTS,
  PRIORITY_LABELS,
  type KanbanRouteSearch,
} from "./kanbanPresentation";
import { KanbanReworkDialog } from "./KanbanReworkDialog";

const ALL_PROJECTS_VALUE = "__all__";
const ALL_PRIORITIES_VALUE = "__all__";
const ALL_TAGS_VALUE = "__all__";

function cardDragId(scoped: ScopedKanbanCard): string {
  return `card:${scoped.environmentId}:${scoped.card.id}`;
}

function columnDropId(column: KanbanColumn): string {
  return `column:${column}`;
}

function parseProjectFilterValue(
  value: string,
  projects: ReadonlyArray<EnvironmentProject>,
): EnvironmentProject | null {
  if (value === ALL_PROJECTS_VALUE) return null;
  return projects.find((p) => projectSelectionKey(p) === value) ?? null;
}

function formatCommandFailure(result: { readonly cause: Cause.Cause<unknown> }): string {
  const err = squashAtomCommandFailure(result);
  return err instanceof Error ? err.message : String(err);
}

interface PendingReworkMove {
  readonly scoped: ScopedKanbanCard;
  readonly beforeCardId: KanbanCardId | null;
}

export function KanbanBoardPage() {
  const search: KanbanRouteSearch = useSearch({ from: "/_chat/kanban" });
  const navigate = useNavigate({ from: "/kanban" });

  const projects = useProjects();
  const settingsByEnvironment = useSettingsByEnvironment();
  const scopedCards = useScopedKanbanCards();
  const threadShells = useQuietThreadShells();
  const mutations = useKanbanMutations();

  const enabledProjects = projects.filter((project) => {
    if (project.isScratch || project.archivedAt != null) return false;
    const settings = settingsByEnvironment.get(project.environmentId) ?? DEFAULT_SERVER_SETTINGS;
    return resolveBuiltinPluginEnabled(settings, "kanban", project.id);
  });

  const projectNamesByKey = new Map<string, string>();
  for (const project of projects) {
    projectNamesByKey.set(projectSelectionKey(project), project.title);
  }

  const threadShellByKey = new Map<string, EnvironmentThreadShell>();
  for (const shell of threadShells) {
    if (shell.deletedAt === null) {
      threadShellByKey.set(`${shell.environmentId}:${shell.id}`, shell);
    }
  }

  const activeFilterProject =
    search.projectId !== undefined
      ? (enabledProjects.find(
          (project) =>
            project.id === search.projectId &&
            (search.environmentId === undefined || project.environmentId === search.environmentId),
        ) ?? null)
      : null;

  const projectSelectValue = activeFilterProject
    ? projectSelectionKey(activeFilterProject)
    : ALL_PROJECTS_VALUE;

  const grouped = filterAndGroupKanbanCards(
    scopedCards,
    {
      projectId: activeFilterProject?.id ?? null,
      environmentId: activeFilterProject?.environmentId ?? null,
      query: search.q ?? "",
      priority: search.priority ?? null,
      tag: search.tag ?? null,
      showArchived: search.archived === true,
    },
    settingsByEnvironment,
  );

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDefaultColumn, setCreateDefaultColumn] = useState<KanbanColumn>("backlog");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [pendingRework, setPendingRework] = useState<PendingReworkMove | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const updateSearch = (patch: {
    readonly [K in keyof KanbanRouteSearch]?: KanbanRouteSearch[K] | undefined;
  }) => {
    void navigate({
      to: "/kanban",
      search: (prev) => {
        const next: Record<string, unknown> = { ...prev };
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) {
            delete next[key];
          } else {
            next[key] = value;
          }
        }
        return next as KanbanRouteSearch;
      },
      replace: true,
    });
  };

  const selectedScopedCard =
    search.cardId !== undefined
      ? (scopedCards.find(
          (entry) =>
            entry.card.id === search.cardId &&
            (search.environmentId === undefined || entry.environmentId === search.environmentId),
        ) ?? null)
      : null;

  const activeDragCard =
    activeDragId !== null
      ? (scopedCards.find((entry) => cardDragId(entry) === activeDragId) ?? null)
      : null;

  const openCreateForColumn = (column: KanbanColumn) => {
    setCreateDefaultColumn(column);
    setCreateDialogOpen(true);
  };

  const handleCreateCard = async (input: {
    readonly project: EnvironmentProject;
    readonly title: string;
    readonly description: string;
    readonly column: KanbanColumn;
    readonly priority: KanbanPriority;
    readonly tags: ReadonlyArray<KanbanTag>;
    readonly workspaceMode: ThreadEnvMode;
  }): Promise<boolean> => {
    const result = await mutations.createCard({
      environmentId: input.project.environmentId,
      input: {
        projectId: input.project.id,
        title: input.title,
        description: input.description,
        column: input.column,
        priority: input.priority,
        tags: [...input.tags],
        launchPreset: { workspaceMode: input.workspaceMode },
        autoStart: input.column === "in_progress",
      },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not create card",
        description: formatCommandFailure(result),
      });
      return false;
    }
    if (result.value.launchedThreadId) {
      toastManager.add({
        type: "success",
        title: "Agent started",
        description: `Started a linked thread for "${result.value.card.title}".`,
      });
    }
    return true;
  };

  const performMoveCard = async (
    scoped: ScopedKanbanCard,
    targetColumn: KanbanColumn,
    beforeCardId: KanbanCardId | null | undefined,
    reworkFeedback?: string,
  ) => {
    const result = await mutations.moveCard({
      environmentId: scoped.environmentId,
      input: {
        id: scoped.card.id,
        column: targetColumn,
        ...(beforeCardId === undefined ? {} : { beforeCardId }),
        autoStart: targetColumn === "in_progress" && scoped.card.threadId === null,
        ...(reworkFeedback === undefined ? {} : { reworkFeedback }),
      },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not move card",
        description: formatCommandFailure(result),
      });
      return;
    }
    if (result.value.launchedThreadId) {
      toastManager.add({
        type: "success",
        title: "Agent started",
        description: `Launched a thread for "${result.value.card.title}".`,
      });
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;

    const dragged = scopedCards.find((entry) => cardDragId(entry) === String(active.id));
    if (!dragged) return;

    const overId = String(over.id);
    let targetColumn: KanbanColumn;
    let beforeCardId: KanbanCardId | null = null;

    if (overId.startsWith("column:")) {
      const colCandidate = overId.slice("column:".length);
      if (!isValidKanbanColumn(colCandidate)) return;
      targetColumn = colCandidate;
      beforeCardId = null;
    } else {
      const overCard = scopedCards.find((entry) => cardDragId(entry) === overId);
      if (!overCard) return;
      if (overCard.card.id === dragged.card.id) return;
      targetColumn = overCard.card.column;
      beforeCardId = resolveDropBeforeCardId(
        grouped.byColumn[targetColumn],
        dragged.card.id,
        overCard.card.id,
      );
    }

    if (
      targetColumn === "in_progress" &&
      dragged.card.column !== "in_progress" &&
      dragged.card.threadId !== null
    ) {
      setPendingRework({ scoped: dragged, beforeCardId });
      return;
    }

    void performMoveCard(dragged, targetColumn, beforeCardId);
  };

  const handleStartCard = async (scoped: ScopedKanbanCard) => {
    const result = await mutations.startCard({
      environmentId: scoped.environmentId,
      input: { id: scoped.card.id },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not start agent",
        description: formatCommandFailure(result),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: "Agent started",
      description: `Started "${result.value.card.title}" in In Progress.`,
    });
  };

  const handleSaveCardDetail = async (
    scoped: ScopedKanbanCard,
    patch: {
      readonly title: string;
      readonly description: string;
      readonly priority: KanbanPriority;
      readonly tags: ReadonlyArray<KanbanTag>;
      readonly workspaceMode: ThreadEnvMode;
    },
  ) => {
    const result = await mutations.updateCard({
      environmentId: scoped.environmentId,
      input: {
        id: scoped.card.id,
        title: patch.title,
        description: patch.description,
        priority: patch.priority,
        tags: [...patch.tags],
        launchPreset: {
          ...(scoped.card.launchPreset?.modelSelection !== undefined
            ? { modelSelection: scoped.card.launchPreset.modelSelection }
            : {}),
          workspaceMode: patch.workspaceMode,
        },
      },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not save card",
        description: formatCommandFailure(result),
      });
    }
  };

  const handleLinkThread = async (scoped: ScopedKanbanCard, threadId: ThreadId | null) => {
    const result = await mutations.linkThread({
      environmentId: scoped.environmentId,
      input: { id: scoped.card.id, threadId },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not update thread link",
        description: formatCommandFailure(result),
      });
    }
  };

  const handleToggleArchive = async (scoped: ScopedKanbanCard) => {
    const nextArchived = scoped.card.archivedAt === null;
    const result = await mutations.setArchived({
      environmentId: scoped.environmentId,
      input: { id: scoped.card.id, archived: nextArchived },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not update archive status",
        description: formatCommandFailure(result),
      });
    }
  };

  const handleArchiveAllDone = async () => {
    const targetEnvIds: ReadonlyArray<EnvironmentId> = activeFilterProject
      ? [activeFilterProject.environmentId]
      : [...new Set(enabledProjects.map((p) => p.environmentId))];
    for (const environmentId of targetEnvIds) {
      await mutations.archiveDone({
        environmentId,
        input: activeFilterProject ? { projectId: activeFilterProject.id } : {},
      });
    }
  };

  const handleDeleteCard = async (scoped: ScopedKanbanCard) => {
    const result = await mutations.deleteCard({
      environmentId: scoped.environmentId,
      input: { id: scoped.card.id },
    });
    if (result._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not delete card",
        description: formatCommandFailure(result),
      });
      return;
    }
    if (search.cardId === scoped.card.id) {
      updateSearch({ cardId: undefined });
    }
  };

  const selectedThreadStatus =
    selectedScopedCard && selectedScopedCard.card.threadId !== null
      ? deriveKanbanCardThreadStatus(
          threadShellByKey.get(
            `${selectedScopedCard.environmentId}:${selectedScopedCard.card.threadId}`,
          ) ?? null,
        )
      : null;

  const selectedProjectThreads = selectedScopedCard
    ? threadShells.filter(
        (shell) =>
          shell.environmentId === selectedScopedCard.environmentId &&
          shell.projectId === selectedScopedCard.card.projectId &&
          shell.deletedAt === null &&
          shell.archivedAt === null &&
          shell.lineage.relationshipToParent !== "subagent",
      )
    : [];

  return (
    <SidebarInset className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header
        className={cn(
          "flex min-h-[var(--workspace-topbar-height)] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2",
          isElectron && "drag-region",
        )}
      >
        <div className="flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag]">
          <div className="md:hidden">
            <SidebarTrigger variant="ghost" aria-label="Toggle main sidebar" />
          </div>
          <h1 className="font-semibold text-base text-foreground">Kanban</h1>

          {enabledProjects.length > 0 ? (
            <div className="w-48">
              <Select
                value={projectSelectValue}
                onValueChange={(value) => {
                  if (value === null) return;
                  const chosen = parseProjectFilterValue(value, enabledProjects);
                  updateSearch({
                    projectId: chosen?.id,
                    environmentId: chosen?.environmentId,
                    cardId: undefined,
                  });
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
                  {enabledProjects.map((project) => {
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
        </div>

        {enabledProjects.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 [-webkit-app-region:no-drag]">
            <div className="relative w-44 sm:w-56">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <div className="[&_input]:ps-8">
                <Input
                  size="sm"
                  placeholder="Filter cards..."
                  value={search.q ?? ""}
                  onChange={(event) => updateSearch({ q: event.target.value || undefined })}
                />
              </div>
              {search.q ? (
                <div className="absolute end-1 top-1/2 -translate-y-1/2">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Clear search"
                    onClick={() => updateSearch({ q: undefined })}
                  >
                    <XIcon />
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="w-32">
              <Select
                value={search.priority ?? ALL_PRIORITIES_VALUE}
                onValueChange={(value) => {
                  if (value === null) return;
                  updateSearch({
                    priority:
                      value === ALL_PRIORITIES_VALUE ? undefined : (value as KanbanPriority),
                  });
                }}
              >
                <SelectTrigger size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={ALL_PRIORITIES_VALUE}>All priorities</SelectItem>
                  {KANBAN_PRIORITIES.map((prio) => (
                    <SelectItem key={prio} value={prio}>
                      {PRIORITY_LABELS[prio]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>

            {grouped.allTags.length > 0 ? (
              <div className="w-32">
                <Select
                  value={search.tag ?? ALL_TAGS_VALUE}
                  onValueChange={(value) => {
                    if (value === null) return;
                    updateSearch({ tag: value === ALL_TAGS_VALUE ? undefined : value });
                  }}
                >
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={ALL_TAGS_VALUE}>All tags</SelectItem>
                    {grouped.allTags.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}

            {!search.archived && grouped.doneActiveCount > 0 ? (
              <Button size="sm" variant="outline" onClick={() => void handleArchiveAllDone()}>
                <ArchiveIcon />
                <span>Archive Done ({grouped.doneActiveCount})</span>
              </Button>
            ) : null}

            <Button
              size="sm"
              variant={search.archived ? "secondary" : "ghost"}
              onClick={() => updateSearch({ archived: search.archived ? undefined : true })}
            >
              {search.archived ? <ArchiveRestoreIcon /> : <ArchiveIcon />}
              <span>
                {search.archived ? "Back to active" : `Archived (${grouped.archivedCount})`}
              </span>
            </Button>

            <Button size="sm" onClick={() => openCreateForColumn("backlog")}>
              <PlusIcon />
              <span>New card</span>
            </Button>
          </div>
        ) : null}
      </header>

      {enabledProjects.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty>
            <EmptyHeader>
              <BlocksIcon className="mx-auto mb-2 size-8 text-muted-foreground" />
              <EmptyTitle>No projects with Kanban enabled</EmptyTitle>
              <EmptyDescription>
                Add a project or enable the Project Kanban board plugin in Settings.
              </EmptyDescription>
            </EmptyHeader>
            <Button size="sm" variant="outline" render={<Link to="/settings/plugins" />}>
              Manage plugins
            </Button>
          </Empty>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumnLane
                key={column}
                column={column}
                cards={grouped.byColumn[column]}
                showProjectBadge={activeFilterProject === null && enabledProjects.length > 1}
                projectNamesByKey={projectNamesByKey}
                threadShellByKey={threadShellByKey}
                selectedCardId={search.cardId ?? null}
                onAddCard={() => openCreateForColumn(column)}
                onSelectCard={(scoped) =>
                  updateSearch({
                    cardId: scoped.card.id,
                    environmentId: scoped.environmentId,
                  })
                }
                onStartCard={(scoped) => void handleStartCard(scoped)}
              />
            ))}
          </div>

          <DragOverlay>
            {activeDragCard ? (
              <div className="w-72 opacity-95 shadow-lg">
                <KanbanCardSurface
                  scoped={activeDragCard}
                  projectName={
                    activeFilterProject === null && enabledProjects.length > 1
                      ? (projectNamesByKey.get(
                          `${activeDragCard.environmentId}:${activeDragCard.card.projectId}`,
                        ) ?? null)
                      : null
                  }
                  threadStatus={
                    activeDragCard.card.threadId !== null
                      ? deriveKanbanCardThreadStatus(
                          threadShellByKey.get(
                            `${activeDragCard.environmentId}:${activeDragCard.card.threadId}`,
                          ) ?? null,
                        )
                      : null
                  }
                  isSelected={false}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {createDialogOpen ? (
        <KanbanCreateCardDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          projects={enabledProjects}
          defaultProjectKey={activeFilterProject ? projectSelectionKey(activeFilterProject) : null}
          defaultColumn={createDefaultColumn}
          onSubmit={handleCreateCard}
        />
      ) : null}

      {selectedScopedCard ? (
        <KanbanCardDetailSheet
          scopedCard={selectedScopedCard}
          projectName={
            projectNamesByKey.get(
              `${selectedScopedCard.environmentId}:${selectedScopedCard.card.projectId}`,
            ) ?? null
          }
          threadStatus={selectedThreadStatus}
          projectThreads={selectedProjectThreads}
          onClose={() => updateSearch({ cardId: undefined })}
          onSave={handleSaveCardDetail}
          onMoveColumn={(scoped, column, reworkFeedback) =>
            performMoveCard(scoped, column, undefined, reworkFeedback)
          }
          onStartCard={handleStartCard}
          onLinkThread={handleLinkThread}
          onToggleArchive={handleToggleArchive}
          onDeleteCard={handleDeleteCard}
        />
      ) : null}

      {pendingRework ? (
        <KanbanReworkDialog
          open
          cardTitle={pendingRework.scoped.card.title}
          onCancel={() => setPendingRework(null)}
          onConfirm={async (feedback) => {
            const current = pendingRework;
            setPendingRework(null);
            await performMoveCard(current.scoped, "in_progress", current.beforeCardId, feedback);
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

function KanbanColumnLane({
  column,
  cards,
  showProjectBadge,
  projectNamesByKey,
  threadShellByKey,
  selectedCardId,
  onAddCard,
  onSelectCard,
  onStartCard,
}: {
  readonly column: KanbanColumn;
  readonly cards: ReadonlyArray<ScopedKanbanCard>;
  readonly showProjectBadge: boolean;
  readonly projectNamesByKey: ReadonlyMap<string, string>;
  readonly threadShellByKey: ReadonlyMap<string, EnvironmentThreadShell>;
  readonly selectedCardId: KanbanCardId | null;
  readonly onAddCard: () => void;
  readonly onSelectCard: (scoped: ScopedKanbanCard) => void;
  readonly onStartCard: (scoped: ScopedKanbanCard) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: columnDropId(column),
  });

  const itemIds = cards.map(cardDragId);

  return (
    <section
      ref={setNodeRef}
      aria-label={COLUMN_LABELS[column]}
      className={cn(
        "flex h-full w-72 shrink-0 flex-col rounded-xl border border-border/70 bg-muted/25 transition-colors",
        isOver && "border-ring bg-accent/40",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-2 shrink-0 rounded-full", COLUMN_DOT_CLASSES[column])} />
          <h2 className="truncate font-medium text-foreground text-sm">{COLUMN_LABELS[column]}</h2>
          <Badge size="sm" variant="secondary">
            {cards.length}
          </Badge>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Add card to ${COLUMN_LABELS[column]}`}
          onClick={onAddCard}
        >
          <PlusIcon />
        </Button>
      </div>

      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-2.5">
          {cards.map((scoped) => {
            const threadStatus =
              scoped.card.threadId !== null
                ? deriveKanbanCardThreadStatus(
                    threadShellByKey.get(`${scoped.environmentId}:${scoped.card.threadId}`) ?? null,
                  )
                : null;
            const projectName = showProjectBadge
              ? (projectNamesByKey.get(`${scoped.environmentId}:${scoped.card.projectId}`) ?? null)
              : null;
            return (
              <SortableKanbanCard
                key={cardDragId(scoped)}
                scoped={scoped}
                projectName={projectName}
                threadStatus={threadStatus}
                isSelected={selectedCardId === scoped.card.id}
                onSelect={() => onSelectCard(scoped)}
                onStart={() => onStartCard(scoped)}
              />
            );
          })}
          {cards.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-border/50 p-3 text-center text-muted-foreground text-xs">
              Drop cards here
            </div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableKanbanCard({
  scoped,
  projectName,
  threadStatus,
  isSelected,
  onSelect,
  onStart,
}: {
  readonly scoped: ScopedKanbanCard;
  readonly projectName: string | null;
  readonly threadStatus: KanbanCardThreadStatus | null;
  readonly isSelected: boolean;
  readonly onSelect: () => void;
  readonly onStart: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardDragId(scoped),
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <KanbanCardSurface
        scoped={scoped}
        projectName={projectName}
        threadStatus={threadStatus}
        isSelected={isSelected}
        onSelect={onSelect}
        onStart={onStart}
      />
    </div>
  );
}

function KanbanCardSurface({
  scoped,
  projectName,
  threadStatus,
  isSelected,
  onSelect,
  onStart,
}: {
  readonly scoped: ScopedKanbanCard;
  readonly projectName: string | null;
  readonly threadStatus: KanbanCardThreadStatus | null;
  readonly isSelected: boolean;
  readonly onSelect?: () => void;
  readonly onStart?: () => void;
}) {
  const { card, environmentId } = scoped;
  const attention = threadStatus ? attentionBadgePresentation(threadStatus.attention) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && onSelect) {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left shadow-2xs outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isSelected && "border-ring bg-accent/20",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge size="sm" variant={PRIORITY_BADGE_VARIANTS[card.priority]}>
            {PRIORITY_LABELS[card.priority]}
          </Badge>
          {projectName ? (
            <Badge size="sm" variant="outline">
              {projectName}
            </Badge>
          ) : null}
        </div>
        {attention ? (
          <Badge size="sm" variant={attention.variant}>
            {attention.label}
          </Badge>
        ) : null}
      </div>

      <div className="line-clamp-2 font-medium text-card-foreground text-sm leading-snug">
        {card.title}
      </div>

      {card.description.trim().length > 0 ? (
        <p className="line-clamp-2 text-muted-foreground text-xs leading-relaxed">
          {card.description.trim()}
        </p>
      ) : null}

      {card.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {card.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} size="sm" variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {card.threadId !== null ? (
            <div onClick={(event) => event.stopPropagation()}>
              <Button
                size="xs"
                variant="ghost"
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: card.threadId }}
                  />
                }
              >
                <MessageSquareIcon />
                <span>Thread</span>
              </Button>
            </div>
          ) : onStart &&
            card.archivedAt === null &&
            (card.column === "backlog" || card.column === "todo") ? (
            <div
              className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <Button size="xs" variant="outline" onClick={onStart}>
                <PlayIcon />
                <span>Start</span>
              </Button>
            </div>
          ) : null}
        </div>

        {threadStatus?.pullRequest ? (
          <div onClick={(event) => event.stopPropagation()}>
            <a
              href={threadStatus.pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            >
              {(() => {
                const PrIcon = PULL_REQUEST_STATE_PRESENTATION[threadStatus.pullRequest.state].Icon;
                return <PrIcon className="size-3" />;
              })()}
              <span>#{threadStatus.pullRequest.number}</span>
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}
