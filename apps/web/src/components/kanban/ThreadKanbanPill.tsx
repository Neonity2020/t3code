import {
  KANBAN_COLUMNS,
  type EnvironmentId,
  type KanbanColumn,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { CheckIcon, Columns3Icon } from "lucide-react";

import { cn } from "~/lib/utils";
import { useKanbanMutations, useThreadKanbanCard } from "~/state/kanban";
import { Badge } from "../ui/badge";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { COLUMN_DOT_CLASSES, COLUMN_LABELS } from "./kanbanPresentation";

export function ThreadKanbanPill({
  environmentId,
  projectId,
  threadId,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly threadId: ThreadId | null;
}) {
  const card = useThreadKanbanCard(environmentId, projectId, threadId);
  const { moveCard } = useKanbanMutations();

  if (!card || environmentId === null) return null;

  const handleMove = (column: KanbanColumn) => {
    if (column === card.column) return;
    void moveCard({
      environmentId,
      input: {
        id: card.id,
        column,
        autoStart: false,
      },
    });
  };

  return (
    <Menu>
      <MenuTrigger
        render={<Badge variant="outline" size="control" render={<button type="button" />} />}
      >
        <span className={cn("size-2 shrink-0 rounded-full", COLUMN_DOT_CLASSES[card.column])} />
        <span className="text-muted-foreground">{COLUMN_LABELS[card.column]}:</span>
        <span className="max-w-36 truncate">{card.title}</span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem
          render={
            <Link
              to="/kanban"
              search={{
                environmentId,
                projectId: card.projectId,
                cardId: card.id,
              }}
            />
          }
        >
          <Columns3Icon />
          <span>Open on Kanban board</span>
        </MenuItem>
        <MenuSeparator />
        {KANBAN_COLUMNS.map((col) => (
          <MenuItem key={col} onClick={() => handleMove(col)}>
            {col === card.column ? <CheckIcon /> : <span className="size-4" />}
            <span>Move to {COLUMN_LABELS[col]}</span>
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
