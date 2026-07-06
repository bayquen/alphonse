/** 
* Author: Brandon Bayquen
* Program: app.ts
* Purpose: To run the Slack Bolt app that activates the RTFM Agent Slack bot.
* Converted from app.js => app.ts for TypeScript consistency and production-grade code.
* Just run: `npm run build` and then `node dist/app.js` (NOTE THE .js replacement)
*/

import { App } from "@slack/bolt";
import dotenv from "dotenv";
import OpenAI from "openai";
import { retrieveRelevantChunks } from "./retrieval.js";
import { createClient } from "redis";

dotenv.config();

const openAIAPIKey = process.env.OPENAI_API_KEY;
if (!openAIAPIKey) {
    throw new Error("Missing OPENAI_API_KEY");
}
const openAIClient = new OpenAI({
    apiKey: openAIAPIKey,
});


const username = process.env.REDIS_CLOUD_USERNAME;
const password = process.env.REDIS_CLOUD_PASSWORD;
const host = process.env.REDIS_CLOUD_HOST;
const port = process.env.REDIS_CLOUD_PORT;
if (!username || !password || !host || !port) {
    throw new Error("Missing Redis Cloud environment variables.");
}
// Connect and login to Redis Cloud
export const redisClient = createClient({
    username,
    password,
    socket: {
        host,
        port: Number(port),
        tls: true,
    }
});
// Return and handle any error gracefully BEFORE Redis Client attempts to connect(); Otherwise, Slack bot could miss an event
// or end up with an unhandled error.
redisClient.on('error', err => console.log('Uh oh, a Redis Client Error has occurred:\n', err));


const token = process.env.SLACK_BOT_TOKEN;
const appToken = process.env.SLACK_APP_LEVEL_TOKEN;
if (!token || !appToken) {
    throw new Error("Missing Slack environment variables.");
}
// Initializes Slack Bolt app via Socket Mode with your Slack bot and app tokens
const app = new App({
    token,
    appToken,
    socketMode: true,
});

// For grabbing user ID of the RTFM Agent Slack bot;
// this is used a bit later to remove the bot mention-tag when extracting a Slack user's Q&A prompt.
const grabBotUserId = await app.client.auth.test({
    token,
});

// Listens to incoming messages that contain "hi bot"
// app.message("hi bot", async ({ message, say }) => {
//     // Add type guard to check if message has property called .user with JavaScript's `in` keyword
//     if (!("user" in message)) return;
//     // say() sends a message to the channel where the event was triggered
//     await say(`What's up my brotha <@${message.user}> from anotha motha?`);
// });

// Get and store RTFM bot's user ID; needed to remove bot mention tag from Slack user's message.
const botUserId = grabBotUserId.user_id;
console.log("Bot ID:", botUserId);

app.event("app_mention", async({ event, client, say }) => {
    try {
        // Debugging log
        // console.log(textMessage, "\n");

        const botMention = `<@${botUserId}>`;
        const slackUserPrompt = event.text
            .replace(botMention, "")
            .trim();
        if (!event.user) return;
        // const { user } = await client.users.info({ user: event.user });
        const res = await client.users.info({ user: event.user });
        if (!res.user) return;

        const slackUser = res.user;
        const userDisplayName = 
        slackUser.profile?.display_name ||
        slackUser.real_name ||
        slackUser.name;
        
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
        const finalPrompt: string = systemPrompt
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


async function askLLM(finalPrompt: string) {
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