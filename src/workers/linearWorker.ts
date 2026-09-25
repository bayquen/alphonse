// Program: linearWorker.ts
// Author: Brandon Bayquen
// Purpose: A BullMQ + Redis background worker program for creating ingestion jobs
//          for Linear app data from a given organization/team. 
//          Each job filters and reads through Linear Issues -> extract data objects 
//          -> chunking -> embedding -> store in a Postgres database via Supabase

import { Job, Worker } from "bullmq";
import { bullConnection } from "./../queue.js";
import type { LinearIngestJobData } from "./../queue.js";
import { redisClient, redisConnect } from "./../redisClient.js";
import {
    chunkLinearContent,
    createEmbeddingVectorsFromLinearChunks } from "./../ingest.js";
import { getWorkspaceLinearIssues } from "./../linear.js";
import { storeLinearVectors } from "./../linearVectorStore.js";

const linearAppWorker = new Worker(
    "linear-app-ingest",
    async (job: Job<LinearIngestJobData>) => {
        // Reset lock to prevent stall timeouts during long operations
        job.updateProgress(0);
        // Makes sure to include needed input data that is passed within a BullMQ queue.add() built-in function call!
        const {
            slackTeamId,
            issueId,
        } = job.data;

        await redisConnect();

        const indexes = await redisClient.ft._list();
        // console.log("\n\n");
        // console.log(indexes);
        // console.log("\n\n");


        /* TODO (INSTRUCTIONS:  
        
        8. Wire into the pipeline:
        - queue.ts: fix linearIngestQueue (connection + defaultJobOptions, as
            discussed) — this part is still Redis/BullMQ, just for job queuing,
            unrelated to where vectors land.
        - src/workers/linearWorker.ts (new, mirroring redisWorker.ts): on job, call
            getLinearIssueById → chunkTextContent → createEmbeddingVectorsFromChunks →
            storeLinearVectors instead of the Redis storeVectorsAndChunkedMetadata.
        - Retrieval/answer path: wherever the bot currently does Redis FT.SEARCH for
            repo docs, add a call to queryLinearVectors and merge results before
            composing the answer.

        9. Sanity checks before wiring the worker:
        - Confirm embedding dimension matches the vector(1536) column (adjust the SQL
            if your model differs, e.g. 3072 for some models).
        - Test the SQL by hand in Supabase's SQL Editor with a fake embedding array
            first, so the worker isn't your first integration test.
        - Add SUPABASE_DB_URL to whatever .env.example/deployment secrets you keep in
            sync with REDIS_CLOUD_*.)
        */
        try {
            // const linearIssueData = await getLinearIssueById(slackTeamId, issueId);
            const linearIssueData = await getWorkspaceLinearIssues(slackTeamId);
            // TODO (9/22/26): Create a chunking function for Linear Issue data! Maybe inside ingest.ts
            const chunkData = await chunkLinearContent(linearIssueData, slackTeamId);
            // TODO (9/22/26): Create separate embedding extraction function for Linear chunks,
            //       since it needs to use Postgres (via Supabase DB) instead of Redis Cloud DB.
            const embeddings = await createEmbeddingVectorsFromLinearChunks(chunkData, slackTeamId);
            // TODO (9/22/26): Store resulting Linear data vectors inside my Supabase DB.
            // [Storage FUNCTION CALL HERE]
            
        } catch (err) {
            console.log("\nUh oh, error occurred during linearWorker (i.e. a Redis background worker) execution:\n");
            console.log(err);
            console.log("\n\n");
            throw err;
        }
    }
);

// BullMQ Job listeners that check when some queued job succeeds after execution OR fails during/before execution.
linearAppWorker.on('ready', () => {
    console.log("redisWorker: Worker is ready and listening for jobs!");
});
linearAppWorker.on('error', (err) => {
    console.log("redisWorker: Worker error:", err);
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
console.log("redisWorker: Worker initialization complete");

// await repoIngestQueue.obliterate({ force: true });