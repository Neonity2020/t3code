import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  hasDesktopNotifications,
  hasNotificationSound,
  notificationModeLabels,
  unlockNotificationAudio,
} from "../../threadNotifications";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function NotificationSettings() {
  const { t } = useTranslation();
  const mode = useScopedSettings((settings) => settings.notificationMode);
  const updateSettings = useUpdateScopedSettings();
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  return (
    <SettingsRow
      {...searchableSetting("thread-notifications")}
      description={permissionMessage ?? t("notifications.threadNotifications.description")}
      control={
        <Select
          value={mode}
          disabled={requesting}
          onValueChange={async (value) => {
            if (
              value !== "off" &&
              value !== "notifications" &&
              value !== "sound" &&
              value !== "notifications-and-sound"
            )
              return;
            setPermissionMessage(null);
            if (hasNotificationSound(value)) unlockNotificationAudio();
            if (hasDesktopNotifications(value)) {
              if (typeof Notification === "undefined" || !window.isSecureContext) {
                setPermissionMessage(t("notifications.threadNotifications.needsBrowserOrDesktop"));
                return;
              }
              setRequesting(true);
              const permission = await settlePromise(() => Notification.requestPermission());
              setRequesting(false);
              if (permission._tag === "Failure") {
                setPermissionMessage(t("notifications.threadNotifications.unavailableInBrowser"));
                return;
              }
              if (permission.value !== "granted") {
                setPermissionMessage(t("notifications.threadNotifications.allowAndRetry"));
                return;
              }
            }
            updateSettings({ notificationMode: value });
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={t("notifications.threadNotifications.selectAriaLabel")}
          >
            <SelectValue>{notificationModeLabels()[mode]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {Object.entries(notificationModeLabels()).map(([value, label]) => (
              <SelectItem key={value} hideIndicator value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}
