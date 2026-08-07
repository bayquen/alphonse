import express from "express";  // Node.js third-party web framework!
import { redisClient } from "./../redisClient.js";
import { parseGitHubInstallationWebhook } from "./../github.js";

const expressApp = express();
expressApp.use(express.json());

// Creates an endpoint in my (bayquen's) created GitHub app that listens for GitHub app installation by another user
try {
    expressApp.post('/github/webhook', async (req, res) => {
        if (!req.headers) {
            throw new Error("GitHub-app listener endpoint failed to be created.");
        }

        // Get workspace ID from query params (passed in the install URL)
        // [side note: State query is used here because the webhook itself doesn't know which Slack workspace initiated the GitHub 
        // app installation. Normally, a state query is useful for apps that don't support webhooks, but it's needed here.]
        const slackWorkspaceId = req.query.state as string;

        // [side: We need to store installation ID, otherwise we'd have no way to associate the installation with the right Slack workspace.]
        const { installationId, action } = parseGitHubInstallationWebhook(req.body, req.headers['x-hub-signature']!);
        if (action === 'created') {  // Installation created
            // TODO: Save given installation ID to Redis
            await redisClient.set(`github:installation:${slackWorkspaceId}`, installationId)  // Will be passed inside of an install link
            res.status(200).send('OK');
        }
    });
} catch (err) {
    console.log(err);
}