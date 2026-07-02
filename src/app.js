import { App } from "@slack/bolt";
import dotenv from "dotenv";
import OpenAI from "openai";
import { retrieveRelevantChunks } from "./retrieval.ts";

const systemPrompt = `You're a straightforward Q&A assistant. Answer user's question/prompt using only the provided context 
                    (i.e. the technical docs provided). Do NOT research an answer directly online. If context does not contain 
                    enough info to answer the user's question/prompt, then kindly let the user know honestly without making anything up.
                    Then quickly give the user a short call-to-action to ask questions only about technical docs that were shared (literally).`;

// Note: When running my Slack Bolt app locally, make sure that I'm in my project root
//       Then run `node src/app.js`, since this program is in the /src directory
dotenv.config();
const openAIAPIKey = process.env.OPENAI_API_KEY;
const openAIClient = new OpenAI(openAIAPIKey);

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

async function getSlackUserPrompt() {
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
            return slackUserPrompt;
        } catch (error) {
            console.log("Uh oh, an error has occurred:", error);
        }
    });
}
const finalUserPrompt = getSlackUserPrompt();

const sampleUserPrompt = "How exactly do I merge commits and what is one advanced command for merging?"
const llmAnswerChunk = await retrieveRelevantChunks(sampleUserPrompt);
const retrievedContextForLLM = "Here is the relevant doc info you need to answer the user, denoted in triple ticks:"
                                + "\n```"
                                + llmAnswerChunk
                                + "\n```";

const finalPrompt = systemPrompt
                    + `\n The user's prompt for you is: '${sampleUserPrompt}`
                    + `\n ${retrievedContextForLLM}`

const response = await openAIClient.responses.create({
    model: "o4-mini",
    input: finalPrompt,
});

// TODO: Make bot reply in thread rather than an individual message on Slack - keeps Slack Q&A convos organized!
// [CODE HERE]
// ...

(async () => {
    // Start your app
    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
    // Debug logging for retrieved doc-chunk text and LLM response message
    console.log("Top relevant chunks cited:\n", llmAnswerChunk, "\n")
    console.log("Response:\n", response.output_text);
})();