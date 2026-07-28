import { Queue } from 'bullmq';
import { default as Redis } from "ioredis";

// Create a separate IORedis connection to BullMQ (not shared with node-redis)
const bullConnection = new Redis({
    host: "...",
    port: 6379,
    maxRetriesPerRequest: null,
});
