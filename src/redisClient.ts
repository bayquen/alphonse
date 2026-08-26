import { createClient } from 'redis';
import dotenv from "dotenv";

dotenv.config();

const username = process.env.REDIS_CLOUD_USERNAME;
const password = process.env.REDIS_CLOUD_PASSWORD;
const host = process.env.REDIS_CLOUD_HOST;
const port = process.env.REDIS_CLOUD_PORT;

if (!username || !password || !host || !port) {
    throw new Error("Missing Redis Cloud environment variables.");
}

export const redisClient = createClient({
    username,
    password,
    socket: {
        host,
        port: Number(port),
        // tls: true,       // TODO: Getting errors when tls mode is on. Might need Socket Mode so that bot works 24/7.
    }
});

// Universal Redis connect function with validation check
export async function redisConnect() {
    // VALIDATION: Make sure redis Client isn't already open!
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
}