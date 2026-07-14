/** 
* Author: Brandon Bayquen
* Program: app.ts
* Purpose: To activate the RTFM Agent Slack bot via a Slack Bolt JS application.
* Converted from app.js => app.ts for TypeScript consistency and production-grade code.
* Just run: `npm run build` and then `node dist/app.js` (NOTE THE .js replacement)
*/

import { App } from "@slack/bolt";
import dotenv from "dotenv";
import OpenAI from "openai";
dotenv.config();
import { retrieveRelevantChunks } from "./retrieval.js";
import { redisClient } from "./redisClient.js";
import { InputTokens } from "openai/resources/responses.mjs";
import { stringify } from "@langchain/core/utils/uuid";
import { inspectGitHubRepo } from "./github.js";
import { getGitHubRepoTree } from "./github.js";

// API access for OpenAI (LLM) API
const openAIAPIKey = process.env.OPENAI_API_KEY;
if (!openAIAPIKey) {
    throw new Error("Missing OPENAI_API_KEY");
}
const openAIClient = new OpenAI({
    apiKey: openAIAPIKey,
});

// Tokens for accessing Slack Bolt functionalities
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
        const llmAnswer = await askLLM(finalPrompt);
        // Then have Slack bot answer back with the LLM response to the user!
        // await say(llmAnswer);
        const channel = event.channel;
        const text = llmAnswer;
        const thread_ts = event.ts;
        if ( !channel || !text || !thread_ts) {
            throw new Error("Within app_mention event function: Missing required param value(s) for client.chat.postMessage({})");
        }

        await client.chat.postMessage({
            channel,
            text,
            thread_ts,  // Makes sure that bot replies to user in a thread
        });
    } catch (error) {
        console.log("Uh oh, an error has occurred during app_mention event:\n", error);
    }
});

// Pass entire prompt (LLM system prompt, user's question, && relevant technical doc chunks) to LLM API so it can respond to Slack user
async function askLLM(finalPrompt: string) {
    const response = await openAIClient.responses.create({
        model: "o4-mini",
        input: finalPrompt,
    });
    // Messages the Slack user a Q&A answer!
    return response.output_text;
}

// Helper function for isGitHubRepoUrl() function: remove unwanted '<' and '>' symbols when passing user text as a URL object
function normalizeSlackUrl(input: string): string {
    const [url = ""] = input
        .trim()
        .replace(/^</, "")
        .replace(/>$/, "")
        .split("|");
    
    return url;
}

// Helper function for app.command("/add_repo") - checking if user's input is a valid GitHub URL
function isGitHubRepoUrl(input: string): boolean {
    try {
        // Debugging log
        console.log(`Raw input: "${input}"`);

        const normalizedInput = normalizeSlackUrl(input);

        // If no protocol is present, assume https://
        const normalizedUrl = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalizedInput)
        ? normalizedInput
        : `https://${normalizedInput}`;

        // Debugging log
        console.log("Normalized:", normalizedUrl);

        // Normalize URL with "https://" in it
        const url = new URL(normalizedUrl);

        // Debugging logs
        console.log("Hostname:", url.hostname);
        console.log("Pathname:", url.pathname);

        if (url.hostname !== "github.com") {
            return false;
        }

        const parts = url.pathname.split("/").filter(Boolean);
        // Debugging logs
        console.log("Parts:", parts);
        console.log("Length:", parts.length);

        // Check if URL contains at least 2 segments after the domain name; I.e: "github.com/[user]/[repo_name]/..."
        // E.g. valid URL: https://github.com/bayquen/rtfm-agent/
        // E.g. valid URL: https://github.com/bayquen/rtfm-agent/tree/main
        // E.g. valid URL: https://github.com/bayquen/rtfm-agent/tree/feature-branch

        return (url.hostname === "github.com" && parts.length >= 2);  // boolean should == true
    } catch (err) {
        console.log("Uh oh, an error has occurred during isGitHubRepoUrl() execution:\n", err);
        return false;
    }
}

app.command("/add_repo", async ({ command, ack, respond, say, logger }) => {
    // Acknowledge the command request right away, so 3000ms ping timeout doesn't occur.
    await ack();

    // If Slack user's /rtfm_add command DOESN'T contain a valid GitHub repo URL, then do nothing but return.
    const userTextInput = command.text.trim();
    if (!(isGitHubRepoUrl(userTextInput))) {
        say(`Command text you entered: ${userTextInput}`)
        say(`Invalid URL, kindly make sure the public or private repository exists and its URL formatting is correct.`);
        return;
    }

    await respond(
        "Request received. Checking repository accessibility..."
    );
    // Check repo access (is it public or private?) by using helper function from github.ts
    // Then returns GitHub repo metadata needed
    try {
        // IMPORTANT NOTE: `userTextInput` is a string that should be a GitHub repo URL!
        const gitHubRepoData = await inspectGitHubRepo(userTextInput);

        // Do an error check to see if the repo metadata actually exists, otherwise log error message and return nothing
        if (!gitHubRepoData) {
            console.log("Uh oh. Error occurred while running `app.command(/add_repo)`: The GitHub repo metadata failed to extract, or it doesn't exist.");
            await say(`Sorry, GitHub repo tech docs failed to extract. Please try running /add_repo again in a few seconds!`);
            return;
        }
        
        // Check if it's a public repository, then return repository files to download.
        if (!gitHubRepoData.isPrivate) { // false = public repo
            // TODO (7/11/26): Call my new function from github.ts!
            let desiredTechDocObjects = [];
            const fileObjects = await getGitHubRepoTree(userTextInput);
            for (const object in fileObjects) {
                desiredTechDocObjects.push(object);
            }
            console.log("Object 1:\n" + desiredTechDocObjects + "\n");
        }
    } catch (err) {
        console.error("Uh oh, error occurred during app.command() execution:\n" + err +"\n\n");
        await say(`An error occurred when attempting to inspect GitHub repo or extract the files.
                   \nPlease make sure the URL is correctly formatted or that the public or private repository still exists!
                   \nTHEN, please try running /add_repo again.`);
        return;
    }
});

(async () => {
    // Return and handle any error gracefully BEFORE Redis Client attempts to connect(); 
    // Otherwise, Slack bot could miss an event or end up with an unhandled error.
    redisClient.on('error', err => console.log('Uh oh, a Redis Client Error has occurred:\n', err));
    // Now connect to Redis Client before starting Slack Bolt app
    await redisClient.connect();
    // Debugging logs
    // console.log(redisClient.isOpen);   // should equal true
    // console.log(redisClient.isReady);  // should equal true
    // Start Slack Bolt app
    await app.start();
    app.logger.info("⚡️ Bolt app is running!");
})();