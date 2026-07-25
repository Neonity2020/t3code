import type { ContextMenuItem } from "@t3tools/contracts";

export type ExternalLinkContextMenuAction = "open-in-preview" | "open-external" | "copy-link";

export type ExternalLinkContextMenuFailureOperation =
  | "show-link-context-menu"
  | "open-link-in-preview"
  | "open-link-external"
  | "copy-link";

const FAILURE_OPERATION_BY_ACTION = {
  "open-in-preview": "open-link-in-preview",
  "open-external": "open-link-external",
  "copy-link": "copy-link",
} as const satisfies Record<ExternalLinkContextMenuAction, ExternalLinkContextMenuFailureOperation>;

export interface ExternalLinkContextMenuLabels {
  readonly openInPreview: string;
  readonly openExternal: string;
  readonly copyLink: string;
}

interface ShowExternalLinkContextMenuOptions {
  readonly href: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly labels: ExternalLinkContextMenuLabels;
  readonly showContextMenu: (
    items: readonly ContextMenuItem<ExternalLinkContextMenuAction>[],
    position: { readonly x: number; readonly y: number },
  ) => Promise<ExternalLinkContextMenuAction | null>;
  readonly openInPreview: (href: string) => Promise<void>;
  readonly openExternal: (href: string) => Promise<void>;
  readonly copyLink: (href: string) => Promise<unknown>;
  readonly reportFailure: (
    operation: ExternalLinkContextMenuFailureOperation,
    cause: unknown,
  ) => void;
}

export function resolveExternalWebLinkHost(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname || null;
  } catch {
    return null;
  }
}

export async function showExternalLinkContextMenu({
  href,
  position,
  labels,
  showContextMenu,
  openInPreview,
  openExternal,
  copyLink,
  reportFailure,
}: ShowExternalLinkContextMenuOptions): Promise<void> {
  const items: readonly ContextMenuItem<ExternalLinkContextMenuAction>[] = [
    { id: "open-in-preview", label: labels.openInPreview },
    { id: "open-external", label: labels.openExternal },
    { id: "copy-link", label: labels.copyLink },
  ];
  let action: ExternalLinkContextMenuAction | null;
  try {
    action = await showContextMenu(items, position);
  } catch (cause) {
    reportFailure("show-link-context-menu", cause);
    return;
  }

  try {
    if (action === "open-in-preview") {
      await openInPreview(href);
    } else if (action === "open-external") {
      await openExternal(href);
    } else if (action === "copy-link") {
      await copyLink(href);
    }
  } catch (cause) {
    if (action) reportFailure(FAILURE_OPERATION_BY_ACTION[action], cause);
  }
}
