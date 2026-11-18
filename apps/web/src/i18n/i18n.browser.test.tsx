import { GTProvider } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { NoActiveThreadState } from "../components/NoActiveThreadState";
import zh from "./translations/zh.json";

describe("web i18n", () => {
  it("renders Simplified Chinese when locale is zh and switches back to English", async () => {
    // No router needed: NoActiveThreadState renders only static empty state UI.
    await using screen = await render(
      <GTProvider locale="zh" translations={{ zh }}>
        <NoActiveThreadState />
      </GTProvider>,
      { router: false },
    );

    await expect.element(screen.getByText("暂无活动线程")).toBeInTheDocument();
    await expect.element(screen.getByText("选择一个线程以继续")).toBeInTheDocument();

    await screen.rerender(
      <GTProvider locale="en" translations={{}}>
        <NoActiveThreadState />
      </GTProvider>,
    );

    await expect.element(screen.getByText("No active thread")).toBeInTheDocument();
    await expect.element(screen.getByText("Pick a thread to continue")).toBeInTheDocument();
  });
});
