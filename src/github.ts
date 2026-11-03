// Author: Brandon Bayquen
// Program: `github.ts`
// Purpose: A dedicated module for inspecting a valid GitHub repository via its URL.
//          This checks to see the repo's credentials and its visibility (if private, 
//          then the repo needs authentication from admin/owner).
import { Octokit } from "@octokit/rest";
import { App } from "@octokit/app";
// import * as fs from 'fs';  // file-system module From NodeJS
import dotenv from "dotenv";
import fs from "node:fs/promises";

import { Dirent } from "node:fs";
import path from "path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "child_process";
import { promisify } from "util";
import { timingSafeEqual, createHmac } from "crypto";
import { getInstallationId, 
    deleteInstallationId,
    createInstallState
} from "./githubInstallationStore.js";


dotenv.config();

const octokit = new Octokit({
    // auth: "secret123"
    userAgent: 'myApp v1.2.3',
});

const githubAppPrivateKeyBase64 = process.env.GITHUB_APP_PRIVATE_KEY_BASE64;
if (!githubAppPrivateKeyBase64) {
    throw new Error("Missing GitHub App (base64) private key.");
}
const githubAppPrivateKey = Buffer.from(githubAppPrivateKeyBase64, "base64").toString("utf8");

const githubApp = new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: githubAppPrivateKey,
    Octokit,
});

// Sets for filtering out unwanted files (i.e. which have certain filenames OR file extensions), and directories.
// Note: Sets are more efficient than arrays for membership lookup (NOT ITERATION) - O(1) average for sets VS. O(n) for lists
const UNWANTED_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".ico",
    ".pdf",
    ".zip",
    ".exe",
    ".dll",
]);
const UNWANTED_DIRECTORIES = new Set([
  // Version control
  ".git",

  // Dependencies
  "node_modules",
  "vendor",
  "packages-cache",

  // Build outputs
  "dist",
  "build",
  "out",
  "bin",
  "obj",
  "target",
  "release",
  "debug",

  // Framework-specific build folders
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".angular",
  ".expo",
  ".parcel-cache",

  // Python
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "env",
  ".eggs",

  // Java / Kotlin / Gradle
  ".gradle",

  // Rust
  "target",

  // C / C++
  "cmake-build-debug",
  "cmake-build-release",
  "CMakeFiles",

  // Coverage / test artifacts
  "coverage",
  ".coverage",
  ".nyc_output",
  "htmlcov",

  // Logs
  "logs",
  "log",

  // Temporary files
  "tmp",
  "temp",
  ".tmp",
  ".cache",
  ".sass-cache",

  // IDE / editor
  ".idea",
  ".vscode",
  ".vs",

  // OS metadata
  ".Trash",
  ".Spotlight-V100",
  ".fseventsd",

  // Package manager caches
  ".yarn",
  ".pnpm-store",
  ".npm",

  // Documentation generators
  "_site",
  ".docusaurus",

  // Terraform
  ".terraform",

  // Docker / Dev Containers
  ".devcontainer",

  // Serverless
  ".serverless",
  ".aws-sam",

  // Misc generated
  "generated",
  "__generated__",
  "gen",
]);
const UNWANTED_FILENAMES = new Set([
  // Dependency lockfiles
  "package-lock",
  "yarn.lock",
  "pnpm-lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "Podfile.lock",

  // Logs
  "npm-debug",
  "yarn-error",
  "yarn-debug",

  // OS metadata
  ".DS_Store",
  "Thumbs.db",
  "Desktop.ini",

  // Git internals
  "HEAD",
  "ORIG_HEAD",
  "FETCH_HEAD",
  "MERGE_HEAD",
  "COMMIT_EDITMSG",

  // Vim swap files
  ".swp",
  ".swo",
]);

export interface GitHubFileObject {
    type: string,
    filename: string;
    content: string;
    sourcePath: string;
}

// Check if public GitHub repo exists, and if so then grab relevant metadata needed for authentication
export async function inspectGitHubRepo(repoUrl: string, slackTeamId?: string) {
    const url = new URL(repoUrl.trim());
    if (url.protocol !== "https:" || url.hostname !== "github.com") {
        console.log("inspectGitHubRepo(): rejected a non-github.com URL.");
        return;
    }
    const [, owner, repoName] = url.pathname.split("/");

    if (!owner || !repoName ) {
        console.log("\nUh oh, an error occurred during inspectGitHubRepo() execution:\nowner and/or repo name not found when parsing GitHub URL.\n");
        return;
    };
    // If repo name has '.git' extension, remove it to normalize the repo name
    const repo = repoName.replace(/\.git$/, "");

    let data;
    if (slackTeamId) {  // For private repos
        const installIdExists = await checkGitHubAppInstallation(slackTeamId);
        if (installIdExists) {
            const installId = await getInstallationId(slackTeamId);
            try {
                const authedOctokit = await githubApp.getInstallationOctokit(Number(installId));
                ({ data } = await authedOctokit.repos.get({ owner: owner, repo: repo }));
            } catch (err: any) {
                if (err?.status === 404) {
                    // Installation was removed on GitHub's side but our cache didn't know - self-heal by clearing it.
                    await deleteInstallationId(slackTeamId, String(installId));
                    throw new Error("GitHub App not installed for this Slack workspace!");
                }
                throw err;
            }
        } else {
            throw new Error("GitHub App not installed for this Slack workspace!");
        }
    } else {
        ({ data } = await octokit.repos.get({ owner: owner, repo: repo }));
    }
    
    // Debugging log (stringify() includes pretty print params)
    // console.log("\nGitHub Repo data:\n" + JSON.stringify(data.owner.name, null, 2) + "\n" + JSON.stringify(data.owner, null, 2)) + "\n\n";

    // Return object filtered with only the metadata that my app needs for GitHub authentication
    return {
        owner,
        repo,
        fullName: data.full_name,
        isPrivate: data.private,
        defaultBranch: data.default_branch,
        htmlUrl: data.html_url,
        pushedAt: data.pushed_at,
    };
}
// Check if private GitHub repo exists
export async function inspectPrivateGitHubRepo(repoUrl: string) {
    // TODO (8/3/26): Separate private-repo auth via a remote GitHub app that connects to Slack user/org's GitHub repo.

    const url = new URL(repoUrl.trim());
    const [, owner, repoName] = url.pathname.split("/");

    if (!owner || !repoName ) {
        console.log("\nUh oh, an error occurred during inspectGitHubRepo() execution:\nowner and/or repo name not found when parsing GitHub URL.\n");
        return;
    };

    // If repo name has '.git' extension, remove it to normalize the repo name
    const repo = repoName.replace(/\.git$/, "");

    // TODO IMMED: How do I integrate my GitHub app to authenticate user for read access to private repo?
    // const installationToken = await githubApp.getInstallationOctokit(installationId);
}

// Helper: Mints a short-lived (~1 hour) token that lets git clone repos the app is installed on.
export async function getInstallationToken(slackTeamId: string): Promise<string> {
    const installId = await getInstallationId(slackTeamId);
    if (!installId) throw new Error("GitHub App not installed for this Slack workspace!");
    const auth = await githubApp.octokit.auth({
        type: "installation",
        installationId: Number(installId),
    }) as { token: string };
    return auth.token;
}

export async function getGitHubRepoTree(repoUrl: string, slackTeamId: string) {
    // Grab repository metadata again, as needed
    const metadata = await inspectGitHubRepo(repoUrl, slackTeamId);
    // the function call for `metadata` right above is not guaranteed to return any data, 
    // so print an error log if so and return nothing gracefully.
    if (!metadata) {
        console.error("Uh oh, an error occurred during the getGitHubRepoTree() function call:\nNo metadata was retrieved from the provided repo");
        return;
    }
    // Type guarding for octokit.request(...) params
    const owner: string = metadata.owner;
    const repo: string = metadata.repo;
    const tree_sha: string = metadata.defaultBranch;

    const repoTree = await octokit.git.getTree({
        owner,
        repo,
        tree_sha,  // branch name or repo's tree SHA
        recursive: "true",
    });

    // Return the actual file objects in the repo tree directly all together (not iteratively);
    const files = repoTree.data.tree.filter(item => item.type === "blob");
    let index = 0;
    // // Debugging logs
    // for (const file of files) {
    //     console.log(`File object ${index + 1}:\n`)
    //     console.log(file);
    //     console.log(`\n`);
    //     index += 1;
    // }
    return files;
}

// HELPER FUNCTION for getRelevantTechDocObjects()
// Purpose: Validates a given 'entry' (i.e. either a Dirent file object or Dirent directory object)
//          to check if it's not irrelevant for our Q&A technical docs.
//          It returns true if the entry object is irrelevant (i.e., unwanted).
function shouldSkipEntry(entry: Dirent): boolean {
    // If current entry is a directory folder object
    if (entry.isDirectory()) {
        // Check if it's an unwanted directory and return a boolean
        return UNWANTED_DIRECTORIES.has(entry.name);
    }
    // Else, current entry must be a file object itself
    else {
        // Check if it's an unwanted file and return a boolean
        const ext = path.extname(entry.name).toLowerCase();
        return (UNWANTED_FILENAMES.has(entry.name) || UNWANTED_EXTENSIONS.has(ext));
    }
}

// Builds a safe clone URL from a user-supplied URL, or returns null if it isn't a plain github.com repo URL.
function buildGitHubCloneUrl(userUrl: string, githubToken?: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(userUrl.trim());
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") return null;

    const [owner, rawRepo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !rawRepo) return null;
    const repo = rawRepo.replace(/\.git$/, "");

    // GitHub names only contain letters, digits, "_", "." and "-"
    const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;
    if (!SAFE_NAME.test(owner) || !SAFE_NAME.test(repo)) return null;

    const auth = githubToken ? `x-access-token:${githubToken}@` : "";
    return `https://${auth}github.com/${owner}/${repo}.git`;
}

const CLONE_TIMEOUT_MS = 5 * 60 * 1000; // give up on a clone after 5 minutes
// REFACTORED: function to get GitHub documents via efficient `git clone` on backend server, which avoids any GitHub API request limit reaching.
export async function getRelevantTechDocObjects(cleanedUrl: string, githubToken?: string) {
    // If there's a GitHub token, that means a private repo needs to be authenticated by an owner or contributor with access rights.
    // Otherwise, the regular cleaned URL is used if it's a public repo.
    const cloneUrl =  buildGitHubCloneUrl(cleanedUrl, githubToken);
    if (!cloneUrl) {
        throw new Error("Not a valid github.com repository URL.");
    }

    const relevantTechDocObjects: GitHubFileObject[] = [];
    const execFileAsync = promisify(execFile);
    const cloneDirectory = await mkdtemp(path.join(tmpdir(), "rtfm-repo-"));
    const repoRoot = cloneDirectory;

    // Walk (i.e. parse thru) the repository and process each repo file
    async function walk(repoRoot: string) {
        const entries = await fs.readdir(repoRoot, {
            withFileTypes: true
        });
        for (const entry of entries) {
            const fullPath = path.join(repoRoot, entry.name)
            // VALIDATION: If helper function call returns boolean of true, then skip this entry because it's irrelevant 
            // (i.e., not useful / not a technical doc)
            if (shouldSkipEntry(entry)) {
                continue;
            }
            // Check if current validated entry is a subdirectory
            if (entry.isDirectory()) {
                // Walk through subdirectory [O(n^2) time, recursive]
                await walk(fullPath);
            } else {
                // Process the validated file object
                const content = await fs.readFile(fullPath, "utf8");
                const fileObject = {
                    type: "file",
                    filename: path.basename(fullPath),
                    content: content,
                    sourcePath: path.relative(repoRoot, fullPath)
                }
               // Push object!
               relevantTechDocObjects.push(fileObject);
            }
        }
    }
    try {
        // "--" tells git that everything after it is data, never an option
        await execFileAsync("git", ["clone", "--depth=1", "--", cloneUrl, cloneDirectory], {
            timeout: CLONE_TIMEOUT_MS,
        });
        await walk(repoRoot);
        return relevantTechDocObjects;
    } finally {
        // Always delete the temp folder, whether it's a success or failure
        await rm(cloneDirectory, { recursive: true, force: true }); 
    }
}
// Check if GitHub App is installed for a given Slack workspace
export async function checkGitHubAppInstallation(slackTeamId: string): Promise<boolean> {
    // TODO: Query your database/cache to check if workspace has an active GitHub App installation
    // For now, placeholder returns false to prompt auth flow
    const installId = await getInstallationId(slackTeamId);
    if (!installId || installId.trim() === "") {
        return false;
    } else {
        return true;
    }
}

// Generate GitHub App authorization URL for a Slack workspace (for private repos)
export async function generateGitHubAppAuthUrl(slackTeamId: string): Promise<string> {
    const state = await createInstallState(slackTeamId);
    const redirectUri = `${process.env.GITHUB_APP_BASE_URL}/github/oauth/callback`;
    return `https://github.com/apps/${process.env.GITHUB_APP_NAME}/installations/new?state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

// Helper function to verify an GitHub installation webhook's signature for security; 
// E.g., prevent malicious entities from prompting malicious execution.
export function verifyGitHubWebhookSignature(
    rawBody: Buffer | undefined,
    signatureHeader: string | string[] | undefined,
): boolean {
    const secret = process.env.GITHUB_APP_INSTALLATION_WEBHOOK_SECRET;
    if (!secret) {
        console.error("Github installation webhook secret is not set; rejecting Github webhook.");
        return false;
    }

    const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!rawBody || !sig) return false;

    const expectedSig = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

    const sigBuf = Buffer.from(sig, "utf8");
    const expectedBuf = Buffer.from(expectedSig, "utf8");

    // timingSafeEqual THROWS if lengths differ, so check first.
    if (sigBuf.length !== expectedBuf.length) return false;

    return timingSafeEqual(sigBuf, expectedBuf);
}

// LOCAL FUNCTION TESTS:
// TEST 1:
// const exampleUrl: string = "https://github.com/bayquen/dibsdash";
// inspectGitHubRepo(exampleUrl);

// TEST 2:
// const repoUrl: string = "https://github.com/bayquen/dibsdash";
// const getTree = await getGitHubRepoTree(repoUrl);
// if (!getTree) {
//     console.log("No data was returned");
// } else {
//     console.log(getTree);
// }

// TEST 3:
// const exampleCleanedUrl = 'https://github.com/firecrawl/firecrawl';
// const getObjects = await getRelevantTechDocObjects(exampleCleanedUrl);
// console.log(getObjects);