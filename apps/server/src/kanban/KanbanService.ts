import {
  CommandId,
  KanbanCard,
  KanbanCardId,
  KanbanColumn,
  KanbanError,
  KanbanLaunchPreset,
  KanbanPriority,
  KanbanTag,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProjectId,
  ThreadId,
  resolveBuiltinPluginEnabled,
  resolveProjectProviderInstanceEnabled,
  type KanbanArchiveDoneInput,
  type KanbanArchiveDoneResult,
  type KanbanCreateCardInput,
  type KanbanDeleteCardInput,
  type KanbanDeleteCardResult,
  type KanbanLinkThreadInput,
  type KanbanListInput,
  type KanbanListResult,
  type KanbanMoveCardInput,
  type KanbanMutationResult,
  type KanbanSetArchivedInput,
  type KanbanStartCardInput,
  type KanbanUpdateCardInput,
  type ModelSelection,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "../orchestration-v2/UserFacingErrors.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

interface KanbanCardRow {
  readonly card_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string;
  readonly column_key: string;
  readonly position: number;
  readonly priority: string;
  readonly tags_json: string;
  readonly launch_preset_json: string | null;
  readonly thread_id: string | null;
  readonly archived_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

const POSITION_STEP = 1024;
const MIN_POSITION_GAP = 1e-5;
const isKanbanError = Schema.is(KanbanError);

const TagsFromJson = Schema.fromJsonString(Schema.Array(KanbanTag));
const LaunchPresetFromJson = Schema.fromJsonString(KanbanLaunchPreset);
const decodeTagsJsonOption = Schema.decodeUnknownOption(TagsFromJson);
const encodeTagsJson = Schema.encodeSync(TagsFromJson);
const decodeLaunchPresetJsonOption = Schema.decodeUnknownOption(LaunchPresetFromJson);
const encodeLaunchPresetJson = Schema.encodeSync(LaunchPresetFromJson);
const decodeCard = Schema.decodeUnknownEffect(KanbanCard);

function buildCardPrompt(title: string, description: string, override?: string): string {
  const raw =
    override !== undefined
      ? override
      : description.trim().length > 0
        ? `# ${title}\n\n${description.trim()}`
        : title;
  return raw.slice(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
}

function normalizeTags(tags: ReadonlyArray<string> | undefined): ReadonlyArray<KanbanTag> {
  if (tags === undefined) return [];
  const seen = new Set<string>();
  const normalized: Array<KanbanTag> = [];
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(KanbanTag.make(trimmed));
  }
  return normalized;
}

const decodeRow = Effect.fnUntraced(function* (row: KanbanCardRow) {
  const tags = Option.getOrElse(
    decodeTagsJsonOption(row.tags_json),
    (): ReadonlyArray<KanbanTag> => [],
  );
  const launchPreset =
    row.launch_preset_json === null
      ? undefined
      : Option.getOrUndefined(decodeLaunchPresetJsonOption(row.launch_preset_json));
  return yield* decodeCard({
    id: row.card_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    column: row.column_key,
    position: row.position,
    priority: row.priority,
    tags,
    ...(launchPreset === undefined ? {} : { launchPreset }),
    threadId: row.thread_id,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

export class KanbanService extends Context.Service<
  KanbanService,
  {
    readonly list: (input?: KanbanListInput) => Effect.Effect<KanbanListResult, KanbanError>;
    readonly subscribe: () => Stream.Stream<KanbanListResult, KanbanError>;
    readonly getById: (id: KanbanCardId) => Effect.Effect<Option.Option<KanbanCard>, KanbanError>;
    readonly getByThreadId: (
      threadId: ThreadId,
    ) => Effect.Effect<ReadonlyArray<KanbanCard>, KanbanError>;
    readonly createCard: (
      input: KanbanCreateCardInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly updateCard: (
      input: KanbanUpdateCardInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly moveCard: (
      input: KanbanMoveCardInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly startCard: (
      input: KanbanStartCardInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly linkThread: (
      input: KanbanLinkThreadInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly setArchived: (
      input: KanbanSetArchivedInput,
    ) => Effect.Effect<KanbanMutationResult, KanbanError>;
    readonly archiveDone: (
      input?: KanbanArchiveDoneInput,
    ) => Effect.Effect<KanbanArchiveDoneResult, KanbanError>;
    readonly deleteCard: (
      input: KanbanDeleteCardInput,
    ) => Effect.Effect<KanbanDeleteCardResult, KanbanError>;
    readonly syncCardColumnFromLifecycle: (input: {
      readonly cardId: KanbanCardId;
      readonly expectedColumns: ReadonlyArray<KanbanColumn>;
      readonly targetColumn: KanbanColumn;
    }) => Effect.Effect<boolean, KanbanError>;
    readonly unlinkDeletedThread: (threadId: ThreadId) => Effect.Effect<void, KanbanError>;
  }
>()("t3/kanban/KanbanService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const projectService = yield* ProjectService.ProjectService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const gitDriver = yield* GitVcsDriver.GitVcsDriver;
  const threadLaunch = yield* ThreadLaunchService.ThreadLaunchService;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;

  const writeLock = yield* Semaphore.make(1);
  const changesPubSub = yield* PubSub.sliding<void>(1);
  const notifyChanged = PubSub.publish(changesPubSub, undefined).pipe(Effect.asVoid);

  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const persistenceError = (message: string, cause: unknown, cardId?: KanbanCardId) =>
    isKanbanError(cause)
      ? cause
      : new KanbanError({
          code: "persistence_error",
          message,
          ...(cardId === undefined ? {} : { cardId }),
          cause,
        });

  const requirePluginEnabled = Effect.fn("KanbanService.requirePluginEnabled")(function* (
    projectId: ProjectId,
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError((cause) =>
        persistenceError("Could not read server settings for Kanban plugin.", cause),
      ),
    );
    if (!resolveBuiltinPluginEnabled(settings, "kanban", projectId)) {
      return yield* new KanbanError({
        code: "plugin_disabled",
        message: "The Kanban plugin is disabled for this project.",
      });
    }
    return settings;
  });

  const requireProject = Effect.fn("KanbanService.requireProject")(function* (
    projectId: ProjectId,
  ) {
    const shell = yield* projectService
      .getShell(projectId)
      .pipe(Effect.mapError((cause) => persistenceError("Could not read project.", cause)));
    if (Option.isNone(shell)) {
      return yield* new KanbanError({
        code: "invalid_request",
        message: `Project ${projectId} was not found.`,
      });
    }
    return shell.value;
  });

  const decodeRows = Effect.fnUntraced(function* (rows: ReadonlyArray<KanbanCardRow>) {
    const cards: Array<KanbanCard> = [];
    for (const row of rows) {
      const decoded = yield* Effect.result(decodeRow(row));
      if (Result.isSuccess(decoded)) {
        cards.push(decoded.success);
      } else {
        yield* Effect.logWarning("Skipping undecodable kanban card row", {
          cardId: row.card_id,
          cause: decoded.failure,
        });
      }
    }
    return cards;
  });

  const readCardRow = (id: KanbanCardId) =>
    sql<KanbanCardRow>`SELECT * FROM kanban_cards WHERE card_id = ${id}`.pipe(
      Effect.mapError((cause) => persistenceError("Could not read kanban card.", cause, id)),
    );

  const requireCard = Effect.fn("KanbanService.requireCard")(function* (id: KanbanCardId) {
    const rows = yield* readCardRow(id);
    const row = rows[0];
    if (row === undefined) {
      return yield* new KanbanError({
        code: "not_found",
        message: "Kanban card was not found.",
        cardId: id,
      });
    }
    return yield* decodeRow(row).pipe(
      Effect.mapError((cause) => persistenceError("Could not decode kanban card.", cause, id)),
    );
  });

  const computeInsertPosition = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly column: KanbanColumn;
    readonly excludeCardId?: KanbanCardId;
    readonly beforeCardId?: KanbanCardId | null;
    readonly explicitPosition?: number;
  }) {
    if (input.explicitPosition !== undefined && input.beforeCardId === undefined) {
      return input.explicitPosition;
    }
    const siblings = (yield* sql<{ readonly card_id: string; readonly position: number }>`
      SELECT card_id, position
      FROM kanban_cards
      WHERE project_id = ${input.projectId}
        AND column_key = ${input.column}
        AND archived_at IS NULL
      ORDER BY position ASC, created_at ASC
    `).filter((row) => row.card_id !== input.excludeCardId);

    if (siblings.length === 0) return POSITION_STEP;
    if (input.beforeCardId === undefined || input.beforeCardId === null) {
      return (siblings.at(-1)?.position ?? 0) + POSITION_STEP;
    }
    const targetIndex = siblings.findIndex((row) => row.card_id === input.beforeCardId);
    if (targetIndex === -1) {
      return (siblings.at(-1)?.position ?? 0) + POSITION_STEP;
    }
    const targetPos = siblings[targetIndex]!.position;
    if (targetIndex === 0) {
      return targetPos - POSITION_STEP;
    }
    const prevPos = siblings[targetIndex - 1]!.position;
    const midpoint = (prevPos + targetPos) / 2;
    if (targetPos - prevPos < MIN_POSITION_GAP) {
      for (const [idx, sibling] of siblings.entries()) {
        const reindexed = (idx + 1) * POSITION_STEP;
        yield* sql`UPDATE kanban_cards SET position = ${reindexed} WHERE card_id = ${sibling.card_id}`;
      }
      return targetIndex * POSITION_STEP + POSITION_STEP / 2;
    }
    return midpoint;
  });

  const resolveLaunchConfiguration = Effect.fn("KanbanService.resolveLaunchConfiguration")(
    function* (card: KanbanCard) {
      const settings = yield* requirePluginEnabled(card.projectId);
      const project = yield* requireProject(card.projectId);
      const resolvedProject = resolveProjectSettings(settings, card.projectId).settings;
      const providers = yield* providerRegistry.getProviders;

      const preferredSelection: ModelSelection | null =
        card.launchPreset?.modelSelection ?? resolvedProject.defaultModelSelection ?? null;

      let modelSelection: ModelSelection | null = preferredSelection;
      if (modelSelection === null) {
        const candidateProvider =
          providers.find(
            (provider) =>
              provider.enabled &&
              provider.installed &&
              provider.availability !== "unavailable" &&
              resolveProjectProviderInstanceEnabled(
                settings,
                card.projectId,
                provider.instanceId,
              ) &&
              provider.models.length > 0,
          ) ??
          providers.find(
            (provider) =>
              resolveProjectProviderInstanceEnabled(
                settings,
                card.projectId,
                provider.instanceId,
              ) && provider.models.length > 0,
          );
        const defaultModel =
          candidateProvider?.models.find((model) => model.isDefault)?.slug ??
          candidateProvider?.models[0]?.slug;
        if (candidateProvider !== undefined && defaultModel !== undefined) {
          modelSelection = {
            instanceId: candidateProvider.instanceId,
            model: defaultModel,
          };
        }
      }
      if (modelSelection === null) {
        return yield* new KanbanError({
          code: "launch_failed",
          cardId: card.id,
          message: "No enabled provider with an available model was found for this project.",
        });
      }

      const workspaceMode =
        card.launchPreset?.workspaceMode ?? resolvedProject.defaultThreadEnvMode ?? "worktree";
      let workspaceStrategy: ThreadLaunchService.ThreadLaunchWorkspaceStrategy = { type: "root" };
      if (workspaceMode === "worktree" && project.workspaceRoot.trim().length > 0) {
        const refsResult = yield* gitDriver
          .listRefs({ cwd: project.workspaceRoot })
          .pipe(Effect.orElseSucceed(() => null));
        if (refsResult !== null && refsResult.isRepo) {
          const baseRef =
            refsResult.refs.find((ref) => ref.isDefault && !ref.isRemote)?.name ??
            refsResult.refs.find((ref) => ref.current)?.name ??
            "HEAD";
          workspaceStrategy = {
            type: "worktree",
            baseRef,
            startFromOrigin: resolvedProject.newWorktreesStartFromOrigin,
          };
        }
      }

      return {
        modelSelection,
        runtimeMode: resolvedProject.defaultRuntimeMode,
        workspaceStrategy,
      };
    },
  );

  const launchThreadForCard = Effect.fn("KanbanService.launchThreadForCard")(function* (input: {
    readonly card: KanbanCard;
    readonly promptOverride?: string;
    readonly createdBy: OrchestrationV2Actor;
    readonly creationSource: OrchestrationV2CreationSource;
  }) {
    const launchConfig = yield* resolveLaunchConfiguration(input.card);
    const key = yield* random.uuidV4();
    const commandId = CommandId.make(`kanban-launch:${input.card.id}:${key}`);
    const messageId = MessageId.make(`kanban-message:${input.card.id}:${key}`);
    const prompt = buildCardPrompt(input.card.title, input.card.description, input.promptOverride);

    const launched = yield* threadLaunch
      .launch({
        commandId,
        projectId: input.card.projectId,
        title: input.card.title,
        generateTitle: false,
        modelSelection: launchConfig.modelSelection,
        runtimeMode: launchConfig.runtimeMode,
        interactionMode: "default",
        workspaceStrategy: launchConfig.workspaceStrategy,
        initialMessage: {
          messageId,
          text: prompt,
          attachments: [],
        },
        createdBy: input.createdBy,
        creationSource: input.creationSource,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new KanbanError({
              code: "launch_failed",
              cardId: input.card.id,
              message:
                userFacingDispatchErrorMessage(cause) ??
                "Failed to launch an agent thread for this kanban card.",
              cause,
            }),
        ),
      );

    return launched.threadId;
  });

  const sendReworkToBoundThread = Effect.fn("KanbanService.sendReworkToBoundThread")(
    function* (input: {
      readonly card: KanbanCard;
      readonly threadId: ThreadId;
      readonly feedback: string;
      readonly createdBy: OrchestrationV2Actor;
      readonly creationSource: OrchestrationV2CreationSource;
    }) {
      const key = yield* random.uuidV4();
      const commandId = CommandId.make(`kanban-rework:${input.card.id}:${key}`);
      const messageId = MessageId.make(`kanban-rework-msg:${input.card.id}:${key}`);
      yield* threadManagement
        .sendToThread({
          projectId: input.card.projectId,
          commandId,
          threadId: input.threadId,
          messageId,
          text: input.feedback.slice(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS),
          attachments: [],
          mode: "queue",
          createdBy: input.createdBy,
          creationSource: input.creationSource,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new KanbanError({
                code: "launch_failed",
                cardId: input.card.id,
                message:
                  userFacingDispatchErrorMessage(cause) ??
                  "Failed to send rework instructions to the linked thread.",
                cause,
              }),
          ),
        );
    },
  );

  const validateThreadForProject = Effect.fn("KanbanService.validateThreadForProject")(function* (
    threadId: ThreadId,
    projectId: ProjectId,
    cardId?: KanbanCardId,
  ) {
    const shell = yield* threadManagement
      .getThreadShell(threadId)
      .pipe(
        Effect.mapError((cause) =>
          persistenceError("Could not read destination thread.", cause, cardId),
        ),
      );
    if (shell === null || shell.deletedAt !== null) {
      return yield* new KanbanError({
        code: "invalid_request",
        message: "The selected thread no longer exists.",
        ...(cardId === undefined ? {} : { cardId }),
      });
    }
    if (shell.projectId !== projectId) {
      return yield* new KanbanError({
        code: "invalid_request",
        message: "The selected thread belongs to a different project.",
        ...(cardId === undefined ? {} : { cardId }),
      });
    }
    return shell;
  });

  const list = Effect.fn("KanbanService.list")(function* (input: KanbanListInput = {}) {
    const includeArchived = input.includeArchived === true;
    const rows =
      input.projectId !== undefined
        ? includeArchived
          ? yield* sql<KanbanCardRow>`
              SELECT * FROM kanban_cards
              WHERE project_id = ${input.projectId}
              ORDER BY position ASC, created_at ASC
            `.pipe(
              Effect.mapError((cause) => persistenceError("Could not list kanban cards.", cause)),
            )
          : yield* sql<KanbanCardRow>`
              SELECT * FROM kanban_cards
              WHERE project_id = ${input.projectId} AND archived_at IS NULL
              ORDER BY position ASC, created_at ASC
            `.pipe(
              Effect.mapError((cause) => persistenceError("Could not list kanban cards.", cause)),
            )
        : includeArchived
          ? yield* sql<KanbanCardRow>`
              SELECT * FROM kanban_cards
              ORDER BY position ASC, created_at ASC
            `.pipe(
              Effect.mapError((cause) => persistenceError("Could not list kanban cards.", cause)),
            )
          : yield* sql<KanbanCardRow>`
              SELECT * FROM kanban_cards
              WHERE archived_at IS NULL
              ORDER BY position ASC, created_at ASC
            `.pipe(
              Effect.mapError((cause) => persistenceError("Could not list kanban cards.", cause)),
            );
    const cards = yield* decodeRows(rows);
    return { cards };
  });

  const subscribe: KanbanService["Service"]["subscribe"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changesPubSub);
        const fullList = () => list({ includeArchived: true });
        return Stream.concat(
          Stream.fromEffect(fullList()),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => fullList())),
        );
      }),
    );

  const getById = Effect.fn("KanbanService.getById")(function* (id: KanbanCardId) {
    const rows = yield* readCardRow(id);
    const row = rows[0];
    if (row === undefined) return Option.none<KanbanCard>();
    const card = yield* decodeRow(row).pipe(
      Effect.mapError((cause) => persistenceError("Could not decode kanban card.", cause, id)),
    );
    return Option.some(card);
  });

  const getByThreadId = Effect.fn("KanbanService.getByThreadId")(function* (threadId: ThreadId) {
    const rows = yield* sql<KanbanCardRow>`
      SELECT * FROM kanban_cards
      WHERE thread_id = ${threadId} AND archived_at IS NULL
      ORDER BY updated_at DESC
    `.pipe(
      Effect.mapError((cause) =>
        persistenceError("Could not query kanban cards by thread.", cause),
      ),
    );
    return yield* decodeRows(rows);
  });

  const createCard = Effect.fn("KanbanService.createCard")(function* (
    input: KanbanCreateCardInput,
  ) {
    yield* requirePluginEnabled(input.projectId);
    yield* requireProject(input.projectId);
    if (input.threadId !== undefined && input.threadId !== null) {
      yield* validateThreadForProject(input.threadId, input.projectId, input.id);
    }

    const id = input.id ?? KanbanCardId.make(yield* random.uuidV4());
    const column: KanbanColumn = input.column ?? "backlog";
    const priority: KanbanPriority = input.priority ?? "medium";
    const tags = normalizeTags(input.tags);
    const description = input.description ?? "";
    const createdAt = yield* nowIso;
    const tagsJson = encodeTagsJson(tags);
    const launchPresetJson =
      input.launchPreset === undefined ? null : encodeLaunchPresetJson(input.launchPreset);
    const initialThreadId = input.threadId ?? null;

    const inserted = yield* writeLock.withPermits(1)(
      sql
        .withTransaction(
          Effect.gen(function* () {
            const position = yield* computeInsertPosition({
              projectId: input.projectId,
              column,
            });
            yield* sql`
              INSERT INTO kanban_cards (
                card_id, project_id, title, description, column_key, position,
                priority, tags_json, launch_preset_json, thread_id, archived_at,
                created_at, updated_at
              ) VALUES (
                ${id}, ${input.projectId}, ${input.title}, ${description}, ${column}, ${position},
                ${priority}, ${tagsJson}, ${launchPresetJson}, ${initialThreadId}, NULL,
                ${createdAt}, ${createdAt}
              )
            `;
            return yield* requireCard(id);
          }),
        )
        .pipe(
          Effect.mapError((cause) => persistenceError("Could not create kanban card.", cause, id)),
        ),
    );

    yield* notifyChanged;

    if (column === "in_progress" && initialThreadId === null && input.autoStart !== false) {
      const launchedThreadId = yield* launchThreadForCard({
        card: inserted,
        createdBy: input.createdBy ?? "user",
        creationSource: input.creationSource ?? "web",
      });
      const updatedAt = yield* nowIso;
      const bound = yield* writeLock.withPermits(1)(
        Effect.gen(function* () {
          yield* sql`
            UPDATE kanban_cards
            SET thread_id = ${launchedThreadId}, updated_at = ${updatedAt}
            WHERE card_id = ${id}
          `.pipe(
            Effect.mapError((cause) =>
              persistenceError("Could not bind launched thread to kanban card.", cause, id),
            ),
          );
          return yield* requireCard(id);
        }),
      );
      yield* notifyChanged;
      return { card: bound, launchedThreadId };
    }

    return { card: inserted, launchedThreadId: null };
  });

  const updateCard = Effect.fn("KanbanService.updateCard")(function* (
    input: KanbanUpdateCardInput,
  ) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);

    const title = input.title ?? existing.title;
    const description = input.description ?? existing.description;
    const priority = input.priority ?? existing.priority;
    const tags = input.tags === undefined ? existing.tags : normalizeTags(input.tags);
    const launchPreset =
      input.launchPreset === undefined
        ? existing.launchPreset
        : input.launchPreset === null
          ? undefined
          : input.launchPreset;
    const tagsJson = encodeTagsJson(tags);
    const launchPresetJson =
      launchPreset === undefined ? null : encodeLaunchPresetJson(launchPreset);
    const updatedAt = yield* nowIso;

    const updated = yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        yield* sql`
          UPDATE kanban_cards
          SET title = ${title},
              description = ${description},
              priority = ${priority},
              tags_json = ${tagsJson},
              launch_preset_json = ${launchPresetJson},
              updated_at = ${updatedAt}
          WHERE card_id = ${input.id}
        `.pipe(
          Effect.mapError((cause) =>
            persistenceError("Could not update kanban card.", cause, input.id),
          ),
        );
        return yield* requireCard(input.id);
      }),
    );

    yield* notifyChanged;
    return { card: updated, launchedThreadId: null };
  });

  const moveCard = Effect.fn("KanbanService.moveCard")(function* (input: KanbanMoveCardInput) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);

    const updatedAt = yield* nowIso;
    const moved = yield* writeLock.withPermits(1)(
      sql
        .withTransaction(
          Effect.gen(function* () {
            const position = yield* computeInsertPosition({
              projectId: existing.projectId,
              column: input.column,
              excludeCardId: existing.id,
              ...(input.beforeCardId === undefined ? {} : { beforeCardId: input.beforeCardId }),
              ...(input.position === undefined ? {} : { explicitPosition: input.position }),
            });
            yield* sql`
              UPDATE kanban_cards
              SET column_key = ${input.column},
                  position = ${position},
                  archived_at = NULL,
                  updated_at = ${updatedAt}
              WHERE card_id = ${existing.id}
            `;
            return yield* requireCard(existing.id);
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            persistenceError("Could not move kanban card.", cause, existing.id),
          ),
        ),
    );

    yield* notifyChanged;

    const actor = input.createdBy ?? "user";
    const source = input.creationSource ?? "web";

    if (input.column === "in_progress") {
      if (moved.threadId === null && input.autoStart !== false) {
        const launchedThreadId = yield* launchThreadForCard({
          card: moved,
          createdBy: actor,
          creationSource: source,
        });
        const boundAt = yield* nowIso;
        const bound = yield* writeLock.withPermits(1)(
          Effect.gen(function* () {
            yield* sql`
              UPDATE kanban_cards
              SET thread_id = ${launchedThreadId}, updated_at = ${boundAt}
              WHERE card_id = ${moved.id}
            `.pipe(
              Effect.mapError((cause) =>
                persistenceError("Could not bind launched thread to kanban card.", cause, moved.id),
              ),
            );
            return yield* requireCard(moved.id);
          }),
        );
        yield* notifyChanged;
        return { card: bound, launchedThreadId };
      }

      if (
        moved.threadId !== null &&
        input.reworkFeedback !== undefined &&
        input.reworkFeedback.trim().length > 0
      ) {
        yield* sendReworkToBoundThread({
          card: moved,
          threadId: moved.threadId,
          feedback: input.reworkFeedback.trim(),
          createdBy: actor,
          creationSource: source,
        });
      }
    }

    return { card: moved, launchedThreadId: null };
  });

  const startCard = Effect.fn("KanbanService.startCard")(function* (input: KanbanStartCardInput) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);

    const actor = input.createdBy ?? "user";
    const source = input.creationSource ?? "web";

    if (existing.threadId !== null) {
      if (input.promptOverride !== undefined && input.promptOverride.trim().length > 0) {
        yield* sendReworkToBoundThread({
          card: existing,
          threadId: existing.threadId,
          feedback: input.promptOverride.trim(),
          createdBy: actor,
          creationSource: source,
        });
      }
      if (existing.column !== "in_progress" || existing.archivedAt !== null) {
        return yield* moveCard({
          id: existing.id,
          column: "in_progress",
          autoStart: false,
          createdBy: actor,
          creationSource: source,
        });
      }
      return { card: existing, launchedThreadId: null };
    }

    const launchedThreadId = yield* launchThreadForCard({
      card: existing,
      ...(input.promptOverride === undefined ? {} : { promptOverride: input.promptOverride }),
      createdBy: actor,
      creationSource: source,
    });
    const updatedAt = yield* nowIso;
    const updated = yield* writeLock.withPermits(1)(
      sql
        .withTransaction(
          Effect.gen(function* () {
            const position =
              existing.column === "in_progress" && existing.archivedAt === null
                ? existing.position
                : yield* computeInsertPosition({
                    projectId: existing.projectId,
                    column: "in_progress",
                    excludeCardId: existing.id,
                  });
            yield* sql`
              UPDATE kanban_cards
              SET column_key = 'in_progress',
                  position = ${position},
                  thread_id = ${launchedThreadId},
                  archived_at = NULL,
                  updated_at = ${updatedAt}
              WHERE card_id = ${existing.id}
            `;
            return yield* requireCard(existing.id);
          }),
        )
        .pipe(
          Effect.mapError((cause) =>
            persistenceError("Could not update started kanban card.", cause, existing.id),
          ),
        ),
    );

    yield* notifyChanged;
    return { card: updated, launchedThreadId };
  });

  const linkThread = Effect.fn("KanbanService.linkThread")(function* (
    input: KanbanLinkThreadInput,
  ) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);
    if (input.threadId !== null) {
      yield* validateThreadForProject(input.threadId, existing.projectId, existing.id);
    }
    const updatedAt = yield* nowIso;
    const updated = yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        yield* sql`
          UPDATE kanban_cards
          SET thread_id = ${input.threadId}, updated_at = ${updatedAt}
          WHERE card_id = ${existing.id}
        `.pipe(
          Effect.mapError((cause) =>
            persistenceError("Could not update thread link on kanban card.", cause, existing.id),
          ),
        );
        return yield* requireCard(existing.id);
      }),
    );
    yield* notifyChanged;
    return { card: updated, launchedThreadId: null };
  });

  const setArchived = Effect.fn("KanbanService.setArchived")(function* (
    input: KanbanSetArchivedInput,
  ) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);
    const updatedAt = yield* nowIso;
    const archivedAt = input.archived ? updatedAt : null;

    const updated = yield* writeLock.withPermits(1)(
      Effect.gen(function* () {
        yield* sql`
          UPDATE kanban_cards
          SET archived_at = ${archivedAt}, updated_at = ${updatedAt}
          WHERE card_id = ${existing.id}
        `.pipe(
          Effect.mapError((cause) =>
            persistenceError("Could not update archive state on kanban card.", cause, existing.id),
          ),
        );
        return yield* requireCard(existing.id);
      }),
    );
    yield* notifyChanged;
    return { card: updated, launchedThreadId: null };
  });

  const archiveDone = Effect.fn("KanbanService.archiveDone")(function* (
    input: KanbanArchiveDoneInput = {},
  ) {
    if (input.projectId !== undefined) {
      yield* requirePluginEnabled(input.projectId);
    }
    const updatedAt = yield* nowIso;
    const archivedRows = yield* writeLock.withPermits(1)(
      (input.projectId !== undefined
        ? sql<{ readonly card_id: string }>`
            UPDATE kanban_cards
            SET archived_at = ${updatedAt}, updated_at = ${updatedAt}
            WHERE project_id = ${input.projectId}
              AND column_key = 'done'
              AND archived_at IS NULL
            RETURNING card_id
          `
        : sql<{ readonly card_id: string }>`
            UPDATE kanban_cards
            SET archived_at = ${updatedAt}, updated_at = ${updatedAt}
            WHERE column_key = 'done'
              AND archived_at IS NULL
            RETURNING card_id
          `
      ).pipe(
        Effect.mapError((cause) => persistenceError("Could not archive done kanban cards.", cause)),
      ),
    );
    if (archivedRows.length > 0) {
      yield* notifyChanged;
    }
    return { archivedCount: archivedRows.length };
  });

  const deleteCard = Effect.fn("KanbanService.deleteCard")(function* (
    input: KanbanDeleteCardInput,
  ) {
    const existing = yield* requireCard(input.id);
    yield* requirePluginEnabled(existing.projectId);
    yield* writeLock.withPermits(1)(
      sql`DELETE FROM kanban_cards WHERE card_id = ${existing.id}`.pipe(
        Effect.mapError((cause) =>
          persistenceError("Could not delete kanban card.", cause, existing.id),
        ),
      ),
    );
    yield* notifyChanged;
    return { id: existing.id };
  });

  const syncCardColumnFromLifecycle = Effect.fn("KanbanService.syncCardColumnFromLifecycle")(
    function* (input: {
      readonly cardId: KanbanCardId;
      readonly expectedColumns: ReadonlyArray<KanbanColumn>;
      readonly targetColumn: KanbanColumn;
    }) {
      const cardOpt = yield* getById(input.cardId);
      if (Option.isNone(cardOpt)) return false;
      const card = cardOpt.value;
      if (card.archivedAt !== null || !input.expectedColumns.includes(card.column)) {
        return false;
      }
      const settings = yield* serverSettings.getSettings.pipe(Effect.orElseSucceed(() => null));
      if (settings !== null && !resolveBuiltinPluginEnabled(settings, "kanban", card.projectId)) {
        return false;
      }
      const updatedAt = yield* nowIso;
      const changed = yield* writeLock.withPermits(1)(
        sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* readCardRow(card.id);
              const current = rows[0];
              if (
                current === undefined ||
                current.archived_at !== null ||
                !input.expectedColumns.includes(current.column_key as KanbanColumn) ||
                current.column_key === input.targetColumn
              ) {
                return false;
              }
              const position = yield* computeInsertPosition({
                projectId: card.projectId,
                column: input.targetColumn,
                excludeCardId: card.id,
              });
              yield* sql`
                UPDATE kanban_cards
                SET column_key = ${input.targetColumn},
                    position = ${position},
                    updated_at = ${updatedAt}
                WHERE card_id = ${card.id}
              `;
              return true;
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              persistenceError("Could not sync kanban card lifecycle column.", cause, card.id),
            ),
          ),
      );
      if (changed) {
        yield* notifyChanged;
      }
      return changed;
    },
  );

  const unlinkDeletedThread = Effect.fn("KanbanService.unlinkDeletedThread")(function* (
    threadId: ThreadId,
  ) {
    const updatedAt = yield* nowIso;
    const rows = yield* writeLock.withPermits(1)(
      sql<{ readonly card_id: string }>`
        UPDATE kanban_cards
        SET thread_id = NULL, updated_at = ${updatedAt}
        WHERE thread_id = ${threadId}
        RETURNING card_id
      `.pipe(
        Effect.mapError((cause) =>
          persistenceError("Could not unlink deleted thread from kanban cards.", cause),
        ),
      ),
    );
    if (rows.length > 0) {
      yield* notifyChanged;
    }
  });

  return KanbanService.of({
    list,
    subscribe,
    getById,
    getByThreadId,
    createCard,
    updateCard,
    moveCard,
    startCard,
    linkThread,
    setArchived,
    archiveDone,
    deleteCard,
    syncCardColumnFromLifecycle,
    unlinkDeletedThread,
  });
});

export const layer = Layer.effect(KanbanService, make);
