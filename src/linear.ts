// Author: Brandon Bayquen
// Program: `linear.ts`
// Purpose: A dedicated module for authenticating against a Slack workspace's Linear account
//          (via OAuth2, workspace-level `actor=app` token) and pulling issue/comment/project
//          content that gets fed into the same chunk + embed pipeline as GitHub tech docs
//          (see ingest.ts), so the bot can answer "why did we decide X" questions.
import dotenv from "dotenv";
import { createHmac, timingSafeEqual } from "crypto";
import {
    getLinearAccessToken,
    saveLinearTokens,
    deleteLinearTokens,
} from "./linearInstallationStore.js";

dotenv.config();

const LINEAR_GRAPHQL_ENDPOINT = "https://api.linear.app/graphql";
const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

export interface LinearTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
}

export interface LinearIssueObject {
    type: "linear-issue";
    id: string;
    identifier: string;
    issueTitle: string;
    issueDescription: string;
    content: string;
}

// Generates the Linear OAuth authorization URL for a given Slack workspace.
// `actor=app` requests a workspace-level (app) token instead of a per-user token,
// so the bot gets access to all public teams without needing an individual to stay authenticated.
export function generateLinearAppAuthUrl(slackTeamId: string): string {
    const redirectUri = `${process.env.LINEAR_APP_BASE_URL}/linear/oauth/callback`;
    const params = new URLSearchParams({
        client_id: process.env.LINEAR_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "read",
        actor: "app",
        state: slackTeamId,
    });
    return `${LINEAR_AUTHORIZE_URL}?${params.toString()}`;
}

// Exchanges an OAuth authorization code (from the callback) for access + refresh tokens.
// Called by linearRoute.ts's /linear/oauth/callback handler.
export async function exchangeLinearOAuthCode(code: string): Promise<LinearTokenResponse> {
    const redirectUri = `${process.env.LINEAR_APP_BASE_URL}/linear/oauth/callback`;

    const response = await fetch(LINEAR_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.LINEAR_CLIENT_ID!,
            client_secret: process.env.LINEAR_CLIENT_SECRET!,
            redirect_uri: redirectUri,
            code,
            grant_type: "authorization_code",
        }),
    });

    if (!response.ok) {
        throw new Error(`Linear OAuth token exchange failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<LinearTokenResponse>;
}

// Refreshes an expired access token using the stored refresh token.
export async function refreshLinearAccessToken(refreshToken: string): Promise<LinearTokenResponse> {
    const response = await fetch(LINEAR_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: process.env.LINEAR_CLIENT_ID!,
            client_secret: process.env.LINEAR_CLIENT_SECRET!,
            refresh_token: refreshToken,
            grant_type: "refresh_token",
        }),
    });

    if (!response.ok) {
        throw new Error(`Linear OAuth token refresh failed: ${response.status} ${await response.text()}`);
    }
    return response.json() as Promise<LinearTokenResponse>;
}

// Checks whether a Slack workspace has an active Linear installation.
export async function checkLinearInstallation(slackTeamId: string): Promise<boolean> {
    const token = await getLinearAccessToken(slackTeamId, refreshLinearAccessToken);
    return !!token && token.trim() !== "";
}

// Minimal GraphQL request helper against Linear's API for a given Slack workspace's token.
// TODO: swap for the official `@linear/sdk` client if raw fetch + query strings get unwieldy.
async function linearGraphQLRequest<T>(slackTeamId: string, query: string, variables?: Record<string, unknown>): Promise<T> {
    const accessToken = await getLinearAccessToken(slackTeamId, refreshLinearAccessToken);
    if (!accessToken) {
        throw new Error("Linear App not installed for this Slack workspace!");
    }

    const response = await fetch(LINEAR_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error("Linear access token expired or invalid.");
        }
        throw new Error(`Linear GraphQL request failed: ${response.status} ${await response.text()}`);
    }

    const body = await response.json() as { data: T; errors?: unknown };
    if (body.errors) {
        throw new Error(`Linear GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    return body.data;
}

// Pulls all issues (with descriptions + comments) across the workspace's public teams.
// Feeds directly into the same chunk/embed pipeline as GitHub docs (see ingest.ts),
// tagged with `type: "linear-issue"` and `sourcePath: <identifier>` for retrieval metadata.
export async function getWorkspaceLinearIssues(slackTeamId: string): Promise<LinearIssueObject[]> {
    const query = `
        query WorkspaceIssues($cursor: String) {
            issues(first: 50, after: $cursor, orderBy: updatedAt, filter: { archivedAt: { null: true } }) {
                nodes {
                    id
                    identifier
                    title
                    description
                    comments {
                        nodes { body }
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor
                }
            }
        }
    `;

    interface Response {
        issues: {
            nodes: {
                id: string;
                identifier: string;
                title: string;
                description: string | null;
                comments: { nodes: { body: string }[] };
            }[];
            pageInfo: {
                hasNextPage: boolean;
                endCursor: string | null;
            }
        };
    }

    let cursor: string | null | undefined = undefined;
    let hasNextPage = true;
    let maxPages = 3;
    let pageCount = 1;
    // let linearIssueObjects: Response["issues"]["nodes"][number][] = [];
    let linearIssueObjects: LinearIssueObject[] = [];

    while (hasNextPage) {
        const data: Response = await linearGraphQLRequest<Response>(slackTeamId, query, { cursor });
        const pageInfo = data.issues.pageInfo;
        for (const node of data.issues.nodes) {
            const commentsText = node.comments.nodes.map((c) => c.body).join("\n\n");
            linearIssueObjects.push({
                type: "linear-issue" as const,
                id: node.id,
                identifier: node.identifier,
                issueTitle: node.title,
                issueDescription: node.description ?? "",
                content: [node.title, node.description ?? "", commentsText].filter(Boolean).join("\n\n"),
            });
        }
        cursor = pageInfo.endCursor;
        hasNextPage = pageInfo.hasNextPage;
        if (pageCount >= maxPages) {
            break;
        }
        pageCount += 1;
    }

    return linearIssueObjects;

}

// Fetches a single issue by ID - used when a webhook fires for a targeted re-ingest
// instead of re-pulling the entire workspace.
export async function getLinearIssueById(slackTeamId: string, issueId: string): Promise<LinearIssueObject | null> {
    const query = `
        query IssueById($id: String!) {
            issue(id: $id) {
                id
                identifier
                title
                description
                comments {
                    nodes { body }
                }
            }
        }
    `;

    interface Response {
        issue: {
            id: string;
            identifier: string;
            title: string;
            description: string | null;
            comments: { nodes: { body: string }[] };
        } | null;
    }

    const data = await linearGraphQLRequest<Response>(slackTeamId, query, { id: issueId });
    if (!data.issue) return null;

    const commentsText = data.issue.comments.nodes.map((c) => c.body).join("\n\n");
    return {
        type: "linear-issue" as const,
        id: data.issue.id,
        identifier: data.issue.identifier,
        issueTitle: data.issue.title,
        issueDescription: data.issue.description ?? "",
        content: [data.issue.title, data.issue.description ?? "", commentsText].filter(Boolean).join("\n\n"),
    };
}

// Verifies the `Linear-Signature` header (HMAC-SHA256 over the raw request body) so we
// only trust webhooks that actually came from Linear. Mirrors parseGitHubInstallationWebhook()
// in github.ts.
export function verifyLinearWebhookSignature(rawBody: string | Buffer, signature: string | string[] | undefined): boolean {
    const secret = process.env.LINEAR_WEBHOOK_SECRET!;
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!sig) return false;

    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");

    try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
        // Buffer length mismatch also means "not equal" - not a crash-worthy error.
        return false;
    }
}

// Parses a verified Linear webhook body into the fields we care about for re-ingestion.
export function parseLinearWebhookPayload(body: any) {
    const payload = typeof body === "string" ? JSON.parse(body) : body;

    return {
        action: payload.action as "create" | "update" | "remove",
        type: payload.type as string, // e.g. "Issue", "Comment", "Project", "ProjectUpdate", "Document"
        data: payload.data,
        webhookTimestamp: payload.webhookTimestamp as number,
    };
}

// LOCAL FUNCTION TESTS:
// const authUrl = generateLinearAppAuthUrl("T0123456");
// console.log(authUrl);
