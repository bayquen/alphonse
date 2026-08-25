// Program: githubInstallationStore.ts
// Purpose: Contains helper functions for reading and storing github installations via their IDs, respectively
// Used by: github.ts

import { redisClient } from "./redisClient.js";

export async function getInstallationId(slackTeamId: string): Promise<string | null> {
    return redisClient.get(`github:installation:${slackTeamId}`);
}

export async function getSlackTeamIdByInstallationId(installationId: string): Promise<string | null> {
    return redisClient.get(`github:installation-owner:${installationId}`);
}

export async function saveInstallationId(slackTeamId: string, installationId: string): Promise<void> {
    await redisClient.set(`github:installation:${slackTeamId}`, installationId);
    await redisClient.set(`github:installation-owner:${installationId}`, slackTeamId);
}

export async function deleteInstallationId(slackTeamId: string, installationId: string): Promise<void> {
    await redisClient.del(`github:installation:${slackTeamId}`);
    await redisClient.del(`github:installation-owner:${installationId}`);
}