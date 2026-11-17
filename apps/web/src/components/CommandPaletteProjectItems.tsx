import type { EnvironmentId, EnvironmentMachineKind } from "@t3tools/contracts";
import { T, useGT } from "gt-react";

import type { SidebarProjectSnapshot } from "../sidebarProjectGrouping";
import type { Project } from "../types";
import {
  buildCommandPaletteProjectMetadata,
  buildProjectActionItems,
  type CommandPaletteItemPin,
  type CommandPaletteProject,
  ITEM_ICON_CLASS,
} from "./CommandPalette.logic";
import { EnvironmentMachineIcon } from "./EnvironmentMachineIcon";
import { ProjectFavicon } from "./ProjectFavicon";
import { COMMAND_PALETTE_META_ICON_CLASS, CommandPaletteMetaDot } from "./ThreadCommandSubtitle";

export interface CommandPaletteProjectLocation {
  readonly kind: "local" | "remote";
  readonly label: string;
  readonly machine: EnvironmentMachineKind;
}

interface ProjectItemsInput {
  readonly projects: ReadonlyArray<CommandPaletteProject>;
  readonly projectGroupByTargetKey: ReadonlyMap<string, SidebarProjectSnapshot>;
  readonly locationByEnvironmentId: ReadonlyMap<EnvironmentId, CommandPaletteProjectLocation>;
  readonly unknownLocationLabel?: string;
  readonly runProject: (project: CommandPaletteProject) => Promise<void>;
  readonly pin?: (project: CommandPaletteProject) => CommandPaletteItemPin | null;
}

function projectFaviconIcon(project: Project) {
  return <ProjectFavicon project={project} className={ITEM_ICON_CLASS} />;
}

/** Projects as root search results; a grouped project matches on every member. */
export function buildProjectSearchItems(input: ProjectItemsInput) {
  const membersOf = (project: CommandPaletteProject) =>
    input.projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`)?.memberProjects ?? [
      project,
    ];
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "project",
    searchTerms: (project) => {
      const members = membersOf(project);
      return [
        ...buildCommandPaletteProjectMetadata({
          projects: members,
          locationByEnvironmentId: input.locationByEnvironmentId,
          ...(input.unknownLocationLabel !== undefined
            ? { unknownLocationLabel: input.unknownLocationLabel }
            : {}),
        }).searchTerms,
        ...members.map(
          (member) => input.locationByEnvironmentId.get(member.environmentId)?.kind ?? "remote",
        ),
      ];
    },
    renderDescription: (project) => {
      const members = membersOf(project);
      const metadata = buildCommandPaletteProjectMetadata({
        projects: members,
        locationByEnvironmentId: input.locationByEnvironmentId,
        ...(input.unknownLocationLabel !== undefined
          ? { unknownLocationLabel: input.unknownLocationLabel }
          : {}),
      });
      return members.length > 1 ? (
        <span className="truncate">{metadata.environmentLabels.join(" · ")}</span>
      ) : (
        <ProjectLocationDescription
          location={input.locationByEnvironmentId.get(project.environmentId)}
          workspaceRoot={project.workspaceRoot}
        />
      );
    },
    icon: projectFaviconIcon,
    runProject: input.runProject,
    ...(input.pin ? { pin: input.pin } : {}),
  });
}

/** Projects as targets of the "New thread in..." submenu. */
export function buildNewThreadInProjectItems(
  input: ProjectItemsInput & { readonly currentProjectKey: string | null },
) {
  return buildProjectActionItems({
    projects: input.projects,
    valuePrefix: "new-thread-in",
    searchTerms: (project) => {
      const group = input.projectGroupByTargetKey.get(`${project.environmentId}:${project.id}`);
      const location = input.locationByEnvironmentId.get(project.environmentId);
      return [
        ...(group?.memberProjects.flatMap((member) => [member.title, member.workspaceRoot]) ?? []),
        ...(location ? [location.label, location.kind] : []),
      ];
    },
    renderDescription: (project) => (
      <ProjectLocationDescription
        location={input.locationByEnvironmentId.get(project.environmentId)}
        workspaceRoot={project.workspaceRoot}
        current={input.currentProjectKey === `${project.environmentId}:${project.id}`}
      />
    ),
    icon: projectFaviconIcon,
    runProject: input.runProject,
    ...(input.pin ? { pin: input.pin } : {}),
  });
}

function ProjectLocationDescription(props: {
  readonly location: CommandPaletteProjectLocation | undefined;
  readonly workspaceRoot: string;
  readonly current?: boolean;
}) {
  const gt = useGT();
  const location = props.location ?? {
    kind: "remote" as const,
    label: gt("Remote"),
    machine: "server" as const,
  };
  return (
    <span className="flex min-w-0 items-center gap-1">
      {props.current ? (
        <>
          <span className="shrink-0">
            <T>Current</T>
          </span>
          <CommandPaletteMetaDot />
        </>
      ) : null}
      <span className="inline-flex min-w-0 items-center gap-1">
        {location.kind === "remote" ? (
          <EnvironmentMachineIcon
            aria-hidden
            kind={location.machine}
            className={COMMAND_PALETTE_META_ICON_CLASS}
          />
        ) : null}
        <span className="truncate">{location.label}</span>
      </span>
      <CommandPaletteMetaDot />
      <span className="min-w-0 flex-1 truncate">{props.workspaceRoot}</span>
    </span>
  );
}
