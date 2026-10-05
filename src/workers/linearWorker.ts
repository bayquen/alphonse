// Program: linearWorker.ts
// Author: Brandon Bayquen
// Purpose: A BullMQ (Redis) background worker program for creating ingestion jobs
//          for Linear app data from a given organization/team. 
//          Each job filters and reads through Linear Issues -> extract data objects 
//          -> chunking -> embedding -> store in a Postgres database via Supabase

import { Job, Worker } from "bullmq";
import { bullConnection } from "./../queue.js";
import { redisConnect } from "./../redisClient.js";
import type { LinearIngestJobData } from "./../queue.js";
import {
    chunkLinearContent,
    createEmbeddingVectorsFromLinearChunks } from "./../ingest.js";
import { getLinearIssueById } from "./../linear.js";
import { storeLinearVectors } from "./../linearVectorStore.js";

const linearAppWorker = new Worker(
    "linear-app-ingest",
    async (job: Job<LinearIngestJobData>) => {
        // Makes sure to include needed input data that is passed within a BullMQ queue.add() built-in function call!
        const { slackTeamId, issueId } = job.data;

        await redisConnect();

        try {
            const linearIssue = await getLinearIssueById(slackTeamId, issueId);
            if (!linearIssue) {
                console.log(`Issue ${issueId} not found for team ${slackTeamId}. Skipping now.`);
                return;
            }
            // Not required, but each .updateProgress() call publishes a progress event you 
            // can subscribe to or inspect in a monitoring UI later; Useful for seeing where
            // a job is stuck if embedding calls are slow.
            job.updateProgress(25);
            
            const chunkData = await chunkLinearContent([linearIssue], slackTeamId);
            job.updateProgress(50);

            const embeddedChunks = await createEmbeddingVectorsFromLinearChunks(chunkData, slackTeamId);
            job.updateProgress(75);

            await storeLinearVectors(embeddedChunks, slackTeamId, issueId);
            job.updateProgress(100);
        } catch (err) {
            console.log("\nUh oh, error occurred during linearWorker (i.e. a Redis background worker) execution:\n");
            console.log(err);
            console.log("\n\n");
            throw err;
        }
    },
    {
        connection: bullConnection,
        lockDuration: 600000,  // 600,000 / 1000 / 60 = 10 minutes in ms,
        lockRenewTime: 5000,  // 5 seconds in ms
    }
);

// BullMQ Job listeners that check when some queued job succeeds after execution OR fails during/before execution.
linearAppWorker.on('ready', () => {
    console.log("linearWorker: Worker is ready and listening for jobs!");
});
linearAppWorker.on('error', (err) => {
    console.log("linearWorker: Worker error:", err);
});

linearAppWorker.on('completed', async job => {
    console.log(`Job ${job.id} has completed!`);
    // Removes job upon completion
    await job.remove();
});

linearAppWorker.on('failed', (job, err) => {
    console.log(`Job ${job?.id ?? "<unknown>"} has failed with ${err.message}`);
});

// Ensure that worker is ready BEFORE the module completes loading
await linearAppWorker.waitUntilReady();
console.log("linearWorker: Worker initialization complete");
