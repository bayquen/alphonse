import * as fs from 'fs';  // file-system module From NodeJS
import path from 'path';
import { MarkdownParser } from "markdown-parser";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { redisClient, redisConnect } from "./redisClient.js";
import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from 'redis';  // Redis imports for Redis v5.x.x
// Use CommonJS's (CJS) Node require() over ESM since VoyageAI (v0.2.1) module import for ESM is fkin broken.
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
import type { GitHubFileObject } from "./github.js";
// Interface type included here so that every data embedding (i.e. text chunks and other repo data) 
// retrieved by the Slack bot is only from the Workspace's installed repo 
// (security + privacy enforcement, AND user confusion reduction!!)
import type { IngestContext } from "./app.js";
import { randomUUID } from "crypto";  // UUID key-generator package; built directly into Node.js!
// import { pgPool } from "./pgClient.js";

dotenv.config();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey});

// const pool = new Pool({
//     connectionString: process.env.SUPABASE_URL,
// });

interface FileObject {
    type: "file",
    filename: string;
    content: string;
    sourcePath: string;
}

interface MarkdownObject {
    type: "markdown",
    filename: string;
    content: string;
    paragraph: string;
    h1: string | null;
    h2: string | null;
    h3: string | null;
    sourcePath: string;
}

interface EmbeddedChunkData {
    slackTeamId: string;
    embeddingKey: string;
    chunkContent: string;
    embedding: number[];
    chunkIndex: number;
    filename: string;
    sourcePath: string;
    paragraph: string | null;
    h1: string | null;
    h2: string | null;
    h3: string | null;
}

export interface LinearIssueObject {
    type: "linear-issue";
    issueId: string;
    identifier: string;
    issueTitle: string;
    issueDescription: string;
    content: string;
}

export interface EmbeddedLinearIssueData {
    slackTeamId: string;
    embeddingKey: string;
    chunkContent: string;
    embedding: number[];
    chunkIndex: number;
    issueId: string;
    identifier: string;
    issueTitle: string;
    content: string;
}

// Pipeline: Parse any markdown doc files to extract headings (h1, h2, h3) and other metadata, then convert into
// file metadata objects. Enriches metadata to improve context for agent (vector) search.
async function extractMDHeadingsAndContent(
    fileObject: GitHubFileObject
 ): Promise<MarkdownObject[]> {
    const fileText = fileObject.content;

    const parser = new MarkdownParser();
    const nodes = parser.parse(fileText);

    let currentH1 = null;
    let currentH2 = null;
    let currentH3 = null;
    const results: MarkdownObject[] = [];

    for (const node of nodes) {
        if (node.type === "heading") {
            if (node.level === 1) {
                currentH1 = (node.children[0] as any).text;
            }
            else if (node.level === 2) {
                currentH2 = (node.children[0] as any).text;
            }
            else if (node.level === 3) {
                currentH3 = (node.children[0] as any).text;
            }
        } else if (node.type === "paragraph") {
            const paragraphText = (node.children[0] as any).text;

            const metadata: MarkdownObject = {
                type: "markdown",
                filename: fileObject.filename,
                content: fileObject.content,
                paragraph: paragraphText,
                h1: currentH1,
                h2: currentH2,
                h3: currentH3,
                sourcePath: fileObject.sourcePath
            };
            // Add resulting metadata into the results array
            results.push(metadata);
        }
    }
    // Return metadata results array
    return results;
}

// Pipeline: Read each GitHub file and create + return array of file metadata objects with their text so they can be chunked after
export async function extractFileObjects(githubFileObjects: GitHubFileObject[]): Promise<(GitHubFileObject | MarkdownObject)[]> {
    try {
        // const filePaths = await readDocsDir('/home/bayquen/projects/rtfm-agent/docs');
        // const fileObjects = await Promise.all(
        //     filePaths.map(filePath => createFileObject(filePath))
        // );
        
        let allRepoFileObjects: (GitHubFileObject | MarkdownObject)[] = [];
        let mdResults: MarkdownObject[] = []; 
        let mdFiles: GitHubFileObject[] = [];
        // Check if each file object is an .md file. If yes, then save into separate array 
        // for .md metadata extraction
        for (const object of githubFileObjects) {
            if (path.basename(object.sourcePath).split('.').pop()?.toLowerCase() == 'md') {
                mdFiles.push(object);
            } else {
                allRepoFileObjects.push(object);  // Else, save file object directly in end-results array
            }
        }
        // Extract .md metadata and save to end results array.
        // TODO: Time (and space?) complexity is O(n^2), I think. Figure out O(n) or O(nlog(n)) way to do this?
        for (const mdFile of mdFiles) {
            const extractedMDObjects = await extractMDHeadingsAndContent(mdFile);
            for (const object of extractedMDObjects) {
                allRepoFileObjects.push(object);
            }
        }
        // Function debugging logs
        // console.log(allRepoFileObjects);
        // console.log("\n\nMetadata object's type:", typeof(allRepoFileObjects));
        // console.log("\n\n");
        // console.log("Length of resulting metadata object array:", allRepoFileObjects.length);
        return allRepoFileObjects;
    } catch (err) {
        console.error('Error ingesting:\n');
        console.error(err);
        throw err;
    }
}

// Helper function: Check whether a given file object is a markdown file object or not, via it's unique property (i.e. type: "markdown").
function isMarkdownObject(object: GitHubFileObject | MarkdownObject): object is MarkdownObject {
    return object.type === "markdown";
}

// Pipeline: Refactored function that takes in GitHub repo file metadata objects, then
// splits + returns all file-text chunks in prep for vector embeddings extraction.
export async function chunkTextContent(fileObjects: (GitHubFileObject | MarkdownObject)[]) {
    // Token-aware text splitter, with added ~1.2x chunkSize multiplier since Voyage AI models use that ~1.2x more tokens 
    // than the OpenAI-based splitter (via LangChain library) used here.
    // Note that embedding model I'm using is voyage-code-3, which has a max context len. of 32k tokens.
    const splitter = new TokenTextSplitter({ encodingName: "cl100k_base", chunkSize: 480, chunkOverlap: 100 });
    let allChunks: EmbeddedChunkData[] = [];
    let chunkIndex: number = 1;
    for (const object of fileObjects) {
        // For given file text, split into chunks and save into an array
        const chunkedText = await splitter.splitText(object.content);
        for (const chunk of chunkedText) {
            if (object.type == "file") {
                let row: EmbeddedChunkData = {
                    // 'Slack Team ID' and 'Key' will be definitely set later, right before Redis stores each chunk!
                    slackTeamId: "",
                    embeddingKey: "",
                    chunkContent: chunk,
                    embedding: [],
                    chunkIndex: chunkIndex,
                    filename: object.filename,
                    sourcePath: object.sourcePath,
                    paragraph: "",
                    h1: "",
                    h2: "",
                    h3: "",
                }
                // Add current chunk data inside of rows
                allChunks.push(row);
            }
            // Check if object is a markdown object;
            // Passes when (object === MarkdownObject) === true ),
            if (isMarkdownObject(object)) {
                let row: EmbeddedChunkData = {
                    // 'Slack Team ID' and 'Key' will be definitely set later, right before Redis stores each chunk!
                    slackTeamId: "",
                    embeddingKey: "",
                    chunkContent: chunk,
                    embedding: [],
                    chunkIndex: chunkIndex,
                    filename: object.filename,
                    sourcePath: object.sourcePath,
                    paragraph: object.paragraph,
                    h1: object.h1,
                    h2: object.h2,
                    h3: object.h3,
                }
                // Add current chunk data row inside the return array
                allChunks.push(row);
            }
            // Increment chunkIndex after each chunk iteration of current file object
            chunkIndex += 1;        
        }
    }
    // Return chunked-rows object array
    return allChunks;
}


// Pipeline: Function specifically for Linear app content extraction as objects, then
// splits + returns all Linear text chunks in prep for vector embeddings extraction.
// (Separated from repo content extraction because Linear data is shaped differently 
// AND Postgres / Supabase DB is used for Linear data instead of Redis.)
// 
// Note (9/22/26): For now, only Linear Issue content will be extracted for minimum viable product.
export async function chunkLinearContent(linearIssueObjects: LinearIssueObject[], slackTeamId: string) {
    const splitter = new TokenTextSplitter({ encodingName: "cl100k_base", chunkSize: 480, chunkOverlap: 100 });
    let allChunks: EmbeddedLinearIssueData[] = [];
    let chunkIndex: number = 1;
    for (const object of linearIssueObjects) {
        const chunkedText = await splitter.splitText(object.content);
        for (const chunk of chunkedText) {
            let row: EmbeddedLinearIssueData = {
                // 'Slack Team ID', 'Key', and the embedding array may be set later, right before Supabase stores each chunk
                slackTeamId: "",
                embeddingKey: "",
                chunkContent: chunk,
                embedding: [],
                chunkIndex: chunkIndex,
                issueId: object.issueId,
                identifier: object.identifier,
                issueTitle: object.issueTitle,
                content: object.content,
            }
            // Increment chunkIndex after each chunk iteration of current Linear Issue object
            chunkIndex += 1;
            // Add chunk row into the array of all chunks
            allChunks.push(row);
        }

    }
    // Return chunked-rows object array
    return allChunks;
}

export async function createEmbeddingVectorsFromGitHubChunks(allChunks: EmbeddedChunkData[], slackTeamId: string) {
    const BATCH_SIZE = 50;
    // EMBEDDINGS CREATION LOOP: VoyageAI API is used here 
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE)
        // Debugging log
        console.log(`4a. Processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(allChunks.length / BATCH_SIZE)} (${batch.length} chunks)...`);

        const response = await voyageClient.embed({
            model: "voyage-code-3",
            input: batch.map(chunk => chunk.chunkContent),
        });
        
        // Debugging log
        console.log(`4b. Batch ${i / BATCH_SIZE + 1} embedding response received.`);

        if (!response.data) {
            throw new Error("VoyageAI returned no data for this batch of GitHub chunks.");
        }

        response.data.forEach((result, index) => {
            if (!result.embedding) {
                throw new Error(`No embedding returned for batch item ${index}`)
            }
            // Since we just type guarded result.embedding above, we know both that and batch[index].embedding is of the same type.
            // So we use the non-null assertion operator, '!', to assume the left side of the assignment is never null or undefined.
            batch[index]!.embedding = result.embedding;
        });

        // Debugging VoyageAI output:
        // console.log("Response embedding from VoyageAi", response);
    }
    return allChunks;
}

// As of 9/2026: Only creating and storing vectors for Linear Issue data; Linear Project data, etc. to be included after MVP.
export async function createEmbeddingVectorsFromLinearChunks(allLinearChunks: EmbeddedLinearIssueData[], slackTeamId: string) {
    // TODO: Delete existing workspace vectors for Linear data each time we initialize 
    // Linear team data into a workspace's storage
    // ... .

    const BATCH_SIZE = 50;
    // EMBEDDINGS CREATION LOOP: VoyageAI API is used here 
    for (let i = 0; i < allLinearChunks.length; i += BATCH_SIZE) {
        const batch = allLinearChunks.slice(i, i + BATCH_SIZE)
        // Debugging log
        console.log(`Processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(allLinearChunks.length / BATCH_SIZE)} (${batch.length} chunks)...`);

        const response = await voyageClient.embed({
            model: "voyage-code-3",
            input: batch.map(chunk => chunk.chunkContent),
        });
        
        // Debugging log
        console.log(`Batch ${i / BATCH_SIZE + 1} embedding response received.`);

        if (!response.data) {
            throw new Error("VoyageAI returned no data for this batch of Linear chunks.");
        }

        response.data.forEach((result, index) => {
            if (!result.embedding) {
                throw new Error(`No embedding returned for batch item ${index}`)
            }
            // Since we just type guarded result.embedding above, we know both that and batch[index].embedding is of the same type.
            // So we use the non-null assertion operator, '!', to assume the left side of the assignment is never null or undefined.
            batch[index]!.embedding = result.embedding;
        });

        // Debugging VoyageAI output:
        // console.log("Response embedding from VoyageAi", response);
    }
    // // Debugging the new results of all chunked data objects:
    // console.log(allLinearChunks);
    // console.log("\n\n\n");
    // console.log("Printed current Linear chunk data objects! \n")

    return allLinearChunks;
}

// Private helper function for storing vector embeddings, Redis requires reading RAW BYTEs rather than a JSON array.
// Thus, this functionality is necessary!
function embeddingToBuffer(embedding: number[]): Buffer {
    // `Buffer.from` is a Node.js native method for creating buffers.
    return Buffer.from(new Float32Array(embedding).buffer);
}

// Escapes characters that have special meaning inside a Redis TAG query (e.g. "-", ".", ":", spaces),
// so a value is always matched literally and can't change the query's structure.
// This basically prevents wrong matches, an error,
// or query data injection from occurring (i.e. someone who deliberately widens the query filter).
export function escapeRedisTagValue(value: string): string {
    return value.replace(/[^a-zA-Z0-9_]/g, "\\$&");
}

// Private helper function for deleting all pre-existing Workspace tech-doc embeddings in the application's storage.
// This is used before Redis adds the new file data when user requests to save a new repo within the bot 
// application's integrated cloud storage.
async function deleteExistingWorkspaceVectors(teamId: string) {
    const indexes = await redisClient.ft._list();
    // let offset = 0;
    const pageSize = 500;
    const MAX_PASSES = 1000;  // 1000 passes x 500 docs = up to 500,000 chunks per workspace
    let passes = 0;
    try {
        if (indexes.includes("vector_idx")) {
            // Connect to Redis client if it isn't already open; (with validation check)
            // await redisConnect();
            while (true) {
                if (passes >= MAX_PASSES) {
                    throw new Error(`Aborting delete for team ${teamId}: exceeded ${MAX_PASSES} passes.`);
                }
                passes += 1;

                const result = await redisClient.ft.search(
                    "vector_idx",
                    `@slackTeamId:{${escapeRedisTagValue(teamId)}}`,
                    {
                        LIMIT: {
                            from: 0,
                            size: pageSize,
                        },
                    }
                ) as {
                    total: number;
                    documents: { id: string }[];
                };

                if (!result) {
                    throw new Error("Something went wrong with the function call for vectors deletion.");
                }
                if (result.documents.length === 0) {
                    break;
                }
            
                const pipeline = redisClient.multi();
                for (const doc of result.documents) {
                    pipeline.del(doc.id);
                }

                await pipeline.exec();

                // offset += pageSize;
            }
        }
    } catch (err) {
        console.log(err);
        // Rethrow the error so that data ingestion actually stops (i.e. so any new vectors 
        // won't be stored next to stale ones) and the failure is visible.
        throw err;
    }
}

// Pipeline: Store vector embeddings, chunk text, and their corresponding metadata in a Redis vector index
export async function storeVectorsAndChunkedMetadata(embeddedChunkObjects: EmbeddedChunkData[], slackTeamId: string) {
    // First, delete any existing vectors here. That way, if Voyage fails, the old data stays (yay).
    await deleteExistingWorkspaceVectors(slackTeamId);
    try {
        const indexes = await redisClient.ft._list();
        // await redisConnect();
        if (!indexes.includes("vector_idx")) {
            console.log("\nCreating vector index...\n")
            await redisClient.ft.create('vector_idx', {
                'chunkContent': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'embedding': {
                    type: SCHEMA_FIELD_TYPE.VECTOR,
                    TYPE: 'FLOAT32',
                    ALGORITHM: SCHEMA_VECTOR_FIELD_ALGORITHM.HNSW,
                    DISTANCE_METRIC: 'L2',
                    DIM: 1024,
                },
                'slackTeamId': {
                    type: SCHEMA_FIELD_TYPE.TAG,
                },
                'embeddingKey': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'chunkIndex': {
                    type: SCHEMA_FIELD_TYPE.NUMERIC,
                },
                'filename': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'sourcePath': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'paragraph': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'h1': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'h2': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                },
                'h3': {
                    type: SCHEMA_FIELD_TYPE.TEXT,
                }
            }, {
                ON: 'HASH',
                PREFIX: 'doc:'
            });
        }
        // DEBUGGING LOG
        console.log("After FT.CREATE");
        console.log(indexes);
    } catch (err) {
        // if (!err.message.includes('Index already exists')) {
        //     throw err;
        // } else {
        //     console.log("Redis vector index already exists.");
        // }
        console.error(err);
        throw err;
    }
    
    const pipeline = redisClient.multi();
    // Loop for storing embeddings inside Redis
    for (const [i, chunk] of embeddedChunkObjects.entries()) {
        // // DEBUGGING LOG
        // console.log(`Writing ${i}`);
        // A string key is created for EACH embedding so that it can be properly accessed outside of 
        // this function's scope whenever an embedding needs to be deleted from storage.
        const embeddingKey = `chunk:${crypto.randomUUID()}`;
        // Skip current embedding store if not correct dimension.
        if (chunk.embedding.length !== 1024) {
            throw new Error(`Embedding has ${chunk.embedding.length} dimensions, but 1024 was expected.`)
        }

        // One hash is set per chunked object. Hence, the for loop. NOTE: doesn't need `await` keyword, since hSet() queues 
        // the command and doesn't execute it until pipeline.exec()
        pipeline.hSet(`doc:${slackTeamId}:${i + 1}`, {
            // Added Slack Workspace 'team ID' so that Slack bot ONLY accesses data within given Workspace's repo.
            // (SECURITY & PRIVACY enforcement!! Prevents legal issues, too)
            slackTeamId: slackTeamId,
            embeddingKey: embeddingKey,
            chunkContent: chunk.chunkContent,
            embedding: embeddingToBuffer(chunk.embedding),
            chunkIndex: chunk.chunkIndex,
            filename: chunk.filename,
            sourcePath: chunk.sourcePath,
            paragraph: chunk.paragraph ?? '',
            h1: chunk.h1 ?? '',
            h2: chunk.h2 ?? '',
            h3: chunk.h3 ?? '',
        });
        // // DEBUGGING LOG (7/21/26)
        // console.log(`Finished ${i}`);

        // Debugging log to check if embeddings, along with chunks + metadata, were successfully stored in Redis.
        // const stored = await redisClient.hGetAll(`doc:${i + 1}`);
        // console.log("Successfully stored:\n", stored);
    }
    await pipeline.exec();

    // Close the Redis client manually, otherwise it stays open.
    // await redisClient.quit();
}

// export async function storeLinearChunks(embeddedLinearObjects: EmbeddedLinearIssueData[], slackTeamId: string) {
//     for (const object of embeddedLinearObjects) {
//         try {
//             const vectorLiteral = `[${object.embedding.join(",")}]`;
//             await pgPool.query(
//                 `insert into linear_data_chunks (slack_team_id, issue_id, identifier, chunk_text, embedding)
//                 values ($1, $2, $3, $4, $5)
//                 on conflict (slack_team_id, issue_id, chunk_text)
//                 do update set embedding = excluded.embedding, updated_at = now()`,
//                 [slackTeamId, object.issueId, object.identifier, object.chunkContent, vectorLiteral],
//             )
//         } catch (err) {
//             console.error(err);
//         }
//     }
// }

// async function main() {
//     const chunkedResults = await chunkTextContent();
//     const embeddedChunkObjects = await createEmbeddingVectorsFromGitHubChunks(chunkedResults);
//     await storeVectorsAndChunkedMetadata(embeddedChunkObjects);

// }
// main();


// PRE-PRODUCTION TESTS to check if Redis vector index works and to verify if the correct data
// (i.e. chunk text, vector embeddings, and corresponding metadata) was stored.
async function tests() {
    // Connect to Redis client if it isn't already open; (with validation check)
    // await redisConnect();
    // Test: Verify if our vector index exists and if the correct data is stored in it
    const vectorIndex = await redisClient.ft.info('vector_idx');
    console.log(vectorIndex);
    // Test: Verify if one of my stored document keys exists and contains chunk text, metadata fields, and embedding vector
    const redisGetAll = await redisClient.hGetAll('doc:1');
    console.log("\n\n\n");
    console.log(redisGetAll);

    // Manually exit Redis client
    await redisClient.quit();
}

// tests();

// // WARNING: DO NOT USE THIS IN PRODUCTION, WHEN USERS ARE USING MY APPLICATION ALREADY!
// async function flush(){
//     await redisConnect();
//     const flushing = await redisClient.flushAll();
//     console.log(flushing);
//     console.log("\nflushing done!");
//     redisClient.quit();
// }
// flush();