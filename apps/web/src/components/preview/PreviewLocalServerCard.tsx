import { BrowserMockup } from "./BrowserMockup";
import type { PreviewableServer } from "./useDiscoveredLocalServers";
import { useTranslation } from "~/hooks/useLanguage";

interface Props {
  server: PreviewableServer;
  onOpen: () => void;
}

export function PreviewLocalServerCard({ server, onOpen }: Props) {
  const { t } = useTranslation();
  const subtitle = describeServer(server, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <BrowserMockup className="size-7 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-foreground">{subtitle}</span>
        <span className="truncate text-xs text-muted-foreground">
          {server.host}:{server.port}
        </span>
      </div>
      {server.listening ? (
        <PulsingDot label={t("listening")} />
      ) : (
        <DimDot label={t("notListening")} />
      )}
    </button>
  );
}

function describeServer(
  server: PreviewableServer,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (server.processName) return server.processName;
  if (server.listening) return t("listening");
  if (server.source === "configured") return t("configured");
  return t("recentlySeen");
}

function PulsingDot({ label }: { label: string }) {
  return (
    <span aria-label={label} className="relative inline-flex size-2 shrink-0">
      <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-success" />
    </span>
  );
}

function DimDot({ label }: { label: string }) {
  return (
    <span aria-label={label} className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
  );
}
