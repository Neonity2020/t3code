import type { ServerProvider, ServerProviderVersionAdvisory } from "@t3tools/contracts";
import type { TranslationKey } from "../../hooks/useLanguage";

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

/**
 * Visual treatment for each server-reported provider status. Centralized so
 * the default-driver card and per-instance cards share the same language.
 */
export const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

export type ProviderStatusKey = keyof typeof PROVIDER_STATUS_STYLES;

/**
 * Derive the headline + detail copy shown under a provider's name in the
 * settings page. Prefers `provider.message` for server-supplied detail and
 * falls back to generic phrasing when the server has not yet reported any
 * state — which happens before the first probe or when an instance names a
 * driver this build does not ship.
 */
export function getProviderSummary(provider: ServerProvider | undefined, t: Translate) {
  if (!provider) {
    return {
      headline: t("checkingProviderStatus"),
      detail: t("waitingProviderStatus"),
    };
  }
  if (!provider.enabled) {
    return {
      headline: t("disabled"),
      detail: provider.message ?? t("providerDisabledDescription"),
    };
  }
  if (!provider.installed) {
    return {
      headline: t("notFound"),
      detail: provider.message ?? t("cliNotDetected"),
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? t("authenticatedWithLabel", { label: authLabel }) : t("authenticated"),
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: t("notAuthenticated"),
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: t("needsAttention"),
      detail: provider.message ?? t("providerWarningDescription"),
    };
  }
  if (provider.status === "error") {
    return {
      headline: t("unavailable"),
      detail: provider.message ?? t("providerUnavailableDescription"),
    };
  }
  return {
    headline: t("available"),
    detail: provider.message ?? t("providerAvailableDescription"),
  };
}

/**
 * Normalize a version string for display. Adds the `v` prefix when the
 * driver reported a bare version (e.g. `1.2.3`) so cards render
 * consistently regardless of driver.
 */
export function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

export function getProviderVersionAdvisoryPresentation(
  advisory: ServerProviderVersionAdvisory | undefined,
  t: Translate,
): {
  readonly detail: string;
  readonly updateCommand: string | null;
  readonly emphasis: "normal" | "strong";
} | null {
  if (!advisory || advisory.status === "current" || advisory.status === "unknown") {
    return null;
  }

  const version = advisory.latestVersion;
  const versionLabel = getProviderVersionLabel(version);

  return {
    detail:
      advisory.message ??
      (versionLabel
        ? t("updateAvailableVersion", { version: versionLabel })
        : t("updateAvailableLatest")),
    updateCommand: advisory.updateCommand,
    emphasis: "normal" as const,
  };
}
