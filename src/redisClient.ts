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
        tls: true,
    }
});