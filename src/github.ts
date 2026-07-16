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

interface GitHubTreeObject {
    path: string;
    mode: string;
    type: string;
    sha: string;
    size?: number;
    url?: string;
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

export async function getRelevantTechDocObjects(cleanedUrl: string) {
    let relevantTechDocObjects: GitHubTreeObject[] = [];
    // Parse through GitHub repo's files; PASS IN cleaned-up GitHub URL only!
    const fileObjects = await getGitHubRepoTree(cleanedUrl);
    if (!fileObjects) {
        console.error("Error: File objects not found.");
        return;
    }
    // Filtering for relevant doc files:
    for (const object of fileObjects) {
        // But first, split object's filepath string for filtering
        const parts = object.path.split("/");
        const fileNameItself = parts[parts.length - 1];
        if (!fileNameItself) {
            // Jump to next loop iteration if it doesn't exist
            continue;
        }
        // Case insensitive keyword-matching helper, yay!
        const keywordMatches = fileKeywords.some(fileKeyword => fileNameItself.toLowerCase().includes(fileKeyword));
        // If any match is found, add file object to doc-object array
        if (keywordMatches) {
            relevantTechDocObjects.push(object);
        }
    }

    // for (const [index, object] of relevantTechDocObjects.entries()) {
    //     console.log(`Doc object ${index + 1}:\n`, object, "\n");
    // }

    const metadata = await inspectGitHubRepo(cleanedUrl);
    if (!metadata) {
        console.error("Uh oh, an error occurred during the getRelevantTechDocObjects() function call:\nNo metadata was retrieved from the provided repo");
        return;
    }
    const owner: string = metadata.owner;
    const repo: string = metadata.repo;

    for (const object of relevantTechDocObjects) {
        // Get the content itself within each file
        const response = await octokit.repos.getContent({
            owner,
            repo,
            path: object.path,
        });
        console.log("\nResponse content:\n", response, "\n\n");

        // Type guarding for response.data, then convert and store file text content
        if (!Array.isArray(response.data) && response.data.type === "file") {
            const rawFileContent = response.data.content;
            // Convert raw content into human-readable format (i.e. UTF-8)
            const content = Buffer.from(rawFileContent, "base64").toString("utf8");


            // Debugging logs
            // console.log("\nContent:\n");          
            // console.log(content);         
        }

        
    }

    return relevantTechDocObjects;

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
const exampleCleanedUrl = 'https://github.com/bayquen/dibsdash';
const getObjects = await getRelevantTechDocObjects(exampleCleanedUrl);
console.log(getObjects);