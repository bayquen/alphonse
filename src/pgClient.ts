import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString) {
    throw new Error("Missing Supabase URL environment variable with database login credential.");
}

export const pgPool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
});
