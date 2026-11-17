import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getNewProjectRepository,
  type NewProjectPublishTarget,
} from "@t3tools/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { waitForProject } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { sourceControlEnvironment } from "~/state/sourceControl";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";
import { suggestAppAccessForRemote } from "../components/sourceControlAppAccessToast";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

export function useNewProject() {
  const gt = useGT();
  const fallbackError = gt("An error occurred.");
  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const publishRepository = useAtomCommand(sourceControlEnvironment.publishRepository, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();

  const publishNewRepository = async (input: {
    readonly environmentId: EnvironmentId;
    readonly workspaceRoot: string;
    readonly target: NewProjectPublishTarget;
  }) => {
    const { label } = input.target.definition;
    const result = await publishRepository({
      environmentId: input.environmentId,
      input: {
        cwd: input.workspaceRoot,
        provider: input.target.definition.kind,
        repository: getNewProjectRepository(input.target, input.workspaceRoot),
        visibility: "private",
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not create the {provider} repository", { provider: label }),
            description: gt("{error} Use Publish Repository in the Git menu to try again.", {
              error: errorMessage(squashAtomCommandFailure(result), fallbackError),
            }),
          }),
        );
      }
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: gt("Published to {provider}", { provider: label }),
        description: result.value.repository.nameWithOwner,
      }),
    );
    void suggestAppAccessForRemote(input.environmentId, result.value.remoteUrl);
  };

  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly publishTo: NewProjectPublishTarget | null;
  }): Promise<boolean> => {
    const result = await createNew({
      environmentId: input.environmentId,
      input: { name: input.name },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not create the project"),
            description: errorMessage(squashAtomCommandFailure(result), fallbackError),
          }),
        );
      }
      return false;
    }

    const { projectId, workspaceRoot, commitError } = result.value;
    toastManager.add(
      stackedThreadToast(
        commitError === undefined
          ? {
              type: "success",
              title: gt("Created {name}", { name: input.name }),
              description: workspaceRoot,
            }
          : {
              type: "warning",
              title: gt("Created {name} without a first commit", { name: input.name }),
              description: gt("{error} The project is in {path}.", {
                error: commitError,
                path: workspaceRoot,
              }),
            },
      ),
    );
    if (input.publishTo) {
      void publishNewRepository({
        environmentId: input.environmentId,
        workspaceRoot,
        target: input.publishTo,
      });
    }

    const projectRef = scopeProjectRef(input.environmentId, projectId);
    // Wait for the stored project path; drafts use it as their key.
    const project = await waitForProject(projectRef).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to open project"),
          description: gt("{error} It will appear in the sidebar once this client catches up.", {
            error: errorMessage(error, fallbackError),
          }),
        }),
      );
      return null;
    });
    if (project === null) return true;
    await handleNewThread(projectRef).catch((error: unknown) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Failed to open project"),
          description: errorMessage(error, fallbackError),
        }),
      );
    });
    return true;
  };
}
