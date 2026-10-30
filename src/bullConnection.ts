import { Redis } from "ioredis";
import dotenv from "dotenv";

dotenv.config();

export type BullRole = "worker" | "producer";

export function createBullConnection(role: BullRole) {
    return new Redis({
        host: process.env.REDIS_CLOUD_HOST,
        port: Number(process.env.REDIS_CLOUD_PORT),
        username: process.env.REDIS_CLOUD_USERNAME,
        password: process.env.REDIS_CLOUD_PASSWORD,
        // Turn TLS on in production once my Redis plan supports it
        ...(process.env.REDIS_TLS === "true" ? { tls: {} } : {}),
        ...(role === "worker" 
            ? {maxRetriesPerRequest: null }
            : {maxRetriesPerRequest: 1, enableOfflineQueue: false }),
    });
}