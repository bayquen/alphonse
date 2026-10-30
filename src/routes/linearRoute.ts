import express from "express";
import dotenv from "dotenv";
import {
    exchangeLinearOAuthCode,
    verifyLinearWebhookSignature,
    parseLinearWebhookPayload,
    getLinearIssueById,
    linearWorkspaceIdFetcher,
    backfillWorkspaceLinearIssues,
} from "./../linear.js";
import { saveLinearTokens, deleteLinearTokens, consumeLinearInstallState } from "./../linearInstallationStore.js";
import { linearIngestQueue } from "./../queue.js";
import { redisClient } from "./../redisClient.js";

dotenv.config();

export const linearRouter = express.Router();
// // Webhook signature verification needs the raw body, so capture it before express.json() parses it.
// linearExpressApp.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

// Linear OAuth callback - receives `state` (Slack workspace ID) and `code`,
// then exchanges the code for a workspace-level (actor=app) access + refresh token pair.
linearRouter.get("/linear/oauth/callback", async (req, res) => {
    console.log("[LINEAR OAUTH DEBUG] Received OAuth callback");

    try {
        const { state, code } = req.query;
        if (typeof state !== "string" || typeof code !== "string" || !state || !code) {
            return res.status(400).send("Missing state or code parameter")
        }
        // Security: Consume the state BEFORE exchanging the code, so that a stolen state can't be reused.
        const slackWorkspaceId = await consumeLinearInstallState(state);
        if (!slackWorkspaceId || slackWorkspaceId.trim() === "") {
            return res.status(400).send("Invalid or expired state. Please run /add_linear_workspace again.");
        }

        const tokens = await exchangeLinearOAuthCode(code as string);
        const linearWorkspaceId = await linearWorkspaceIdFetcher(tokens.access_token);
        await saveLinearTokens(slackWorkspaceId, {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
        },
        linearWorkspaceId
        );
        // Backfill a (limited) number of Linear Issues in a given Linear workspace and return the number of queued jobs
        // (remember: one BullMQ job is queued per Linear Issue in bulk, wbich is efficient because
        // BullMQ rounds up jobs once and does a single trip to Redis endpoint vs. one trip per job!)
        const queuedCount = await backfillWorkspaceLinearIssues(slackWorkspaceId);
        console.log(`[LINEAR OAUTH DEBUG] Queued ${queuedCount} Linear Issues for backfill!`);

        console.log("[LINEAR OAUTH DEBUG] Saved tokens for workspace:", slackWorkspaceId);
        res.send(`Linear connected! You can close this window. Workspace: ${slackWorkspaceId}`);
    } catch (err) {
        console.error("[LINEAR OAUTH DEBUG] Error in callback:", err);
        res.status(500).send("Authorization failed");
    }
});

// Linear webhook - receives data-change events (Issue, Comment, Project, ProjectUpdate, Document, ...)
// and enqueues a targeted re-ingest job instead of re-pulling the whole workspace.
linearRouter.post("/linear/webhook", async (req, res) => {
    console.log("[LINEAR WEBHOOK DEBUG] Received webhook request");

    try {
        const signature = req.headers["linear-signature"];
        const rawBody = (req as any).rawBody;

        if (!verifyLinearWebhookSignature(rawBody, signature)) {
            console.error("[LINEAR WEBHOOK DEBUG] Signature verification failed");
            return res.status(401).send("Invalid signature");
        }

        const { action, type, data, organizationId, webhookTimestamp } = parseLinearWebhookPayload(req.body);

        // Security: Reject requests older (or newer) than 60 second so that a real, correctly-signed, and captured request can't be replayed later (e.g. malicious intent)
        const ageInMs = Date.now() - Number(webhookTimestamp);
        if (!Number.isFinite(ageInMs) || Math.abs(ageInMs) > 60_000) {
            console.warn("[LINEAR WEBHOOK DEBUG] Rejected stale or invalid timestamp");
            return res.status(401).send("Stale or invalid timestamp");
        }

        console.log("[LINEAR WEBHOOK DEBUG] action:", action, "type:", type);

        // The payload carries Linear's organizationId (not the Slack team ID), so reverse-lookup the
        // Slack workspace from the org-to-slack mapping saved during OAuth.
        const slackTeamId = await redisClient.get(`linear:org-to-slack:${organizationId}`);

        if (!slackTeamId) {
            console.warn("[LINEAR WEBHOOK DEBUG] Could not resolve Slack workspace for this event");
            return res.status(200).send("200 OK - no workspace mapping");
        }

        if (type === "Issue" && (action === "create" || action === "update")) {
            await linearIngestQueue.add("linear-issue-ingest", {
                slackTeamId,
                issueId: data.id,
            });
        }
        // TODO (POST-MVP?): handle Comment / Project / ProjectUpdate / Document events similarly -
        // for comments, re-ingest the parent issue; for docs/projects, re-ingest that entity directly.

        res.status(200).send("200 OK");
    } catch (err) {
        console.error("[LINEAR WEBHOOK DEBUG] Error in webhook handler:", err);
        res.status(500).send("Webhook handling failed");
    }
});
