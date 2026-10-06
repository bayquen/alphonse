import dotenv from "dotenv";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
// Side note: convert `./redisClient.ts` to `./redisClient.js` since I'm using ES modules (ESM) with TypeScript, not CJS.
import { redisClient, redisConnect } from './redisClient.js';
import { queryLinearVectors } from './linearVectorStore.js';

// Connect to Redis client if it isn't already open; (with validation check)
redisConnect();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey });

// Escapes characters that have special meaning inside a Redis TAG query (e.g. "-", ".", ":", spaces),
// so a value is always matched literally and can't change the query's structure.
// This basically prevents wrong matches, an error,
// or query data injection from occurring (i.e. someone who deliberately widens the query filter).
function escapeRedisTagValue(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]/g, "\\$&");
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
                RETURN: ["chunkContent", "filename", "sourcePath", "score"],
            }
        ),
        queryLinearVectors(userQueryEmbedding, slackTeamId, 5),
    ]);

    // if (!githubResults || typeof githubResults !== 'object' || !('documents' in githubResults) 
    //     || !Array.isArray(githubResults.documents)) {
    //     throw new Error("Invalid Github results structure");
    // }

    // Initialize result arrays for chunked GitHub and Linear data as empty first
    // (EDGE CASE: Handle search results if NO relevant data for GitHub and/or Linear 
    //  is found at all based on the Slack user's question/prompt)
    let normalizedGitHubResults: any[] = [];
    let normalizedLinearResults: any[] = [];

    // NOTE: Normalize the results' formatting (from both GitHub and Linear)
    // into a common format so that the LLM knows where context came from.

    if (githubResults 
        && typeof githubResults == 'object'
        && 'documents' in githubResults 
        && Array.isArray(githubResults.documents)) {
        normalizedGitHubResults = (githubResults.documents as Array<{ id: string; value: any }>).map(r => ({
            source: "github",
            content: r.value.chunkContent,
            metadata: { filename: r.value.filename, sourcePath: r.value.sourcePath },
            score: r.value.score
        }));
    }

    if (linearResults && Array.isArray(linearResults) && linearResults.length > 0) {
        normalizedLinearResults = linearResults.map(r => ({
            source: "linear",
            content: r.chunk_text,
            metadata: { identifier: r.identifier },
            score: r.similarity
        }));
    }
    // Return merged, normalized results
    const mergedResults = [...normalizedGitHubResults, ...normalizedLinearResults];

    // Edge case: If no relevant results are found at all, return a message so the LLM knows what to do
    if (mergedResults.length === 0) {
        return JSON.stringify({ message: "No relevant docs or issues found for user's Q&A prompt" }, null, 2);
    }
    // Else, return relevant results for LLM to answer Q&A prompt
    return JSON.stringify(mergedResults, null, 2);
}
// TESTING: EXAMPLE STRING PROMPT TO TEST FUNCTIONALITY LOCALLY ON TERMINAL
// retrieveRelevantChunks(testPrompt);