import { describe, expect, it } from "vite-plus/test";

import { translate } from "./i18n";

describe("translate", () => {
  it("returns the requested supported locale", () => {
    expect(translate("en", "sidebar.newThread")).toBe("New thread");
    expect(translate("zh-CN", "sidebar.newThread")).toBe("新建任务");
    expect(translate("zh-CN", "sidebar.noThreads")).toBe("还没有任务");
    expect(translate("zh-CN", "nav.openFlowUs")).toBe("打开 FlowUs 空间");
    expect(translate("zh-CN", "rightPanel.terminal")).toBe("终端");
    expect(translate("zh-CN", "plan.empty")).toBe("暂时没有进行中的计划。");
    expect(translate("zh-CN", "draftHero.addProjectToStart")).toBe("添加项目以开始");
    expect(translate("zh-CN", "composer.slashCommand.plan")).toBe("将此任务切换到计划模式");
    expect(translate("zh-CN", "composer.commandMenu.noMatchingCommand")).toBe("没有匹配的命令。");
  });
});
