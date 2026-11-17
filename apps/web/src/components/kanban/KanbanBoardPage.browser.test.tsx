import { createMemoryHistory } from "@tanstack/react-router";
import {
  KanbanCardId,
  WS_METHODS,
  type KanbanCard,
  type KanbanCreateCardInput,
  type KanbanLinkThreadInput,
  type KanbanListResult,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import "~/components/kanban/KanbanBoardPage";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  PROJECT_ID,
  answerRpc,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../../test/fakeEnvironment";
import { render } from "../../../test/render";

vi.mock(
  "../../../../../packages/client-runtime/src/connection/driver.ts",
  async (importOriginal) => {
    const [actual, { fakeDriver }, Layer] = await Promise.all([
      importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
      import("../../../test/fakeEnvironment"),
      import("effect/Layer"),
    ]);
    return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
  },
);

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

it("creates a card on /kanban, links a project thread, and navigates bidirectionally via ThreadKanbanPill", async () => {
  await page.viewport(1400, 900);
  const existingThread = threadWithHistory("kanban-linked-thread", 1);
  using _environment = installFakeEnvironment([existingThread]);

  let cards: KanbanCard[] = [];
  const subscribers = new Set<Queue.Queue<KanbanListResult>>();
  const pushSnapshot = () => {
    for (const queue of subscribers) {
      Queue.offerUnsafe(queue, { cards: [...cards] });
    }
  };

  using _sub = answerRpc(WS_METHODS.kanbanSubscribe, () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<KanbanListResult>();
        yield* Queue.offer(queue, { cards: [...cards] });
        subscribers.add(queue);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            subscribers.delete(queue);
          }),
        );
        return Stream.fromQueue(queue);
      }),
    ),
  );

  using _create = answerRpc(WS_METHODS.kanbanCreateCard, (input: KanbanCreateCardInput) =>
    Effect.sync(() => {
      const card: KanbanCard = {
        id: KanbanCardId.make("card-e2e-1"),
        projectId: PROJECT_ID,
        title: input.title,
        description: (input.description ?? "") as KanbanCard["description"],
        column: input.column ?? "backlog",
        position: 1024,
        priority: input.priority ?? "medium",
        tags: input.tags ? [...input.tags] : [],
        threadId: null,
        archivedAt: null,
        createdAt: "2026-11-17T00:00:00.000Z",
        updatedAt: "2026-11-17T00:00:00.000Z",
      };
      cards = [...cards, card];
      pushSnapshot();
      return { card, launchedThreadId: null };
    }),
  );

  using _link = answerRpc(WS_METHODS.kanbanLinkThread, (input: KanbanLinkThreadInput) =>
    Effect.sync(() => {
      const target = cards.find((c) => c.id === input.id)!;
      const updated: KanbanCard = { ...target, threadId: input.threadId };
      cards = cards.map((c) => (c.id === input.id ? updated : c));
      pushSnapshot();
      return { card: updated, launchedThreadId: null };
    }),
  );

  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });

  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${existingThread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });

  // 1. Click sidebar Kanban utility button -> navigates to /kanban
  const kanbanNavButton = page.getByRole("button", { name: "Kanban", exact: true });
  await expect.element(kanbanNavButton).toBeVisible();
  await userEvent.click(kanbanNavButton);
  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/kanban"));

  // 2. Verify all 5 columns render and create a card via New card dialog
  await expect.element(page.getByText("In Progress", { exact: true })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "New card" }));
  await userEvent.type(page.getByLabelText("Title"), "Verify Kanban E2E");
  await userEvent.click(page.getByRole("button", { name: "Create card" }));

  // 3. Card renders on board -> click to open detail sheet and link existing thread
  const cardHeading = page.getByText("Verify Kanban E2E", { exact: true });
  await expect.element(cardHeading).toBeVisible();
  await userEvent.click(cardHeading);

  await userEvent.click(page.getByText("Link existing thread..."));
  await userEvent.click(page.getByRole("option", { name: existingThread.title }));
  await userEvent.click(page.getByRole("button", { name: "Link", exact: true }));

  // 4. Open linked thread -> verify ThreadKanbanPill renders in ChatHeader -> jump back to board
  const openThreadLink = page.getByRole("link", { name: "Open thread" });
  await expect.element(openThreadLink).toBeVisible();
  await userEvent.click(openThreadLink);
  await vi.waitFor(() =>
    expect(router.state.location.pathname).toBe(`/${ENVIRONMENT_ID}/${existingThread.id}`),
  );

  const headerPill = page.getByRole("button", { name: /Backlog:\s*Verify Kanban E2E/ });
  await expect.element(headerPill).toBeVisible();
  await userEvent.click(headerPill);
  await userEvent.click(page.getByRole("menuitem", { name: "Open on Kanban board" }));

  await vi.waitFor(() => expect(router.state.location.pathname).toBe("/kanban"));
  expect(router.state.location.search).toMatchObject({ cardId: "card-e2e-1" });
});
