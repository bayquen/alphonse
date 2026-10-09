import dotenv from "dotenv";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
// Side note: convert `./redisClient.ts` to `./redisClient.js` since I'm using ES modules (ESM) with TypeScript, not CJS.
import { redisClient, redisConnect } from './redisClient.js';
import { queryLinearVectors } from './linearVectorStore.js';
import { escapeRedisTagValue } from './ingest.js';

// Connect to Redis client if it isn't already open; (with validation check)
redisConnect();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey });


function formatGitHubChunk(r: any, n: number): string {
    const section = [r.h1, r.h2, r.h3].filter(Boolean).join(" > ");
    const header = `[${n}] Source: GitHub | File: ${r.sourcePath || r.filename}`
        + (section ? ` | Section: ${section}` : "");
    return `${header}\n${r.chunkContent.trim()}`;
}

function formatLinearChunk(r: any, n: number): string {
    const header = `[${n}] Source: Linear | Issue: ${r.identifier}`
        + (r.issue_title ? ` | Title: ${r.issue_title}` : "");
    return `${header}\n${r.chunk_text.trim()}`;
}

export async function retrieveRelevantChunks(userPrompt: string, slackTeamId: string) {
    console.log("Redis Client open during retrieveRelevantChunks()?:", redisClient.isOpen);
    console.log("Redis Client ready during retrieveRelevantChunks()?:", redisClient.isReady);
    // Embed userPrompt with VoyageAI model via its API
    const response = await voyageClient.embed({
        input: userPrompt,
        model: "voyage-code-3"
    });
    // Store user prompt embedding to use only for retrieval process. Temporary; not stored directly in Redis index itself(?).
    const userQueryEmbedding = response.data?.[0]?.embedding;
    // Throw error if embedding was not made
    if (!userQueryEmbedding) {
        throw new Error("Uh oh, VoyageAI did not return a query embedding for the user's text prompt.");
    }
    // Search existing Redis vector index that was created during technical docs ingestion
    const [githubResults, linearResults] = await Promise.all([
        redisClient.ft.search(
            'vector_idx',
            // My Redis vector index uses HNSW algorithm, which is for K-Nearest (KNN) search.
            // `queryVector` is the parameter name (indicated by prefix '$'), where the float-32 embedding is passed.
            `(@slackTeamId:{${escapeRedisTagValue(slackTeamId)}})=>[KNN 5 @embedding $queryVector AS score]`,
            {
                PARAMS: {
                    queryVector: Buffer.from(new Float32Array(userQueryEmbedding).buffer),
                },
                SORTBY: "score",
                DIALECT: 2,
                // Return metadata and show top relevant chunk results based on KNN score so they can be inserted into the LLM prompt
                RETURN: ["chunkContent", "filename", "sourcePath", "h1", "h2", "h3", "score"],
            }
        ),
        queryLinearVectors(userQueryEmbedding, slackTeamId, 5),
    ]);

    if (!githubResults || typeof githubResults !== 'object' || !('documents' in githubResults) 
        || !Array.isArray(githubResults.documents)) {
        throw new Error("Invalid Github results structure");
    }

    const githubDocs = (githubResults.documents as Array<{ id: string; value: any }>);
    const snippets = [
        ...githubDocs.map((d, i) => formatGitHubChunk(d.value, i + 1)),
        ...linearResults.map((r, i) => formatLinearChunk(r, githubDocs.length + i + 1)),
    ];
    return snippets.join("\n\n---\n\n");

}
// TESTING: EXAMPLE STRING PROMPT TO TEST FUNCTIONALITY LOCALLY ON TERMINAL
// retrieveRelevantChunks(testPrompt);