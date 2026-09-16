// Program: linearInstallationStore.ts
// Purpose: Contains helper functions for reading and storing Linear installations via access tokens

import { redisClient } from "./redisClient.js";
import type { LinearTokenResponse } from "./linear.js";

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
            // Save new Linear token bundle to Redis storage
            await saveLinearTokens(slackTeamId, newTokenBundle);
        
            // Return new access token string (not the whole JSON-object bundle)
            return newTokenBundle.accessToken;
        } catch (err) {
            console.error("Failed to refresh Linear access token for Slack workspace " + slackTeamId + ":", err);
            // Delete current Linear token bundle from storage since an error must mean the access token is stale
            await deleteLinearTokens(slackTeamId);
            return null;
        }
    } else {
        // Return current access token string (not the whole JSON-object bundle)
        return parsed.accessToken;
    }
}

export async function saveLinearTokens(slackTeamId: string, linearTokenBundle: 
    { 
        accessToken: string, 
        refreshToken: string, 
        expiresAt: number
    }) {
    const serializedTokenBundle = JSON.stringify(linearTokenBundle);
    await redisClient.set(`linear:installation:${slackTeamId}`, serializedTokenBundle);
}

export async function deleteLinearTokens(slackTeamId: string) {
    await redisClient.del(`linear:installation:${slackTeamId}`);
}
