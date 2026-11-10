import { pgPool } from "./pgClient.js";
import { deleteExistingWorkspaceVectors } from "./ingest.js";
import { getInstallationId, deleteInstallationId } from "./githubInstallationStore.js";
import { getLinearWorkspaceIdFromStorage, deleteLinearTokens } from "./linearInstallationStore.js";
import { slackInstallationStore } from "./slackInstallationStore.js";

// Deletes everything that's stored for a Slack workspace. It's safe to call twice (every step is a no-op if the data is gone).
export async function purgeWorkspaceData(teamId: string): Promise<void> {
    // 1. Customer content: Redis vectors + Postgres Linear chunks
    await deleteExistingWorkspaceVectors(teamId);
    await pgPool.query("delete from linear_data_chunks where slack_team_id = $1", [teamId]);

    // 2. GitHub + Linear connection records in Redis
    const githubInstallationId = await getInstallationId(teamId);
    if (githubInstallationId) {
        await deleteInstallationId(teamId, githubInstallationId);
    }
    const linearWorkspaceId = await getLinearWorkspaceIdFromStorage(teamId);
    await deleteLinearTokens(teamId, linearWorkspaceId);

    // 3. LAST: the Slack installation row. (Order matters because if Slack row's deleted first
    //          and then crashed, we'd have orphaned customer data and nothing pointing to it - BAD!)
    await slackInstallationStore.deleteInstallation?.({
        teamId,
        enterpriseId: undefined,
        isEnterpriseInstall: false,
    });
}