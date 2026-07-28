import { Queue } from 'bullmq';
import { Redis } from "ioredis";

// Create a separate IORedis connection to BullMQ (not shared with node-redis)
const bullConnection = new Redis({
    host: process.env.REDIS_HOST,
    port: 6379,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
});

export interface RepoIngestJobData {
    repoUrl: string,
    slackTeamId: string,
    slackChannelId: string,
    slackUserId: string,
}

export const repoIngestQueue = new Queue<RepoIngestJobData>(
    "repo-ingest",
    {
        connection: bullConnection,
        defaultJobOptions: {
            attempts: 3,
            removeOnComplete: 100,
            removeOnFail: 50,
        },
    }
);
