import { Pool } from "pg";
import pgvector from "pgvector/pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.SUPABASE_URL;

if (!connectionString) {
    throw new Error("Missing Supabase URL environment variable with database login credential.");
}

export const pgPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});

// Register pgvector types once at startup, not per-connection
const client = await pgPool.connect();  // Gets single client from the pool at startup
pgvector.registerTypes(client);  // Registers pgvector types on it
client.release();  // Releases the client back to the pool


// pgPool.on("connect", async (client) => {
//     await pgvector.registerTypes(client);
// });
