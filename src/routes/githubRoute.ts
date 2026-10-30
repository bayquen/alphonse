import express from "express";
import { redisClient } from "./../redisClient.js";
import { verifyGitHubWebhookSignature} from "./../github.js";
import { saveInstallationId, 
    deleteInstallationId, 
    getSlackTeamIdByInstallationId, 
    consumeInstallState } from "./../githubInstallationStore.js";
import dotenv from "dotenv";

dotenv.config();

// export const expressApp = express();
export const githubRouter = express.Router();

// GitHub OAuth callback - receives state (Slack workspace ID), code, and installation_id
githubRouter.get('/github/oauth/callback', async (req, res) => {
    console.log("[GITHUB OAUTH] Received OAuth callback");
    try {
        const { state, installation_id } = req.query;

        if (typeof state !== 'string' || typeof installation_id !== 'string') {
            return res.status(400).send('Missing state or GitHub installation ID');
        }

        const slackWorkspaceId = await consumeInstallState(state);
        if (!slackWorkspaceId) {
            return res.status(400).send('Invalid or expired state. Please run /add_repo again.');
        }

        await saveInstallationId(slackWorkspaceId, installation_id);
        res.send('GitHub App authorized! You can close this window and return to Slack.');
    } catch (err) {
        console.error("[GITHUB OAUTH] Error in callback:", err);
        res.status(500).send('Authorization failed');
    }
});

// GitHub webhook - receives installation events
githubRouter.post('/github/webhook', async (req, res) => {
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (!verifyGitHubWebhookSignature(rawBody, signature)) {
        console.warn("[GITHUB WEBHOOK] Rejected delivery: missing or invalid signature");
        return res.status(401).send('Invalid signature for GitHub webhook');
    }
    // Check GitHub event type since several other events, aside from GitHub app installations, also have `action: "created"` too;
    // Ignore those other event types.
    const event = req.headers['x-github-event'];

    // Guard clause to make sure the event occurrence is actually a GitHub app installation.
    // If it's not an 'installation' event, then exit this POST request early!
    if (event !== 'installation') {
        console.log("[GITHUB WEBHOOK] Ignoring event type:", event);
        return res.status(200).send('Ignored');
    }

    console.log("[GITHUB WEBHOOK DEBUG] Received webhook request");
    // console.log("[GITHUB WEBHOOK DEBUG] Headers:", Object.keys(req.headers));
    // console.log("[GITHUB WEBHOOK DEBUG] Body keys:", Object.keys(req.body));

    try {
        if (!req.headers) {
            throw new Error("GitHub-app listener endpoint failed to be created.");
        }

        const installationId = req.body.installation?.id;
        const action = req.body.action;

        console.log("[GITHUB WEBHOOK DEBUG] Parsed installation ID:", installationId, "Action:", action);

        if (action === 'created') {
            // Workspace mapping is saved by the OAuth callback; the webhook has no state to match on.
            console.log("[GITHUB WEBHOOK] Installation create:", installationId);
            return res.status(200).send('200 OK');

        } else if (action === 'deleted') {
            const slackWorkspaceId = await getSlackTeamIdByInstallationId(String(installationId));
            if (slackWorkspaceId) {
                console.log("[GITHUB WEBHOOK DEBUG] Removing stale installation for workspace:", slackWorkspaceId);
                await deleteInstallationId(slackWorkspaceId, String(installationId));
            } else {
                console.warn("[GITHUB WEBHOOK DEBUG] No workspace mapping found for deleted installation:", installationId);
            }
            res.status(200).send('200 OK');
            return;
        } else {
            console.log("[GITHUB WEBHOOK DEBUG] Unhandled action:", action);
            res.status(200).send('200 OK');
        }
    } catch (err) {
        console.error("[GITHUB WEBHOOK DEBUG] Error in webhook handler:", err);
        res.status(500).send('500 Internal server error');
    }
});