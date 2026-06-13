import { App } from "@slack/bolt";
import path from "path";
import { fileURLToPath } from "url";
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
  await say(`What's up <@${message.user}>, my human from anotha brotha?`);
});

(async () => {
  // Start your app
  await app.start();

  app.logger.info("⚡️ Bolt app is running!");
})();