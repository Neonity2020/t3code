import { useAtomValue } from "@effect/atom-react";
import {
  buildThreadToKanbanCardIndex,
  type ScopedKanbanCard,
} from "@t3tools/client-runtime/state/kanban";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type KanbanCard,
  type ProjectId,
  type ServerSettings,
  type ThreadId,
  resolveBuiltinPluginEnabled,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { useProjects, useServerConfigs } from "./entities";
import { environmentAtomList, environmentIdsKey } from "./environmentAtomList";
import { useConnectedEnvironmentIds } from "./environments";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

const EMPTY_KANBAN_CARDS: ReadonlyArray<KanbanCard> = Object.freeze([]);
const EMPTY_SCOPED_CARDS: ReadonlyArray<ScopedKanbanCard> = Object.freeze([]);

const environmentKanbanCardsAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const result = get(serverEnvironment.kanbanLive({ environmentId, input: {} }));
    return AsyncResult.isSuccess(result) ? result.value.cards : EMPTY_KANBAN_CARDS;
  }).pipe(Atom.withLabel(`web-environment-kanban-cards:${environmentId}`)),
);

const environmentKanbanCardListsAtom = environmentAtomList(
  "web-environment-kanban-card-lists",
  environmentKanbanCardsAtom,
);

const environmentThreadKanbanIndexAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    buildThreadToKanbanCardIndex(get(environmentKanbanCardsAtom(environmentId))),
  ).pipe(Atom.withLabel(`web-environment-kanban-thread-index:${environmentId}`)),
);

const EMPTY_THREAD_INDEX_ATOM = Atom.make<ReadonlyMap<ThreadId, KanbanCard>>(new Map()).pipe(
  Atom.withLabel("web-kanban-thread-index:empty"),
);

export function useScopedKanbanCards(): ReadonlyArray<ScopedKanbanCard> {
  const connectedIds = useConnectedEnvironmentIds();
  const key = environmentIdsKey(connectedIds);
  const lists = useAtomValue(environmentKanbanCardListsAtom(key));
  if (connectedIds.length === 0) return EMPTY_SCOPED_CARDS;

  const scoped: Array<ScopedKanbanCard> = [];
  for (let i = 0; i < connectedIds.length; i++) {
    const environmentId = connectedIds[i]!;
    const cards = lists[i] ?? EMPTY_KANBAN_CARDS;
    for (const card of cards) {
      scoped.push({ environmentId, card });
    }
  }
  return scoped;
}

export function useSettingsByEnvironment(): ReadonlyMap<EnvironmentId, ServerSettings> {
  const serverConfigs = useServerConfigs();
  const map = new Map<EnvironmentId, ServerSettings>();
  for (const [environmentId, config] of serverConfigs.entries()) {
    if (config !== null) {
      map.set(environmentId, config.settings);
    }
  }
  return map;
}

export function useKanbanSupported(): boolean {
  const connectedIds = useConnectedEnvironmentIds();
  const projects = useProjects();
  const settingsByEnvironment = useSettingsByEnvironment();

  if (connectedIds.length === 0) return false;
  for (const project of projects) {
    if (project.isScratch || project.archivedAt != null) continue;
    const settings = settingsByEnvironment.get(project.environmentId) ?? DEFAULT_SERVER_SETTINGS;
    if (resolveBuiltinPluginEnabled(settings, "kanban", project.id)) {
      return true;
    }
  }
  for (const environmentId of connectedIds) {
    const settings = settingsByEnvironment.get(environmentId) ?? DEFAULT_SERVER_SETTINGS;
    if (resolveBuiltinPluginEnabled(settings, "kanban", null)) {
      return true;
    }
  }
  return false;
}

function useProjectKanbanEnabled(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
): boolean {
  const settingsByEnvironment = useSettingsByEnvironment();
  if (environmentId === null) return false;
  const settings = settingsByEnvironment.get(environmentId) ?? DEFAULT_SERVER_SETTINGS;
  return resolveBuiltinPluginEnabled(settings, "kanban", projectId);
}

export function useThreadKanbanCard(
  environmentId: EnvironmentId | null,
  projectId: ProjectId | null,
  threadId: ThreadId | null,
): KanbanCard | null {
  const enabled = useProjectKanbanEnabled(environmentId, projectId);
  const index = useAtomValue(
    enabled && environmentId !== null
      ? environmentThreadKanbanIndexAtom(environmentId)
      : EMPTY_THREAD_INDEX_ATOM,
  );
  if (!enabled || threadId === null) return null;
  return index.get(threadId) ?? null;
}

export function useKanbanMutations() {
  const createCard = useAtomCommand(serverEnvironment.createKanbanCard);
  const updateCard = useAtomCommand(serverEnvironment.updateKanbanCard);
  const moveCard = useAtomCommand(serverEnvironment.moveKanbanCard);
  const startCard = useAtomCommand(serverEnvironment.startKanbanCard);
  const linkThread = useAtomCommand(serverEnvironment.linkKanbanThread);
  const setArchived = useAtomCommand(serverEnvironment.setKanbanCardArchived);
  const archiveDone = useAtomCommand(serverEnvironment.archiveDoneKanbanCards);
  const deleteCard = useAtomCommand(serverEnvironment.deleteKanbanCard);

  return {
    createCard,
    updateCard,
    moveCard,
    startCard,
    linkThread,
    setArchived,
    archiveDone,
    deleteCard,
  };
}
