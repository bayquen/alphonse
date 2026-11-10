// Author: Brandon Bayquen
// Program: slackInstaller.ts
// Purpose: The background workers must be able to import the Slack installtion store without importing app.ts,
//          which unnecessarily boots the whole bot. Hence, this separate program file.

import "dotenv/config";
import { InstallProvider } from "@slack/oauth";
import { slackInstallationStore } from "./slackInstallationStore.js";

export const installer = new InstallProvider({
  clientId: process.env.SLACK_CLIENT_ID!,
  clientSecret: process.env.SLACK_CLIENT_SECRET!,
  stateSecret: process.env.SLACK_STATE_SECRET!,
  authVersion: "v2",
  installationStore: slackInstallationStore, // Step 6
});
export const SLACK_BOT_SCOPES = ["app_mentions:read","chat:write","commands"]; // must match manifest
export const SLACK_REDIRECT_URI = `${process.env.SLACK_APP_BASE_URL}/slack/oauth_redirect`;