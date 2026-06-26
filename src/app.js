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

const grabBotUserId = await app.client.auth.test({
    token: process.env.SLACK_BOT_TOKEN
});

// Get and store RTFM bot's user ID; needed to remove bot mention tag from Slack user's message.
const botUserId = grabBotUserId.user_id;
console.log("Bot ID:", botUserId);

// Listens to incoming messages that contain "hi bot"
app.message("hi bot", async ({ message, say }) => {
    // say() sends a message to the channel where the event was triggered
    await say(`What's up my brotha <@${message.user}> from anotha motha?`);
});

// TODO: Slack event listener - Get Slack user's message when RTFM bot is mentioned (@)
app.event("app_mention", async({ event, client, message }) => {
    const user = event.user
    const textMessage = event.text
    const channelId = event.channel;
    const threadTs = event.ts;

    console.log(textMessage);

    const botMention = `<@${botUserId}>`;
    const slackUserPrompt = event.text
        .replace(botMention, "")
        .trim();
    
    // Edge case: Check if user added any text at all, after mentioning the bot
    if (!slackUserPrompt) {
        await say(`Hi @${event.user}, please ask a question or prompt when mentioning me.`)
        return;
    }
    
    console.log(slackUserPrompt);
});

// TODO: Make bot reply in thread rather than an individual message on Slack - keeps Slack Q&A convos organized!
// [CODE HERE]
// ...

(async () => {
    // Start your app
    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
})();