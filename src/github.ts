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
import { getInstallationId, saveInstallationId} from "./githubInstallationStore.js";


dotenv.config();

const octokit = new Octokit({
    // auth: "secret123"
    userAgent: 'myApp v1.2.3',
});

const githubApp = new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!,
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
            const authedOctokit = await githubApp.getInstallationOctokit(Number(installId)) as any;
            ({ data } = await authedOctokit.repos.get({ owner: owner, repo: repo }));
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

// REFACTORED: function to get GitHub documents via efficient `git clone` on backend server, which avoids any GitHub API request limit reaching.
export async function getRelevantTechDocObjects(cleanedUrl: string, githubToken?: string) {
    // If there's a GitHub token, that means a private repo needs to be authenticated by an owner or contributor with access rights.
    // Otherwise, the regular cleaned URL is used if it's a public repo.
    const cloneUrl = githubToken
    ? cleanedUrl.replace('https://', `https://x-access-token:${githubToken}@`)
    : cleanedUrl;

    let relevantTechDocObjects: GitHubFileObject[] = [];

    const execFileAsync = promisify(execFile);
    // Create a unique temp directory by appending random chars to the prefix "rtfm-repo"
    // This prevents directory collisions when multiple directories are made
    const cloneDirectory = await mkdtemp(
        path.join(tmpdir(), "rtfm-repo-")
    );
    // A repository root directory variable for later - named differently for better context
    const repoRoot = cloneDirectory;
    await execFileAsync("git", [
        "clone",
        "--depth=1",
        cloneUrl,  // Repository URL
        cloneDirectory,
    ]);

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
    await walk(repoRoot);
    return relevantTechDocObjects;
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
export function generateGitHubAppAuthUrl(slackTeamId: string): string {
    const redirectUri = `${process.env.GITHUB_APP_BASE_URL}/github/oauth/callback`;
    return `https://github.com/apps/${process.env.GITHUB_APP_NAME}/installations/new?state=${slackTeamId}&redirect_uri=${redirectUri}`;
}

// Helper function for private repos; executed inside githubRoute.ts program
export function parseGitHubInstallationWebhook(body: any, signature: string | string[]) {
    // TODO: Verify signature, validate event, return { installationId, action }
    const secret = process.env.GITHUB_APP_INSTALLATION_WEBHOOK_SECRET!;
    // Check if signature is an array of multiple header(?) strings, otherwise it's a single string 
    const sig = Array.isArray(signature) ? signature[0] : signature;

    // Verify HMAC-SHA256:
    const hash = createHmac('sha256', secret)
        .update(body)
        .digest('hex');
    // Signature must be SHA256 encoded.
    const expectedSignature = `sha256=${hash}`;
    // Secured method for checking if the actual and expected signature values are equal.
    try {
        timingSafeEqual(
            Buffer.from(sig!),
            Buffer.from(expectedSignature), 
        );
    } catch (err) {
        throw new Error('Webhook signature verification failed.');
    }

    // Parse body as JSON
    const payload = typeof body === 'string'
        ? JSON.parse(body)
        : JSON.parse(body.toString());
    
    if (payload.action !== 'created' && payload.action !== 'deleted') {
        throw new Error('Invalid installation action.');
    }

    const installationId = payload.installation?.id;
    const action = payload.action;
    
    if (!installationId) {
        throw new Error('Missing installation ID.');
    }

    return { installationId, action };
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
const exampleCleanedUrl = 'https://github.com/firecrawl/firecrawl';
const getObjects = await getRelevantTechDocObjects(exampleCleanedUrl);
// console.log(getObjects);