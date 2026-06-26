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
app.event("app_mention", async({ event, say, client, message }) => {
    const textMessage = event.text
    // const channelId = event.channel;
    // const threadTs = event.ts;

    try {
        // Debugging log
        // console.log(textMessage, "\n");

        const botMention = `<@${botUserId}>`;
        const slackUserPrompt = event.text
            .replace(botMention, "")
            .trim();
        const { user } = await client.users.info({ user: event.user });
        const userDisplayName = user.profile.display_name || user.real_name || user.name;
        
        // Debugging log
        // console.log("Cleaned up user prompt:", slackUserPrompt);

        // If user pings bot with NO message, notify user with a call-to-action
        if (slackUserPrompt.trim() === "") {
            // Edge case: Check to make sure user's display name exists or isn't empty
            if (userDisplayName != null && userDisplayName.trim() !== "") {
                // Have the Slack bot ping the user and respond with this message 
                await say(`Howdy @${userDisplayName}, I'm here to help with any questions for your product's technical docs. Make sure to provide a prompt while mentioning me :)`)
                return;
            // Edge case (continued): If by any rare chance the user's display name is empty or can't be read, send alternate message
            } else {
                await say(`Howdy, I'm here to help with any questions for your product's technical docs. Make sure to provide a prompt while mentioning me :)`)
            }
        }
    } catch (error) {
        console.log("Uh oh, an error has occurred:", error);
    }
});

// TODO: Make bot reply in thread rather than an individual message on Slack - keeps Slack Q&A convos organized!
// [CODE HERE]
// ...

(async () => {
    // Start your app
    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
})();