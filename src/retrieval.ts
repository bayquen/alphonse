import dotenv from "dotenv";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
// Side note: convert `./redisClient.ts` to `./redisClient.js` since I'm using ES modules (ESM) with TypeScript, not CJS.
import { redisClient, redisConnect } from './redisClient.js';

// Connect to Redis client if it isn't already open; (with validation check)
redisConnect();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey });

export async function retrieveRelevantChunks(userPrompt: string) {
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
    const results = await redisClient.ft.search(
        'vector_idx',
        // My Redis vector index uses HNSW algorithm, which is for K-Nearest (KNN) search.
        // `queryVector` is the parameter name (indicated by prefix '$'), where the float-32 embedding is passed.
        '(*)=>[KNN 5 @embedding $queryVector AS score]',
        {
            PARAMS: {
                queryVector: Buffer.from(new Float32Array(userQueryEmbedding).buffer),
            },
            SORTBY: "score",
            DIALECT: 2,
            // Return metadata and show top relevant chunk results based on KNN score so they can be inserted into the LLM prompt
            RETURN: ["chunkContent", "filename", "sourcePath", "score"],
        }
    )
    // Debug log for vector search results
    // console.log("Results: \n\n");
    // console.log(JSON.stringify(results, null, 2));

    // Return resulting string of chunks
    return JSON.stringify(results, null, 2);
}
// TESTING: EXAMPLE STRING PROMPT TO TEST FUNCTIONALITY LOCALLY ON TERMINAL
// retrieveRelevantChunks(testPrompt);