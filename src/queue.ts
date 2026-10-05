import { Queue } from 'bullmq';
import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

// Create a separate IORedis connection to BullMQ (not shared with node-redis)
export const bullConnection = new Redis({
    host: process.env.REDIS_CLOUD_HOST,
    port: Number(process.env.REDIS_CLOUD_PORT),
    username: process.env.REDIS_CLOUD_USERNAME,
    password: process.env.REDIS_CLOUD_PASSWORD,
    maxRetriesPerRequest: null,
});

export interface RepoIngestJobData {
    repoUrl: string,
    slackTeamId: string,
    slackChannelId: string,
    slackUserId: string,
}
// TODO: Figure out the shape of Linear data object and what data is even needed. Check docs?
export interface LinearIngestJobData {
    slackTeamId: string,
    issueId: string,  // Linear issue ID
}

export const repoIngestQueue = new Queue<RepoIngestJobData>(
    "repo-ingest",
    {
        connection: bullConnection,
        defaultJobOptions: {
            // Max attempts before BullMQ cancels a given job. (TODO: REMEMBER to add code that deletes a job from the queue after it is cancelled.)
            attempts: 3,
            // Number of successfully completed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnComplete: 12,
            // Number of failed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnFail: 30,
        },
    }
);

export const privateRepoIngestQueue = new Queue<RepoIngestJobData>(
    "private-repo-ingest",
    {
        connection: bullConnection,
        defaultJobOptions: {
            // Max attempts before BullMQ cancels a given job. (TODO: REMEMBER to add code that deletes a job from the queue after it is cancelled.)
            attempts: 3,
            // Number of successfully completed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnComplete: 12,
            // Number of failed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnFail: 30,
        },
    }
)
// TODO (9/16/26): Create queue for Linear data ingestion, but use Postgres' pgvector extension instead of Redis Cloud
export const linearIngestQueue = new Queue<LinearIngestJobData>(
    "linear-app-ingest",
    {
        connection: bullConnection,
        defaultJobOptions: {
            // Max attempts before BullMQ cancels a given job. (TODO: REMEMBER to add code that deletes a job from the queue after it is cancelled.)
            attempts: 3,
            // Number of successfully completed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnComplete: 12,
            // Number of failed jobs to save in history logs (via Redis). Useful for debugging!
            removeOnFail: true,
        },
    }
)