import { BugIcon, FolderSearchIcon, PlayIcon, ScanEyeIcon } from "lucide-react";
import { useGT } from "gt-react";

import {
  composerDraftHasUserContent,
  useComposerDraftStore,
  type DraftId,
} from "~/composerDraftStore";
import { Button } from "../ui/button";

export function DraftThreadSuggestions({
  draftId,
  disabled,
  onSelect,
}: {
  draftId: DraftId;
  disabled: boolean;
  onSelect: (prompt: string) => void;
}) {
  const gt = useGT();
  const hasContent = useComposerDraftStore((store) => {
    const draft = store.getComposerDraft(draftId);
    return draft ? composerDraftHasUserContent(draft) : false;
  });
  if (hasContent) return null;

  const suggestions = [
    {
      label: gt("Scan project"),
      icon: FolderSearchIcon,
      prompt: gt(
        "Explore this project and summarize its purpose, architecture, key entry points, and development and test commands. Read the project instructions first. Do not modify any files.",
      ),
    },
    {
      label: gt("Continue work"),
      icon: PlayIcon,
      prompt: gt(
        "Help me continue work on this project. Read the project instructions, check Git status, recent commits, and any existing task notes, then summarize unfinished work and suggest the next step. Ask me for the goal if it is unclear.",
      ),
    },
    {
      label: gt("Review code"),
      icon: ScanEyeIcon,
      prompt: gt(
        "Review the current uncommitted changes for bugs, regressions, and missing tests. Read the project instructions first and report concrete findings with file references. If there are no changes, ask me what to review. Do not modify any files.",
      ),
    },
    {
      label: gt("Run tests"),
      icon: BugIcon,
      prompt: gt(
        "Read the project instructions and find the appropriate checks for the current changes. Run focused tests, summarize the results, and explain any failures. If there are no changes, identify the available test commands and ask me which area to test.",
      ),
    },
  ];

  return (
    <div
      role="group"
      aria-label={gt("Suggested tasks")}
      className="flex flex-wrap justify-center gap-2"
    >
      {suggestions.map(({ label, icon: Icon, prompt }) => (
        <Button
          key={label}
          variant="outline"
          size="sm-pill"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
        >
          <Icon data-icon="inline-start" />
          {label}
        </Button>
      ))}
    </div>
  );
}
