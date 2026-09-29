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

pgPool.on("connect", async (client) => {
    await pgvector.registerTypes(client);
});
