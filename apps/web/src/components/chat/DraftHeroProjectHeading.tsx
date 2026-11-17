import { T, Var } from "gt-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";

export function DraftHeroProjectHeading({
  children,
  projectName,
}: {
  children: ReactNode;
  projectName: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inlineRef = useRef<HTMLSpanElement>(null);
  const [fitsInline, setFitsInline] = useState(false);
  const isLargeViewport = useMediaQuery("lg");
  const isShortViewport = useMediaQuery("(max-height: 28rem)");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the heading against its container via ResizeObserver to choose inline or stacked layout
  useLayoutEffect(() => {
    const container = containerRef.current;
    const inline = inlineRef.current;
    if (!container || !inline) return;

    // Measure the full inline heading independently of its current layout, so
    // moving the name below it cannot make the fit check oscillate.
    const update = () =>
      setFitsInline(
        inline.getBoundingClientRect().width <= container.getBoundingClientRect().width,
      );
    update();
    return observeResize([container, inline], update);
  }, []);

  const showInline = isLargeViewport && fitsInline && !isShortViewport;

  return (
    <div ref={containerRef} className="group/draft-hero relative w-full" data-inline={fitsInline}>
      <span
        aria-hidden="true"
        className="pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden"
      >
        <span
          ref={inlineRef}
          className="inline-flex w-max items-baseline gap-2 whitespace-nowrap font-normal text-3xl tracking-tight"
        >
          <T>
            <span className="shrink-0">What should we build in</span>
            <span className="min-w-0 max-w-full">
              <Var>
                <span className="font-medium">{projectName}</span>
              </Var>
              ?
            </span>
          </T>
        </span>
      </span>
      {showInline ? (
        <h1 className="flex w-full flex-row items-baseline justify-center gap-2 text-center font-normal text-3xl text-foreground tracking-tight">
          <T>
            <span className="shrink-0">What should we build in</span>
            <span className="min-w-0 max-w-full">
              <Var>{children}</Var>?
            </span>
          </T>
        </h1>
      ) : (
        <h1 className="flex w-full flex-col items-center justify-center gap-2 text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
          <span className="max-w-full [@media(max-height:28rem)]:sr-only">
            <T>What should we build?</T>
          </span>
          <span className="flex min-w-0 max-w-full items-baseline justify-center text-base tracking-normal">
            <span className="min-w-0">{children}</span>
          </span>
        </h1>
      )}
    </div>
  );
}
