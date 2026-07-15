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

const fileKeywords = [".md", ".asc", ".mdx", ".txt", ".rst", ".adoc", ".yaml", ".yml", ".asciidoc", ".xml", ".csv", "README", "CHANGELOG", "LICENSE", "architecture", "CODE_OF_CONDUCT", "codeOfConduct"];

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
    const url = new URL(repoUrl.trim());
    const [, owner, repoName] = url.pathname.split("/");

    if (!owner || !repoName ) {
        console.log("\nUh oh, an error occurred during inspectGitHubRepo() execution:\nowner and/or repo name not found when parsing GitHub URL.\n");
        return;
    };

    // If repo name has '.git' extension, remove it to normalize the repo name
    const repo = repoName.replace(/\.git$/, "");

    const { data } = await octokit.repos.get({ owner: owner, repo: repo });
    
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

export async function getGitHubRepoTree(repoUrl: string) {
    // Grab repository metadata again, as needed
    const metadata = await inspectGitHubRepo(repoUrl);
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
    
    // Now, call this Octokit request function to retrieve
    const repoTreeData = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner,
        repo,
        tree_sha,  // branch name or repo's tree SHA
        recursive: "1",
    });

    // Return the actual file objects in the repo tree directly all together (not iteratively);
    return repoTreeData.data.tree;
}

export async function filterThruRepoFileTree(cleanedUrl: string) {
    let desiredTechDocObjects: object[] = [];
    // Parse through GitHub repo's files; PASS IN cleaned-up GitHub URL only!
    const fileObjects = await getGitHubRepoTree(cleanedUrl);
    if (!fileObjects) {
        console.error("Error: File objects not found.");
        return;
    }
    // Check if a given file object is a technical doc of interest

    for (const object of fileObjects) {
        // But first, split object's filepath string for filtering
        const parts = object.path.split("/");
        const fileNameItself = parts[parts.length - 1];
        if (!fileNameItself) {
            // Jump to next loop iteration if it doesn't exist
            continue;
        }
        // Check for file types of interest
        // else if (fileNameItself.includes(".md")) {
        //     desiredTechDocObjects.push(object);
        // }
        // Case insensitive keyword-matching helper, yay!
        const keywordMatches = fileKeywords.some(fileKeyword => fileNameItself.toLowerCase().includes(fileKeyword));
        // If any match is found, add file object to the return array.
        if (keywordMatches) {
            desiredTechDocObjects.push(object);
        }
    }
    for (const [index, object] of desiredTechDocObjects.entries()) {
        console.log(`Doc object ${index + 1}:\n`, object, "\n");
    }
    
    return desiredTechDocObjects;
}

// Local, non-integrated test for debugging:
// const exampleUrl: string = "https://github.com/bayquen/dibsdash";
// inspectGitHubRepo(exampleUrl);

// Local, non-integrated test for debugging:
// const repoUrl: string = "https://github.com/bayquen/dibsdash";
// const getTree = await getGitHubRepoTree(repoUrl);
// if (!getTree) {
//     console.log("No data was returned");
// } else {
//     console.log(getTree);
// }
