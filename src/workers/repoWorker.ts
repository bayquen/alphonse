// Program: repoWorker.ts
// Author: Brandon Bayquen
// Purpose: A BullMQ + Redis background worker program for creating ingestion jobs
//          for GitHub repositories. 
//          Each job filters and reads relevant repo files -> extract data objects 
//          -> chunking -> embedding -> store in a Redis Cloud DB

import { Job, Worker } from "bullmq";
import { createBullConnection } from "../bullConnection.js";
import { runWorkerLifecycle } from "./lifecycle.js";
import type { RepoIngestJobData } from "../queue.js";
import { redisClient, redisConnect } from "../redisClient.js";
// import type { GitHubFileObject } from "./../github.js";
import { getRelevantTechDocObjects, getInstallationToken } from "../github.js";
import { extractFileObjects,
        chunkTextContent,
        createEmbeddingVectorsFromGitHubChunks,
        storeVectorsAndChunkedMetadata } from "../ingest.js";
import { notifyUser } from "../slackNotifier.js";

const connection = createBullConnection("worker");
// Fail fast at startup if Redis is unreachable; the host will restart the process
await redisConnect();

const repoWorker = new Worker(
    "repo-ingest",
    async (job: Job<RepoIngestJobData>) => {
        // Reset lock to prevent stall timeouts during long operations
        job.updateProgress(0);
        // Makes sure to include needed input data that is passed within a BullMQ queue.add() built-in function call!
        const {
            repoUrl,
            slackTeamId,
        } = job.data;

        await redisConnect();

        // Check repo access (is it public or private?) and gets an access token by using helper functions from github.ts
        // Then returns GitHub repo metadata needed
        try {
            const githubToken = job.name === "private-repo-ingest"
                ? await getInstallationToken(slackTeamId)
                : undefined;
            const githubMetadataObjects = await getRelevantTechDocObjects(repoUrl, githubToken);
            if (!githubMetadataObjects) {
                throw new Error("\nError: failed to extract any relevant GitHub-metadata file objects after running /add_repo\n");
            }
            // Pipeline for extracting and formatting relevant file objects, then passing those objects to extract embeddings, 
            // then embeddings to stored vectors + text chunks for chatbot tech-docs memory and accurate Q&A responses!!!
            const techDocObjects = await extractFileObjects(githubMetadataObjects);
            // // Debugging logs
            // console.log("\n\n");
            // let index = 0;
            // for (const obj of techDocObjects) {
            //     index += 1;
            //     console.log(`Object ${index}:\n`);
            //     console.log(obj);
            //     console.log("\n");
            // }

            const textChunks = await chunkTextContent(techDocObjects);
            // DEBUGGING LOG (7/21/26)
            console.log("\n 1. Starting embeddings...");
            const embeddings = await createEmbeddingVectorsFromGitHubChunks(textChunks, slackTeamId);
            console.log("\n\n4. Embeddings complete.");
            console.log("\n5. Starting Redis store...");
            await storeVectorsAndChunkedMetadata(embeddings, slackTeamId);

            console.log("6. Redis store complete.");

            console.log("7. Repo ingestion complete.");
            console.log("Redis pipeline execution complete.");

        } catch (err) {
            console.log("\nUh oh, error occurred during repoWorker (i.e. Redis background worker) execution:\n");
            console.log(err);
            console.log("\n\n");
            throw err;
        }
    },
    {
        connection,
        concurrency: Number(process.env.REPO_WORKER_CONCURRENCY ?? 1),
        lockDuration: 360_000,  // 360,000 / 1000 / 60 = 6 minutes in ms,
        maxStalledCount: 3,
    }
);

const repoName = (url: string) => url.split("/").pop() ?? url;
// BullMQ Job listeners that check when some queued job succeeds after execution OR fails during/before execution.
repoWorker.on('ready', () => {
    console.log("repoWorker: Worker is ready and listening for jobs!");
});
repoWorker.on('error', (err) => {
    console.log("repoWorker: Worker error:", err);
});

repoWorker.on('completed', async job => {
    console.log(`Job ${job.id} has completed!`);
    // console.log("Notifying Slack channel:", job.data.slackChannelId);  // TEST LOG
    await notifyUser(
        job.data.slackTeamId,
        job.data.slackUserId,
        `Hi! I've finished reading your repo, *${repoName(job.data.repoUrl)}*. Your team can now ask me questions! Try \`@Alphonse <prompt>\` in a channel I'm already invited in.\n
        For more comprehensive Q&A, you may also connect your Linear workspace by running \`/add_linear_workspace\` in a channel I'm already in and following the steps in the pop-up Linear page.`
    );
    // Removes job upon completion (I think this may override the 'removeOnComplete' param inside repoIngestQueue() definition)
    await job.remove();
});

repoWorker.on('failed', async (job, err) => {
    console.log(`Job ${job?.id ?? "<unknown>"} has failed with an error.`);
    if (!job) return;  // stalled jobs can arrive without a job object

    // Only notify after the LAST attemot, not on every retry
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;

    await notifyUser(
        job.data.slackTeamId,
        job.data.slackUserId,
        `I couldn't finish reading *${repoName(job.data.repoUrl)}*. Please check the repo URL, and then run \`/add_repo again.\``
    );
});

// Ensure that worker is ready BEFORE the module completes loading
await repoWorker.waitUntilReady();
console.log("repoWorker: Worker initialization complete");

runWorkerLifecycle("repoWorker", repoWorker, [
    () => redisClient.quit(),
    () => connection.quit(),
]);
