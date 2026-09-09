import express from "express";
import dotenv from "dotenv";
import {
    exchangeLinearOAuthCode,
    verifyLinearWebhookSignature,
    parseLinearWebhookPayload,
    getLinearIssueById,
} from "./../linear.js";
import { saveLinearTokens, deleteLinearTokens } from "./../linearInstallationStore.js";
import { linearIngestQueue } from "./../queue.js";

dotenv.config();

export const linearExpressApp = express();
// Webhook signature verification needs the raw body, so capture it before express.json() parses it.
linearExpressApp.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));

// Debug: log all incoming requests
linearExpressApp.use((req, res, next) => {
    console.log(`[LINEAR REQUEST DEBUG] ${req.method} ${req.path}`);
    next();
});

// Linear OAuth callback - receives `state` (Slack workspace ID) and `code`,
// then exchanges the code for a workspace-level (actor=app) access + refresh token pair.
linearExpressApp.get("/linear/oauth/callback", async (req, res) => {
    console.log("[LINEAR OAUTH DEBUG] Received OAuth callback");
    console.log("[LINEAR OAUTH DEBUG] Query params:", req.query);

    try {
        const { state, code } = req.query;
        const slackWorkspaceId = state as string;

        if (!state || !code) {
            console.error("[LINEAR OAUTH DEBUG] Missing state or code");
            return res.status(400).send("Missing state or code parameter");
        }
        if (!slackWorkspaceId || slackWorkspaceId.trim() === "") {
            console.error("[LINEAR OAUTH DEBUG] Invalid workspace ID from state");
            return res.status(400).send("Invalid state parameter");
        }

        const tokens = await exchangeLinearOAuthCode(code as string);
        await saveLinearTokens(slackWorkspaceId, {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            expiresAt: Date.now() + tokens.expires_in * 1000,
        });

        console.log("[LINEAR OAUTH DEBUG] Saved tokens for workspace:", slackWorkspaceId);
        res.send(`Linear connected! You can close this window. Workspace: ${slackWorkspaceId}`);
    } catch (err) {
        console.error("[LINEAR OAUTH DEBUG] Error in callback:", err);
        res.status(500).send("Authorization failed");
    }
});

// Linear webhook - receives data-change events (Issue, Comment, Project, ProjectUpdate, Document, ...)
// and enqueues a targeted re-ingest job instead of re-pulling the whole workspace.
linearExpressApp.post("/linear/webhook", async (req, res) => {
    console.log("[LINEAR WEBHOOK DEBUG] Received webhook request");

    try {
        const signature = req.headers["linear-signature"];
        const rawBody = (req as any).rawBody;

        if (!verifyLinearWebhookSignature(rawBody, signature)) {
            console.error("[LINEAR WEBHOOK DEBUG] Signature verification failed");
            return res.status(400).send("Invalid signature");
        }

        // TODO: reject if webhookTimestamp is more than ~1 minute old, to guard against replay attacks.
        const { action, type, data } = parseLinearWebhookPayload(req.body);
        console.log("[LINEAR WEBHOOK DEBUG] action:", action, "type:", type);

        // TODO: `data` doesn't directly carry the Slack team ID - resolve slackTeamId from your
        // installation store (e.g. by organizationId on the payload) before enqueuing.
        const slackTeamId = data?.organizationId ?? data?.teamId;

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
        // TODO: handle Comment / Project / ProjectUpdate / Document events similarly -
        // for comments, re-ingest the parent issue; for docs/projects, re-ingest that entity directly.

        res.status(200).send("200 OK");
    } catch (err) {
        console.error("[LINEAR WEBHOOK DEBUG] Error in webhook handler:", err);
        res.status(400).send("Webhook handling failed");
    }
});
