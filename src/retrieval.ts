import dotenv from "dotenv";
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
import { createClient } from 'redis';

export async function retrieveRelevantChunks(userPrompt: string) {
    // TODO: Embed userPrompt with VoyageAI model via its API
    
    // TODO: Search existing Redis index that was made after technical docs ingestion
    // TODO: Retrieve top matching chunks along with any metadata needed (e.g. filename, headings, source path, etc.)
    // TODO: Return chunks (and optionally metadata) so they can be inserted into the LLM prompt
}