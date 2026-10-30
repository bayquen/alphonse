// Program: linearInstallationStore.ts
// Purpose: Contains helper functions for reading and storing Linear installations via access tokens

import { redisClient } from "./redisClient.js";
import type { LinearTokenResponse } from "./linear.js";
import { randomBytes } from "node:crypto";

// Creates a random, single-use token tied to a Slack team. it expires in 10 minutes
export async function createLinearInstallState(slackTeamId: string): Promise<string> {
    const nonce = randomBytes(32).toString("hex");
    await redisClient.setEx(`linear:state:${nonce}`, 600, slackTeamId);
    return nonce;
}
// Reads AND deletes the single-use token in one step, so each one works only once (hence "NONCE").
export async function consumeLinearInstallState(nonce: string): Promise<string | null> {
    return redisClient.getDel(`linear:state:${nonce}`);
}


export async function getLinearAccessToken(slackTeamId: string, token: (refreshToken: string) => Promise<LinearTokenResponse>) {
    const linearTokenBundle = await redisClient.get(`linear:installation:${slackTeamId}`);
    // If Linear tokens NOT FOUND then log it and return null so callers know the Slack workspace needs to reauthorize
    if (!linearTokenBundle) {
        console.log("No Linear access token was found in storage! Reauthorization needed");
        return null;
    }
    const parsed = JSON.parse(linearTokenBundle);

    const BUFFER_MS = 60000; // 1 minute expiration
    // Check if current access token is expired
    if (Date.now() >= parsed.expiresAt - BUFFER_MS) {
        try {
            // If so, then replace current token with a new refresh token
            const response = await token(parsed.refreshToken);
            const newTokenBundle = {
                accessToken: response.access_token, 
                refreshToken: response.refresh_token, 
                expiresAt: Date.now() + response.expires_in * 1000
            }
            // Grab relevant Linear workspace ID from Redis storage
            const linearWorkspaceId = await getLinearWorkspaceIdFromStorage(slackTeamId);
            if (!linearWorkspaceId) {
                throw new Error("Linear workspace ID not found for refresh");
            }
            // Save new Linear token bundle to Redis storage
            await saveLinearTokens(slackTeamId, newTokenBundle, linearWorkspaceId);
        
            // Return new access token string (not the whole JSON-object bundle)
            return newTokenBundle.accessToken;
        } catch (err) {
            console.error("Failed to refresh Linear access token for Slack workspace " + slackTeamId + ":", err);
            // Delete current Linear token bundle from storage since an error must mean the access token 
            // is stale. Grab linearWorkspaceId first, though, to pass as the second func. parameter for deletion.
            const linearWorkspaceId = await getLinearWorkspaceIdFromStorage(slackTeamId);
            await deleteLinearTokens(slackTeamId, linearWorkspaceId);
            return null;
        }
    } else {
        // Return current access token string (not the whole JSON-object bundle)
        return parsed.accessToken;
    }
}

// Helper function to retrieve the relevant Linear workspace ID that exists in Redis storage
export async function getLinearWorkspaceIdFromStorage(slackTeamId: string): Promise<string | null> {
    const workspaceId = await redisClient.get(`linear:workspace:${slackTeamId}`);
    // return workspaceId ? JSON.parse(workspaceId) : null;
    return workspaceId ? workspaceId : null;
}

export async function saveLinearTokens(slackTeamId: string, linearTokenBundle: 
    { 
        accessToken: string, 
        refreshToken: string, 
        expiresAt: number
    },
    linearWorkspaceId: string
    ) {
    
    const serializedTokenBundle = JSON.stringify(linearTokenBundle);
    const serializedLinearWorkspaceId = JSON.stringify(linearWorkspaceId);
    // This data store is used by getLinearAccessToken() to fetch and refresh tokens
    await redisClient.set(`linear:installation:${slackTeamId}`, serializedTokenBundle);
    // Used for the webhook handler to find which Slack team owns the given Linear org
    await redisClient.set(`linear:org-to-slack:${linearWorkspaceId}`, slackTeamId);
    // Used by token refresh (i.e. getLinearAccessToken()) to know which Linear org's tokens to refresh
    await redisClient.set(`linear:workspace:${slackTeamId}`, linearWorkspaceId);
}

export async function deleteLinearTokens(slackTeamId: string, linearWorkspaceId?: string | null) {
    await redisClient.del(`linear:installation:${slackTeamId}`);
    // Edge case: if Linear tokens exist, but the Linear workspace ID doesn't (e.g. due to 
    // data corruption, a partial save, etc.), then linearWorkspace deletion should obviously
    // only occur if the ID exists or else we get an unchecked error.
    if (linearWorkspaceId) {
        await redisClient.del(`linear:org-to-slack:${linearWorkspaceId}`);
    }
    await redisClient.del(`linear:workspace:${slackTeamId}`);
}
