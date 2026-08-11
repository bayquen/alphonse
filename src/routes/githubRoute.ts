import express from "express";
import { redisClient } from "./../redisClient.js";
import { parseGitHubInstallationWebhook } from "./../github.js";
import { saveInstallationId } from "./../githubInstallationStore.js";
import dotenv from "dotenv";

dotenv.config();

export const expressApp = express();
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: true }));

// GitHub OAuth callback - receives state (Slack workspace ID) and code
expressApp.get('/github/oauth/callback', async (req, res) => {
    console.log("[OAUTH DEBUG] Received OAuth callback");
    console.log("[OAUTH DEBUG] Query params:", req.query);

    try {
        const { state, code } = req.query;
        const slackWorkspaceId = state as string;

        if (!state || !code) {
            console.error("[OAUTH DEBUG] Missing state or code");
            return res.status(400).send('Missing state or code parameter');
        }

        if (!slackWorkspaceId || slackWorkspaceId.trim() === "") {
            console.error("[OAUTH DEBUG] Invalid workspace ID from state");
            return res.status(400).send('Invalid state parameter');
        }

        console.log("[OAUTH DEBUG] Got workspace ID from state:", slackWorkspaceId);
        console.log("[OAUTH DEBUG] Authorization code:", code);

        // Store the mapping temporarily so webhook handler can find it
        // The webhook will arrive shortly after user confirms installation
        await redisClient.setEx(
            `github:pending:${slackWorkspaceId}`,
            300, // 5 minutes expiry
            code as string
        );

        res.send(`✅ GitHub App authorized! You can close this window. Workspace: ${slackWorkspaceId}`);
    } catch (err) {
        console.error("[OAUTH DEBUG] Error in callback:", err);
        res.status(500).send('Authorization failed');
    }
});

// GitHub webhook - receives installation events
expressApp.post('/github/webhook', async (req, res) => {
    console.log("[WEBHOOK DEBUG] Received webhook request");
    console.log("[WEBHOOK DEBUG] Headers:", Object.keys(req.headers));
    console.log("[WEBHOOK DEBUG] Body keys:", Object.keys(req.body));

    try {
        if (!req.headers) {
            throw new Error("GitHub-app listener endpoint failed to be created.");
        }

        const { installationId, action } = parseGitHubInstallationWebhook(req.body, req.headers['x-hub-signature']!);
        console.log("[WEBHOOK DEBUG] Parsed installation ID:", installationId, "Action:", action);

        if (action === 'created') {
            // The webhook doesn't include state, so we need to find which workspace triggered it
            // Search for pending authorizations from recent OAuth callbacks
            const keys = await redisClient.keys('github:pending:*');
            console.log("[WEBHOOK DEBUG] Found pending keys:", keys);

            if (keys && keys.length > 0) {
                // Use the most recent one (in production, you'd want better matching)
                const workspaceKey = keys[keys.length - 1];
                if (workspaceKey) {
                    const slackWorkspaceId = workspaceKey.replace('github:pending:', '');

                    console.log("[WEBHOOK DEBUG] Associating installation with workspace:", slackWorkspaceId);
                    await saveInstallationId(slackWorkspaceId, installationId);
                    await redisClient.del(workspaceKey); // Clean up pending key

                    res.status(200).send('OK');
                    console.log("[WEBHOOK DEBUG] Successfully saved installation ID for workspace");
                    return;
                }
            }
            console.warn("[WEBHOOK DEBUG] No pending workspace found for installation");
            res.status(200).send('OK - no workspace mapping');
            return;
        } else {
            console.log("[WEBHOOK DEBUG] Unhandled action:", action);
            res.status(200).send('OK');
        }
    } catch (err) {
        console.error("[WEBHOOK DEBUG] Error in webhook handler:", err);
        res.status(400).send('Invalid signature');
    }
});
