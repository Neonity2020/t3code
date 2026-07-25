# Pi Agent RPC Integration Notes

This note records the upstream protocol surface required for a T3 Code Pi Agent provider.
It is based on Pi's RPC-mode documentation, not its interactive terminal output.

## Launch and transport

Start one local process per T3 Code provider session:

```bash
pi --mode rpc
```

Pass configured model selection at launch with `--provider <name>` and
`--model <pattern>`; use `--session-dir <path>` to isolate Pi's persisted
sessions, or `--no-session` for an ephemeral process.

The transport is strict JSONL over stdin/stdout:

- send one JSON object plus LF on stdin;
- parse stdout by LF only, accepting a trailing CR for CRLF input;
- do not use Node's `readline`, because it also splits valid Unicode JSON
  characters;
- reserve stdout exclusively for RPC records and treat stderr as diagnostics.

Every command may carry an `id`; Pi copies it only to the matching
`type: "response"` record. Streaming events have no originating command id, so
the T3 Code runtime must keep at most one active Pi prompt per process.

## Required command mapping

| T3 Code operation              | Pi RPC command                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------ |
| Begin/send a turn              | `{"id":"…","type":"prompt","message":"…"}`                                     |
| Send while streaming           | prompt with `"streamingBehavior":"steer"`, or `{"type":"steer","message":"…"}` |
| Queue after completion         | `{"type":"follow_up","message":"…"}`                                           |
| Interrupt/stop                 | `{"id":"…","type":"abort"}`                                                    |
| Start a new local Pi session   | `{"type":"new_session"}`                                                       |
| Restore an existing Pi session | `{"type":"switch_session","sessionPath":"…"}`                                  |
| Discover models                | `{"id":"…","type":"get_available_models"}`                                     |
| Select a model                 | `{"id":"…","type":"set_model","provider":"…","modelId":"…"}`                   |

A successful `prompt` response only means Pi accepted or queued it. Final
completion is the later `agent_end` event. Rejections use
`{"type":"response","success":false,"error":"…"}`.

## Events to translate

The provider adapter should preserve Pi's event order and map the following
events to T3 Code conversation updates:

- `agent_start` / `agent_end`: run lifecycle; `agent_end.messages` contains
  the generated messages and is the terminal event for a run.
- `message_update.assistantMessageEvent.type === "text_delta"`: append
  `delta` to the active assistant text.
- `thinking_delta`: emit or retain reasoning only if the T3 Code event model
  supports it.
- `toolcall_*`: create/update the tool call using the supplied call ID and
  accumulated arguments.
- `tool_execution_start`, `tool_execution_update`, and
  `tool_execution_end`: render tool progress/result. The update's
  `partialResult` is the complete accumulated result, not a delta.
- `turn_end`: contains the completed assistant message plus tool results.
- `queue_update`, compaction, retry, and extension errors: surface as status
  events where supported; do not treat them as final output.

For cancellation, send `abort` and keep reading until Pi publishes the
corresponding `message_update` error/aborted result and `agent_end`; only
terminate the child process as a last-resort cleanup.

## Session and UI caveats

- `get_state` reports `sessionFile`, `sessionId`, streaming state, model,
  and queued-message counts. Persist the returned `sessionFile` when T3 Code
  needs to resume Pi's own transcript.
- Prompt commands support base64 image input, but the first provider slice can
  safely restrict to text until attachment translation is implemented.
- Pi extensions may emit `extension_ui_request` records and block awaiting
  `extension_ui_response`. A complete integration needs a response bridge;
  otherwise it should respond with a cancellation/error rather than deadlock.
- Pi's non-interactive modes do not display a trust prompt. The provider setup
  should make the working directory, project trust, and tool-execution
  consequences explicit to the user.

## Primary sources

- Pi RPC mode documentation:
  <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/rpc.md>
- Versioned package copy consulted for the protocol examples and event schema:
  <https://unpkg.com/@mariozechner/pi-coding-agent@0.68.0/docs/rpc.md>
- Pi coding-agent README (installation, CLI modes, and model/session flags):
  <https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md>
