// Program: slackInstallationStore.ts
// Purpose: Contains helper functions for reading and storing Slack app installations for users' workspaces
// Used by: 

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Installation, InstallationQuery, InstallationStore } from "@slack/oauth";
import { pgPool } from "./pgClient.js";

// ---------- Encryption helpers ----------

// Load and validate the key once, at startup. AES-256 needs EXACTLY 32 bytes.
const keyBase64 = process.env.SLACK_TOKEN_ENCRYPTION_KEY;
if (!keyBase64) {
    throw new Error("Missing Slack token encryption key env. variable");
}
const ENCRYPTION_KEY = Buffer.from(keyBase64, "base64");
if (ENCRYPTION_KEY.length !== 32) {
    throw new Error("SLACK_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (generate with: openssl rand -base64 32)");
}

// Returns "iv:tag:ciphertext", each part base64-encoded
function encrypt(plaintext: string): string {
    const iv = randomBytes(12);  // fresh random IV every time; NEVER reuse with the same key
    const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();  // must be called AFTER final()
    return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(":");
}

function decrypt(payload: string): string {
    const parts = payload.split(":");
    if (parts.length !== 3) {
        throw new Error("Malformed encrypted Slack installation payload");
    }
    const [ivB64, tagB64, ctB64] = parts as [string, string, string];
    const decipher = createDecipheriv("aes-256-gcm", ENCRYPTION_KEY, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64")); // set BEFORE final(); wrong key/tampering throws here
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
    return plaintext.toString("utf8");
}

// ---------- Shared lookup ----------

// Which Slack ID identifies this installation? Org-wide (Enterprise Grid) installs are out of scope
// for Alphonse v1 (manifest has org_deploy_enabled: false), so we only support per-team installs.
function teamIdFromQuery(query: InstallationQuery<boolean>): string {
    if (query.isEnterpriseInstall || !query.teamId) {
        throw new Error("Org-wide (enterprise) Slack installs are not supported");
    }
    return query.teamId;
}

async function loadInstallation(slackTeamId: string): Promise<Installation<"v1" | "v2", boolean>> {
    const result = await pgPool.query(
        "select installation_encrypted from slack_installations where team_id = $1",
        [slackTeamId]
    );
    const row = result.rows[0];
    if (!row) {
        throw new Error(`No Slack installation found for team ${slackTeamId}`);
    }
    return JSON.parse(decrypt(row.installation_encrypted));
}

// ---------- The InstallationStore Bolt/@slack/oauth calls ----------
export const slackInstallationStore: InstallationStore = {
    async storeInstallation(installation) {
        if (installation.isEnterpriseInstall || !installation.team?.id) {
            throw new Error("Org-wide (enterprise) Slack installs are not supported");
        }
        const slackTeamId = installation.team.id;
        const encrypted = encrypt(JSON.stringify(installation));

        // The WHERE after (team_id) must match the partial unique index from db migration 004.
        await pgPool.query(
            `insert into slack_installations
            (team_id, enterprise_id, is_enterprise_install, bot_user_id, installation_encrypted)
         values ($1, $2, false, $3, $4)
         on conflict (team_id) where team_id is not null
         do update set
            enterprise_id = excluded.enterprise_id,
            bot_user_id = excluded.bot_user_id,
            installation_encrypted = excluded.installation_encrypted,
            updated_at = now()`,
        [slackTeamId, installation.enterprise?.id ?? null, installation.bot?.userId ?? null, encrypted]
        );
        console.log(`Stored Slack installation for team ${slackTeamId}`);
    },

    async fetchInstallation(query) {
        return loadInstallation(teamIdFromQuery(query));
    },
    async deleteInstallation(query) {
        const teamId = teamIdFromQuery(query);
        await pgPool.query("delete from slack_installations where team_id = $1", [teamId]);
        console.log(`Deleted Slack installation for team ${teamId}`);
    },
};

// Used by the worker, which only needs the bot token for a team.
export async function getBotTokenForTeam(slackTeamId: string): Promise<string> {
    const installation = await loadInstallation(slackTeamId);
    const token = installation.bot?.token;
    if (!token) {
        throw new Error(`Slack installation for team ${slackTeamId} has no bot token`);
    }
    return token;
}