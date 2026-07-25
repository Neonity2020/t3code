import { assert, it } from "@effect/vitest";

import { piModelsFromRpcResponse } from "./PiAgentProvider.ts";

it("qualifies Pi RPC model ids with their provider for composer selection", () => {
  const models = piModelsFromRpcResponse({
    data: {
      models: [
        { provider: "minimax", id: "MiniMax-M3", name: "MiniMax M3" },
        { provider: "minimax-cn", id: "MiniMax-M3", name: "MiniMax-M3" },
      ],
    },
  });

  assert.deepStrictEqual(
    models.map((model) => ({ slug: model.slug, name: model.name })),
    [
      { slug: "minimax/MiniMax-M3", name: "MiniMax M3 (minimax)" },
      { slug: "minimax-cn/MiniMax-M3", name: "MiniMax-M3 (minimax-cn)" },
    ],
  );
});
