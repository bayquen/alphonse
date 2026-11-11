/**
 * Program: slackNotifier.ts
 * Used in: repoWorker.ts
 * Author: Brandon Bayquen
 * Purpose: Sends Slack direct-message notifications from the repo background worker
 *          process (e.g. when GitHub repo ingestion completes or fails).
 * 
 * Details: - Creates a standalone @slack/web-api WebClient authenticated with
 *            a Slack workspace's ID -- a.k.a. team ID -- and bot token (the worker runs 
 *            separately from the Bolt app, so it can't share Bolt's `app.client`).
 *          - Notification errors are caught and logged so a failed Slack message
 *            never fails or retries the ingestion job itself.
 */

import { WebClient, retryPolicies } from "@slack/web-api";
import { getBotTokenForTeam } from "./slackInstallationStore.js";
import dotenv from "dotenv";
dotenv.config();

const slack = new WebClient(undefined, {
    // Default is 10 retries over ~30 minutes. That's far too long to hold up a job-completion handler.
    retryConfig: retryPolicies.fiveRetriesInFiveMinutes,
});

export async function notifyUser(slackTeamId: string, userId: string, text: string): Promise<void> {
    try {
        const token = await getBotTokenForTeam(slackTeamId);
        // Passing a user ID (U...) as `channel` makes Slack open/reuse a DM between the bot and that user.
        // side note: `text` is required as the fallback for notifications. Blocks can come later if nicer formatting is desired.
        await slack.chat.postMessage({ token, channel: userId, text });
    } catch (err) {
        // A failed notification must never fail or retry the BullMQ ingest job
        console.error(`Slack notification failed for Slack team ${slackTeamId}:`, err instanceof Error ? err.message : err);
    }
}