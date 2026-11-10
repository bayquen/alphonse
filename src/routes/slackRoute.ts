import express from "express";
import { WebClient } from "@slack/web-api";
import type { CallbackOptions } from "@slack/oauth";
import { installer, SLACK_BOT_SCOPES, SLACK_REDIRECT_URI } from "../slackInstaller.js";

export const slackRouter = express.Router();

// Same scopes + redirect URI must be used when starting the flow and when finishing it.
const installOptions = { scopes: SLACK_BOT_SCOPES, redirectUri: SLACK_REDIRECT_URI };

function page(title: string, body: string): string {
    // Static text only; never interpolate user/query data here (would be an XSS risk).
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:sans-serif;max-width:40rem;margin:4rem auto;"><h1>${title}</h1><p>${body}</p></body></html>`;
}

const callbackOptions: CallbackOptions = {
    successAsync: async (installation, _opts, _req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; char_set=utf-8" });
        res.end(page(
            "Yippee! Alphonse is installed.",
            "Now head back to Slack and run <code>/add_repo &lt;your GitHub repo URL&gt;</code> to get started."
        ));

         // Best-effort welcome DM. A failure here must not affect the install itself.
         try {
            const botToken = installation.bot?.token;
            const installerUserId = installation.user.id;
            if (botToken && installerUserId) {
                await new WebClient(botToken).chat.postMessage({
                    channel: installerUserId,
                    text: "Hi, I'm Alphonse! Try `/add_repo <github repo url>` to teach me your repo, " +
                          "or `/add_linear_workspace` to connect Linear. Then invite me to a channel and @mention me.",
                });
            }
        } catch (err) {
            console.error("[SLACK OAUTH] Alphonse's Welcome DM (after his installation) failed:", err);
        }
    },

    failure: (error, _opts, _req, res) => {
        // Log the error code/message only. NEVER log req.query: it contains the secret OAuth `code`!
        console.error("[SLACK OAUTH] Alphonse install failed:", error.code, error.message);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page("Install failed", "Something went wrong installing Alphonse. Please try again from the install link."));
    },
};

slackRouter.get("/slack/install", async (req, res) => {
    try {
        await installer.handleInstallPath(req, res, {}, installOptions);
    } catch (err) {
        console.error("[SLACK INSTALL] Failed to start install:", err);
        if (!res.headersSent) res.status(500).send("Could not start install.");
    }
});

slackRouter.get("slack/oauth_redirect", async (req, res) => {
    try {
        await installer.handleCallback(req, res, callbackOptions, installOptions);
    } catch (err) {
        console.error("[SLACK OAUTH] Callback crashed:", err);
        if (!res.headersSent) res.status(500).send("Install failed.");
    }
});