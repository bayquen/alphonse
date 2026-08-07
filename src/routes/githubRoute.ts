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