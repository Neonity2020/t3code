# i18n（中/英）

`apps/web` 的国际化基建：[i18next](https://www.i18next.com) + `react-i18next`，语言资源为本目录下的 JSON，界面语言偏好持久化在 `ClientSettings.uiLanguage`（`"system" | "en" | "zh-CN"`，定义于 `packages/contracts/src/settings.ts`）。

## 运行时架构

- `index.ts` — i18next 实例与初始化。语言解析链：`localStorage` 镜像（`t3.ui-language`，同步快速路径）→ `ClientSettings.uiLanguage`（水合后权威）→ 系统 `navigator.language` → `"en"` 兜底。资源由 `locales/base.*.json` 与各功能分片（`appearance.*`、`storage.*` 等）浅合并而成——**分片文件必须使用互不重叠的顶层命名空间**。
- `appInit.tsx` 的 `startUiLanguage()` — 订阅 client settings，把变更（包括其他窗口的修改）同步给 i18next 并刷新镜像。
- `useUiLanguage()` — 组件读取/设置语言偏好的唯一入口（内部走 `useClientSettings` / `updateClientSettings`）。
- 语言切换即时生效：`useTranslation()` 订阅语言变化并触发重渲染。
- `settingsSearch.ts` 的 `SETTINGS_SEARCH_ITEMS_ZH` — 设置行标题注册表的中文 overlay。注册表与 `searchSettings()` 保持纯英文（单测断言英文），本地化只发生在渲染路径：`searchableSetting()`（设置行标题）与 `localizeAvailableSettingsSearchItems()`（侧栏搜索/命令面板，中文关键词会追加进搜索词）。

## 在组件里使用

```tsx
import { useTranslation } from "react-i18next";

export function MyPanel() {
  const { t } = useTranslation();
  return <Button>{t("hero.addProject")}</Button>;
}
```

约定：

1. **键名**：按界面区域分层（`hero.*`、`settings.general.*`、`settings.sections.*`）。英文原文即键值的英文资源，key 用稳定的语义路径，不要用英文句子当 key。
2. **资源**：同时编辑 `locales/en.json` 与 `locales/zh-CN.json`。en 缺键会显示 key 本身；zh 缺键回退英文（`fallbackLng: "en"`）。
3. **插值**：`t("x", { count })`，资源里写 `{{count}}`；复数用 i18next 的 `_one`/`_other` 后缀。
4. **非组件代码**（纯函数、状态模块）：`import i18next from "~/i18n"` 后直接 `i18next.t(...)`，并带 `defaultValue`。注意这类调用只在宿主组件重渲染时刷新。
5. **不可翻译的字符串**：语言名称（"English"/"简体中文"）用 `UI_LANGUAGE_NATIVE_LABELS` 原文显示，不进资源文件。

## 已迁移的界面

- Settings 侧边栏导航 + 面包屑 + 命令面板的分区标签（`settingsSectionLabel` / `SettingsSectionLabel`）
- Settings → General 的语言切换行（语言选择器本体）
- `NoProjectsHero`（空项目首屏）
- **全部设置行标题**（约 95 条，经 `SETTINGS_SEARCH_ITEMS_ZH` overlay）+ 侧栏搜索/命令面板的中文搜索词
- Settings → General 整页（所有分区、行描述、选项标签、更新区、重置确认对话框、旧版功能区）
- 设置行共享件：继承状态摘要、重置按钮 tooltip/aria、无权限/环境级提示、搜索框
- 外观/主题/排版、通知/存储/快照/快捷键、连接/集成面板（见 `locales/*.en.json` 分片）

## 待迁移（增量进行）

其余界面的文案仍为硬编码英文。两个集中点值得优先处理：

1. 设置区剩余面板：Providers、Scheduled tasks、Source control、Diagnostics、Projects、Beta、Archive，以及会话侧边栏/命令面板动作/欢迎向导等主界面。
2. 各面板内联的 toast、空状态、确认对话框文案。

迁移一个面板的步骤：组件顶部加 `useTranslation` → 字面量换成 `t()` → 两个 JSON 补键 → `tsc --noEmit` 过一遍。新面板建议新建独立分片文件（`locales/<area>.en.json` + `locales/<area>.zh-CN.json`）并在 `index.ts` 注册，避免与他人冲突。
