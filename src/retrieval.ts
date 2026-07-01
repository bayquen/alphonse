import dotenv from "dotenv";
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
import { createClient } from 'redis';

dotenv.config();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey });

// const redisClient = new createClient();

export async function retrieveRelevantChunks(userPrompt: string) {
    // TODO: Embed userPrompt with VoyageAI model via its API
    const response = await voyageClient.embed({
        input: userPrompt,
        model: "voyage-code-3"
    });
    // Store prompt embedding
    const embedding = response.data?.[0]?.embedding;
    // TODO: Search existing Redis index that was made after technical docs ingestion
    // TODO: Retrieve top matching chunks along with any metadata needed (e.g. filename, headings, source path, etc.)
    // TODO: Return chunks (and optionally metadata) so they can be inserted into the LLM prompt
}