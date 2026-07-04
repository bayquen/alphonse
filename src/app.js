import { App } from "@slack/bolt";
import dotenv from "dotenv";
import OpenAI from "openai";
import { retrieveRelevantChunks } from "./retrieval.ts";
import { createClient } from "redis";
// Note: When running my Slack Bolt app locally, make sure that I'm in my project root
//       Then run `node src/app.js`, since this program is in the /src directory

dotenv.config();

const openAIAPIKey = process.env.OPENAI_API_KEY;
const openAIClient = new OpenAI(openAIAPIKey);
// Connect and login to Redis Cloud
export const redisClient = createClient({
    username: process.env.REDIS_CLOUD_USERNAME,
    password: process.env.REDIS_CLOUD_PASSWORD,
    socket: {
        host: process.env.REDIS_CLOUD_HOST,
        port: process.env.REDIS_CLOUD_PORT,
        tls: true,
    }
});
// Return and handle any error gracefully BEFORE Redis Client attempts to connect(); Otherwise, Slack bot could miss an event
// or end up with an unhandled error.
redisClient.on('error', err => console.log('Redis Client Error', err));

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

app.event("app_mention", async({ event, client, say }) => {
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

        const systemPrompt = `You're a straightforward Q&A assistant. Answer user's question/prompt using only the provided context 
                    (i.e. the technical docs provided). Do NOT research an answer directly online. If context does not contain 
                    enough info to answer the user's question/prompt, then kindly let the user know honestly without making anything up.
                    Then quickly give the user a short call-to-action to ask questions only about technical docs that were shared (literally).`;
        const llmAnswerChunk = await retrieveRelevantChunks(slackUserPrompt);
        const retrievedContextForLLM = "Here is the relevant doc info you need to answer the user, denoted in triple ticks:"
                                        + "\n```"
                                        + llmAnswerChunk
                                        + "\n```";
        // Combine system, user, and retrieve chunk prompts together to pass to the LLM for bot text response
        const finalPrompt = systemPrompt
                            + `\n The user's prompt for you is: '${slackUserPrompt}`
                            + `\n ${retrievedContextForLLM}`
        // Call LLM response function (OpenAI API)
        const answer = await askLLM(finalPrompt);
        // Then have Slack bot answer back with the LLM response to the user!
        await say(answer);
        
    } catch (error) {
        console.log("Uh oh, an error has occurred during app_mention event:\n", error);
    }
});

// const slackUserPrompt = getSlackUserPrompt();

async function askLLM(finalPrompt) {
    const response = await openAIClient.responses.create({
        model: "o4-mini",
        input: finalPrompt,
    });

    return response.output_text;
}                   

// TODO: Make bot reply in thread rather than an individual message on Slack - keeps Slack Q&A convos organized!
// [CODE HERE]
// ...

(async () => {
    // Connect to Redis Client ONCE, first.
    await redisClient.connect();
    // Start Slack Bolt app
    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
})();