import { assert, it } from "@effect/vitest";

import { takePiRpcRecords } from "./PiAgentAdapter.ts";

it("splits Pi RPC transport strictly on LF while retaining an incomplete record", () => {
  const result = takePiRpcRecords(
    '{"type":"message_update","text":"a\\u2028b"}\r\n{"type":"agent_end"}\n{"type":"partial"',
  );

  assert.deepStrictEqual(result.records, [
    '{"type":"message_update","text":"a\\u2028b"}',
    '{"type":"agent_end"}',
  ]);
  assert.equal(result.remainder, '{"type":"partial"');
});
