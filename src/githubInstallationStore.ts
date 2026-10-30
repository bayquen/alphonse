// Program: githubInstallationStore.ts
// Purpose: Contains helper functions for reading and storing github installations via their IDs, respectively
// Used by: github.ts

import { redisClient } from "./redisClient.js";
import { randomBytes } from "node:crypto";

// Creates an unguessable one-time token tied to a Slack workspace; expires in 10 min.
// "Nonce" = Number that is only used once
export async function createInstallState(slackTeamId: string): Promise<string> {
    const nonce = randomBytes(32).toString("hex");
    await redisClient.setEx(`github:state:${nonce}`, 600, slackTeamId);
    return nonce;
}

// Looks up AND deletes the token in one atomic step, so it can only be used ONCE.
export async function consumeInstallState(nonce: string): Promise<string | null> {
    return redisClient.getDel(`github:state:${nonce}`);
}

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