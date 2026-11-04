/**
 * Program: slackNotifier.ts
 * Used in: repoWorker.ts
 * Author: Brandon Bayquen
 * Purpose: Sends Slack direct-message notifications from the repo background worker
 *          process (e.g. when GitHub repo ingestion completes or fails).
 * 
 * Details: - Creates a standalone @slack/web-api WebClient authenticated with
 *            SLACK_BOT_TOKEN (the worker runs separately from the Bolt app, so it
 *            can't share Bolt's `app.client`).
 *          - Exports notifyUser(userId, text), which DMs a Slack user via
 *            chat.postMessage (requires the chat:write scope).
 *          - Notification errors are caught and logged so a failed Slack message
 *            never fails or retries the ingestion job itself.
 */

import { WebClient } from "@slack/web-api";
import dotenv from "dotenv";
dotenv.config();

const botToken = process.env.SLACK_BOT_TOKEN;
if (!botToken) throw new Error("Missing Slack bot token for worker notifications.");

const slack = new WebClient(botToken);

export async function notifyUser(channelId: string, text: string): Promise<void> {
    try {
        // side note: `text` is required as the fallback for notifications. Blocks can come later if nicer formatting is desired.
        await slack.chat.postMessage({ channel: channelId, text });
    } catch (err) {
        // A failed notification must never break or retry the BullMQ repo ingestion job
        console.error("Slack notification failed:", err);
    }
}