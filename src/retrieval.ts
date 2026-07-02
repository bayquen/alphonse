import dotenv from "dotenv";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
import { createClient } from 'redis';

dotenv.config();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey });

const redisClient = createClient();

// TESTING: EXAMPLE STRING PROMPT TO TEST FUNCTIONALITY LOCALLY ON TERMINAL
// const testPrompt: string = "How to make a new branch?";

export async function retrieveRelevantChunks(userPrompt: string) {
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
    // Search existing Redis index that was made after technical docs ingestion
    await redisClient.connect();
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
            // Return metadata and show top relevant results based on KNN score
            RETURN: ["chunkContent", "filename", "sourcePath", "score"],
        }
    )
    // Retrieve top matching chunks along with any metadata needed (e.g. filename, headings, source path, etc.)
    // Return chunks (and optionally metadata) so they can be inserted into the LLM prompt
    // Debug log for vector search results
    // console.log("Results: \n\n");
    // console.log(JSON.stringify(results, null, 2));

    // Return resulting string of chunks
    return JSON.stringify(results, null, 2);

    await redisClient.quit();
}
// TESTING: EXAMPLE STRING PROMPT TO TEST FUNCTIONALITY LOCALLY ON TERMINAL
// retrieveRelevantChunks(testPrompt);