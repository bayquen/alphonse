import { Worker } from "bullmq";
import { bullConnection } from "./../queue.js";
import type { RepoIngestJobData } from "./../queue.js";
import { redisClient, redisConnect } from ".././redisClient.js";
import type { GitHubFileObject } from ".././github.js";
import { inspectGitHubRepo, getGitHubRepoTree, getRelevantTechDocObjects } from ".././github.js";
import { extractFileObjects, 
        chunkTextContent, 
        createEmbeddingVectorsFromChunks, 
        storeVectorsAndChunkedMetadata } from ".././ingest.js";

const repoWorker = new Worker(
    "repo-ingest",
    async (job) => {
        // Makes sure to include needed input data that is passed within a BullMQ queue.add() built-in function call!
        const {
            repoUrl,
            slackTeamId,
            slackChannelId,
            slackUserId,
        } = job.data;

        await redisConnect();

        const indexes = await redisClient.ft._list();
        console.log("\n\n");
        console.log(indexes);
        console.log("\n\n");

        // Check repo access (is it public or private?) by using helper function from github.ts
        // Then returns GitHub repo metadata needed
        try {
            const githubMetadataObjects = await getRelevantTechDocObjects(repoUrl);
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
            const embeddings = await createEmbeddingVectorsFromChunks(textChunks, slackTeamId);
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
            // await say(`An error occurred when attempting to inspect GitHub repo or extract the files.
            //         \nPlease make sure the URL is correctly formatted or that the public/private repository exists!
            //         \nTHEN, please try running /add_repo again.`);
            return;
        }
    },
    {
        connection: bullConnection,
    }
);