import { App } from "@slack/bolt";
import dotenv from "dotenv";

// Note: When running my Slack Bolt app locally, make sure that I'm in my project root
//       Then run `node src/app.js`, since this program is in the /src directory
dotenv.config();

// Initializes your app with your Slack app and bot token
const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    socketMode: true,
    appToken: process.env.SLACK_APP_LEVEL_TOKEN,
});

// Listens to incoming messages that contain "hi bot"
app.message("hi bot", async ({ message, say }) => {
    // say() sends a message to the channel where the event was triggered
    await say(`What's up my brotha <@${message.user}> from anotha motha?`);
});

// TODO: Slack event listener - Get Slack user's message when RTFM bot is mentioned (@)
app.event("app_mention", async ({ event, client, logger }) => {
    try {
        const slackUserPrompt = event.text;
        if (event.user) {
            console.log(`${event.user} said: ${slackUserPrompt}`);
        }
    } catch (error) {
        logger.error(error);
    }
})

// TODO: Make bot reply in thread rather than an individual message on Slack - keeps Slack Q&A convos organized!
// [CODE HERE]
// ...

(async () => {
    // Start your app
    await app.start();

    app.logger.info("⚡️ Bolt app is running!");
})();