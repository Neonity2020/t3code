import i18next from "~/i18n";

import type { ClientSettingsPatch, DesktopSnapShotState, SnapShotSound } from "@t3tools/contracts";
import {
  captureSetupBackend,
  captureSetupDesktopName,
  captureSetupAccessReady,
  captureSetupMacPermissionsReady,
} from "./SnapShotSetupDialog.logic";

const t = (key: string, options?: Record<string, unknown>): string =>
  options === undefined
    ? i18next.t(`snapshot.logic.${key}`)
    : i18next.t(`snapshot.logic.${key}`, options);

export function snapShotStatus(state: DesktopSnapShotState | null, enabled: boolean): string {
  if (!state) return t("checking");
  if (state.mode === "unavailable") return state.message ?? t("notSupported");
  if (!enabled) return t("turnOnFirst");
  return snapShotSetupSummary(state, enabled);
}

export function snapShotSetupSummary(state: DesktopSnapShotState, enabled: boolean): string {
  if (state.message) return t("needsAttention");
  if (state.linuxBackend === "hyprland" && state.hyprlandHelper?.status !== "ready")
    return state.hyprlandHelper?.status === "error" ? t("checkAccessInSetup") : t("installHelper");
  if (captureSetupBackend(state) === "gnome" && state.gnomeExtension?.status !== "enabled")
    return t("setUpActiveWindow");
  if (captureSetupBackend(state) === "kde" && state.kdeHelper?.status !== "ready")
    return state.kdeHelper?.status === "error" ? t("checkAccessInSetup") : t("installHelper");
  if (captureSetupBackend(state) === "picker") return t("manualCaptureOnly");
  if (!enabled) return t("enableCapture");
  if (state.shortcutPending)
    return state.linuxBackend === "hyprland"
      ? t("connectingShortcut")
      : t("waitingShortcutPermission");
  if (state.shortcutVerified) return t("readyToCapture");
  if (state.linuxBackend === "niri" && state.shortcutBinding) return t("useShortcutElsewhere");
  if (state.linuxBackend === "hyprland" && state.shortcutActionRegistered)
    return t("useShortcutElsewhere");
  if (state.shortcutRegistered)
    return state.shortcutLabel ? t("readyToCapture") : t("shortcutSaved");
  return t("finishShortcutSetup");
}

export function snapShotShortcutStatus(state: DesktopSnapShotState | null): string | null {
  if (!state) return null;
  if (state.linuxBackend === "hyprland") return state.shortcutMessage;
  if (state.shortcutPending) return t("approveShortcutPrompt");
  if (state.shortcutRegistered) return state.mode === "portal" ? null : t("shortcutSavedSentence");
  return state.shortcutMessage;
}

export function snapShotSetupButtonLabel(state: DesktopSnapShotState | null): string {
  if (!state) return t("continueSetup");
  if (captureSetupAccessReady(state)) return t("manageCapture");
  const desktop = captureSetupDesktopName(state);
  return desktop ? t("setUpDesktopCapture", { desktop }) : t("continueSetup");
}

export function snapShotSetupComplete(
  state: DesktopSnapShotState | null,
  includeAccessibility: boolean,
): boolean {
  if (state?.windows) return true;
  return (
    state?.macPermissions !== undefined &&
    captureSetupAccessReady(state) &&
    captureSetupMacPermissionsReady(state, includeAccessibility) &&
    state.shortcutRegistered
  );
}

export type SnapShotSoundSelection = SnapShotSound | "off";

export function snapShotFeedbackUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal" || state.linuxFeedbackAvailable) return undefined;
  if (state.linuxBackend === "hyprland")
    return state.hyprlandHelper?.status === "ready"
      ? t("effectsUnavailableDesktop")
      : t("installHelperForEffects");
  if (state.linuxBackend === "niri") return t("effectsUnavailableNiri");
  if (state.linuxBackend === "kde")
    return state.kdeHelper?.status === "ready"
      ? t("effectsUnavailableDesktop")
      : t("installHelperForEffects");
  return state.linuxBackend === "gnome-extension"
    ? t("updateGnomeExtension")
    : captureSetupBackend(state) === "gnome"
      ? t("finishExtensionSetup")
      : t("effectsUnavailableDesktop");
}

export function snapShotDescription(state: DesktopSnapShotState | null): string {
  return state?.mode === "portal" && captureSetupBackend(state) === "picker"
    ? t("pickerDescription")
    : t("description");
}

export function snapShotAccessibilityUnavailableMessage(
  state: DesktopSnapShotState | null,
): string | undefined {
  if (state?.mode !== "portal") return undefined;
  if (state.linuxBackend === "picker" || state.linuxBackend === "screenshot-portal")
    return t("screenshotOnly");
  return undefined;
}

export function snapShotUnavailableMessage(hasBridge: boolean): string | undefined {
  if (hasBridge) return undefined;
  return typeof window !== "undefined" && window.desktopBridge
    ? t("updateDesktopApp")
    : t("desktopOnly");
}

export function snapShotSoundPatch(sound: SnapShotSoundSelection): ClientSettingsPatch {
  return sound === "off"
    ? { snapShotPlaySound: false }
    : { snapShotPlaySound: true, snapShotSound: sound };
}

export function createRecordingRequestTracker() {
  let currentRequest: symbol | null = null;

  return {
    tryBegin() {
      if (currentRequest) return null;
      currentRequest = Symbol();
      return currentRequest;
    },
    clear() {
      currentRequest = null;
    },
    owns(request: symbol) {
      return currentRequest === request;
    },
  };
}
