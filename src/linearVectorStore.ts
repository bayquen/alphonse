import pgvector from "pgvector/pg";
import { pgPool } from "./pgClient.js"
import type { EmbeddedLinearIssueData } from "./ingest.js";

// interface LinearChunkEmbedding {
//     identifier: string;
//     chunkText: string;
//     embedding: number[];
// }

// Store new or updated Linear app data vectors via Postgres database (using Supabase as of 9/2026)
export async function storeLinearVectors(
    chunks: EmbeddedLinearIssueData[],
    slackTeamId: string,
    issueId: string,
) {
    const client = await pgPool.connect();
    try {
        await client.query("BEGIN");

        // Clear old chunks for this issue first; This handles edits that shrink
        // or reorder chunk boundaries, so we never leave stale rows behind.
        await client.query(
            "DELETE FROM linear_data_chunks WHERE slack_team_id = $1 AND issue_id = $2",
            [slackTeamId, issueId],
        );
        // Loops over every chunk produced for a given Linear issue and inserts one row per chunk.
        for (const chunk of chunks) {
            await client.query(
                `INSERT INTO linear_data_chunks (slack_team_id, issue_id, identifier, issue_title, chunk_text, embedding)
                VALUES ($1, $2, $3, $4, $5)`,
                // Note: pgvector's .toSql() function serializes the chunk array literal into a string input 
                // that Postgres can understand (i.e. its expected format).
                [slackTeamId, issueId, chunk.identifier, chunk.issueTitle, chunk.chunkContent, pgvector.toSql(chunk.embedding)],
            );
        }

        await client.query("COMMIT");
    } catch (err) {
        // Rollback any old chunk deletions and additions if an error occurs, then throw error so that BullMQ queue knows to try again
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

// Read stored vectors in the DB
// Note: queryEmbedding is the user's embedded text prompt (input) that is passed to the chosen LLM.
export async function queryLinearVectors(queryEmbedding: number[], slackTeamId: string, topK = 5) {
    // Here, query() is used instead of connect() because it's a single read-only statement,
    // so we can automatically check out an idle client from the pool, run a single query, 
    // then immediately return that client back to the pool with needing the client.release() call
    // (i.e. it's slightly more efficient).
    const { rows } = await pgPool.query(
        // side note: "<=>" is pgvector's cosine distance operator between two vectors; 
        // Smaller = more similar.
        // The actual nearest-neighbor search occurs in the 'ORDER BY' line, where all rows are
        // sorted by distance to the query vector, closest ones first. That's what makes this
        // semantic search in the first place!
        `SELECT identifier, issue_title, chunk_text, 1 - (embedding <=> $1) AS similarity
        FROM linear_data_chunks
        WHERE slack_team_id = $2
        ORDER BY embedding <=> $1
        LIMIT $3`,
        [pgvector.toSql(queryEmbedding), slackTeamId, topK],
        // side note: the 'WHERE' line scopes the search to a single Slack workspace's data,
        // so one team's Linear data never leaks into another team's Q&A answers!
    );

    return rows;
}