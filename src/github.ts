// Author: Brandon Bayquen
// Program: `github.ts`
// Purpose: A dedicated module for inspecting a valid GitHub repository via its URL.
//          This checks to see the repo's credentials and its visibility (if private, 
//          then the repo needs authentication from admin/owner).
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({
    // auth: "secret123"
    userAgent: 'myApp v1.2.3',
});

interface RepositoryInfo {
    owner: string;
    repo: string;
    fullName: string;
    isPrivate: boolean;
    defaultBranch: string;
    htmlUrl: string;
    lastPushedAt: string;
  }

// Check if GitHub repo exists, and if so then grab relevant metadata needed for authentication
export async function inspectGitHubRepo(repoUrl: string) {
    const url = new URL(repoUrl);
    const [, owner, repo] = url.pathname.split("/");

    if (!owner || !repo ) {
        console.log("Error: owner and/or repo name not found when parsing GitHub URL.");
        return;
    };

    const { data } = await octokit.repos.get({ owner: owner, repo: repo });
    // Debugging log (stringify() includes pretty print params)
    console.log("GitHub Repo data:\n" + JSON.stringify(data.owner.name, null, 2) + "\n" + JSON.stringify(data.owner, null, 2));
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

// Local, unintegrated test:
const exampleUrl: string = "https://github.com/bayquen/dibsdash";
inspectGitHubRepo(exampleUrl);