import pgvector from "pgvector/pg";
import { pgPool } from "./pgClient.js"

interface LinearChunkEmbedding {
    identifier: string;
    chunkText: string;
    embedding: number[];
}

export async function storeLinearVectors(
    chunks: LinearChunkEmbedding[],
    slackTeamId: string,
    issueId: string,
) {
    const client = await pgPool.connect();
    try {
        await client.query("BEGIN");

        // Clear old chunks for this issue first; This handles edits that shrink
        // or reorder chunk boundaries, so we never leave stale rows behind.
        await client.query(
            "DELETE FROM linear_chunks WHERE slack_team_id = $1 AND issue_id = $2",
            [slackTeamId, issueId],
        );
        // Loops over every chunk produced for a given Linear issue and inserts one row per chunk.
        for (const chunk of chunks) {
            await client.query(
                `INSERT INTO linear_chunks (slack_team_id, issue_id, identifier, chunk_text, embedding)
                VALUES ($1, $2, $3, $4, $5)`,
                [slackTeamId, issueId, chunk.identifier, chunk.chunkText, pgvector.toSql(chunk.embedding)],
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