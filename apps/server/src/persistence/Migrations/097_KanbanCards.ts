import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS kanban_cards (
      card_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      column_key TEXT NOT NULL,
      position REAL NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      tags_json TEXT NOT NULL DEFAULT '[]',
      launch_preset_json TEXT,
      thread_id TEXT,
      archived_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_cards_project_column_position
      ON kanban_cards(project_id, archived_at, column_key, position)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_kanban_cards_thread_id
      ON kanban_cards(thread_id)
      WHERE thread_id IS NOT NULL
  `;
});
