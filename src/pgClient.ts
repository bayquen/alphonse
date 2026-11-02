import { Pool } from "pg";
import pgvector from "pgvector/pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.SUPABASE_CONNECTION_URL;
// Supabase SSL (security) enforcement; clients that try to connect without SSL certification are rejected
// (note: CA in this context stands for "Certificate Authority").
const caBase64 = process.env.SUPABASE_CA_CERT_BASE64;

if (!connectionString || !caBase64) {
    throw new Error("Missing Supabase URL env. variable or Supabase CA certificate env. variable");
}
// If the URL contains sslmode, node-postgres silently ignores our ssl settings below
if (/sslmode=|sslrootcert=/.test(connectionString)) {
    throw new Error("Remove sslmode/sslrootcert from SUPABASE_CONNECTION_URL; the ssl settings are configured in code.");
}

const ca = Buffer.from(caBase64, "base64").toString("utf8");

export const pgPool = new Pool({
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
});

// Register pgvector types once at startup, not per-connection
const client = await pgPool.connect();  // Gets single client from the pool at startup
pgvector.registerTypes(client);  // Registers pgvector types on it
client.release();  // Releases the client back to the pool


// pgPool.on("connect", async (client) => {
//     await pgvector.registerTypes(client);
// });
