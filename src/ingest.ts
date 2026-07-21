import * as fs from 'fs';  // file-system module From NodeJS
import path from 'path';
import { MarkdownParser } from "markdown-parser";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { redisClient, redisConnect } from "./redisClient.js";
import type { SearchReply } from "@redis/search";
import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from 'redis';  // Redis imports for Redis v5.x.x
// Use CommonJS's (CJS) Node require() over ESM since VoyageAI (v0.2.1) module import for ESM is fkin broken.
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");
// import { getRelevantTechDocObjects, } from "./github.js";
import type { GitHubFileObject } from "./github.js";
// Interface type included here so that every data embedding (i.e. text chunks and other repo data) 
// retrieved by the Slack bot is only from the Workspace's installed repo 
// (security + privacy enforcement, AND user confusion reduction!!)
import type { IngestContext } from "./app.js";
import { randomUUID } from "crypto";  // UUID key-generator package; built directly into Node.js!

dotenv.config();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey});

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

// // Function for reading directory containing uploaded doc files (for now; TODO: read doc files from git repos or files shared by user)
// function readDocsDir(docsPath: string): Promise<string[]> {
//     return new Promise((resolve, reject) => {
//         fs.readdir(docsPath, (err, files) => {
//             if (err)
//                 reject(err);
//             else {
//                 // Prepend full path to each file (i.e. [directory path] + '/' + [file name])
//                 const filePaths = files.map(file => path.join(docsPath, file));
//                 resolve(filePaths);
//             }
//         });
//     });
// }

// // Function for reading a single file and create file object from it
// function createFileObject(filePath: string): Promise<FileObject> {
//     return new Promise((resolve, reject) => { 
//         // Asynchronously read files for server load efficiency (esp. for large-sized docs)
//         fs.readFile(filePath, 'utf8', (err, data) => {
//             if (err) {
//                 reject(err);
//             } else {
//                 // Create file object
//                 const metadata: FileObject = {
//                     type: "file",
//                     filename: path.basename(filePath),
//                     content: data,
//                     sourcePath: filePath
//                 };
//                 resolve(metadata);
//             }
//         });
//     });
// }

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

// Pipeline: (7/15/26) Refactored function that takes in GitHub repo file metadata objects, then
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
        // chunkLists.push(chunkedText);
    }
    // Return chunked-rows object array
    return allChunks;
}

export async function createEmbeddingVectorsFromChunks(allChunks: EmbeddedChunkData[], context: IngestContext ) {
    const slackTeamId = context.slackTeamId;
    // This function call deletes all existing vector embeddings in storage (I.E. CLEAR REPO DOC FILE STORAGE)
    // before storing all embeddings for newly instated GitHub repository!
    await deleteExistingWorkspaceVectors(slackTeamId);

    const BATCH_SIZE = 50;

    // EMBEDDINGS CREATION LOOP: VoyageAI client is used here 
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE)
        const response = await voyageClient.embed({
            model: "voyage-code-3",
            input: batch.map(chunk => chunk.chunkContent),
        });

        if (!response.data) {
            continue;
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
    // Debugging the new results of all chunked data objects:
    console.log(allChunks);
    console.log("\n\n\n");
    console.log("Printed current chunk data objects! \n")
    return allChunks;
}

// Private helper function for storing vector embeddings, Redis requires reading RAW BYTEs rather than a JSON array.
// Thus, this functionality is necessary!
function embeddingToBuffer(embedding: number[]): Buffer {
    // `Buffer.from` is a Node.js native method for creating buffers.
    return Buffer.from(new Float32Array(embedding).buffer);
}

// Private helper function for deleting all pre-existing Workspace tech-doc embeddings in the application's storage.
// This is used before Redis adds the new file data when user requests to save a new repo within the bot 
// application's integrated cloud storage.
async function deleteExistingWorkspaceVectors(teamId: string) {
    try {
        // Connect to Redis client if it isn't already open; (with validation check)
        redisConnect();

        const result = await redisClient.ft.search(
            "vector_idx",
            `@slackTeamId:{${teamId}}`
        ) as {
            total: number;
            documents: { id: string }[];
        };

        if (!result) {
            throw new Error("No resulting embeddings in the Redis vector index found.");
        }

        for (const doc of result.documents) {
            await redisClient.del(doc.id);
        }
    } catch (err) {
        console.log(err);
    }
}

// Pipeline: Store vector embeddings, chunk text, and their corresponding metadata in a Redis vector index
export async function storeVectorsAndChunkedMetadata(embeddedChunkObjects: EmbeddedChunkData[], context: IngestContext) {
    try {
        redisConnect();
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
        const indexes = await redisClient.ft._list();
        console.log(indexes);
    } catch (err) {
        // if (!err.message.includes('Index already exists')) {
        //     throw err;
        // } else {
        //     console.log("Redis vector index already exists.");
        // }
        console.error(err);
        return;
    }
    
    // Loop for storing embeddings inside Redis
    for (const [i, chunk] of embeddedChunkObjects.entries()) {
        // A string key is created for EACH embedding so that it can be properly accessed outside of 
        // this function's scope whenever an embedding needs to be deleted from storage.
        const embeddingKey = `chunk:${crypto.randomUUID()}`;
        // Skip current embedding store if not correct dimension.
        if (chunk.embedding.length !== 1024) {
            continue;
        }

        // One hash is set per chunked object. Hence, the for loop.
        await redisClient.hSet(`doc:${i + 1}`, {
            // Added Slack Workspace 'team ID' so that Slack bot ONLY accesses data within given Workspace's repo.
            // (SECURITY & PRIVACY enforcement!! Prevents legal issues, too)
            slackTeamId: context.slackTeamId,
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
        // Debugging log to check if embeddings, along with chunks + metadata, were successfully stored in Redis.
        // const stored = await redisClient.hGetAll(`doc:${i + 1}`);
        // console.log("Successfully stored:\n", stored);
    }

    // Close the Redis client manually, otherwise it stays open.
    await redisClient.quit();
}

// async function main() {
//     const chunkedResults = await chunkTextContent();
//     const embeddedChunkObjects = await createEmbeddingVectorsFromChunks(chunkedResults);
//     await storeVectorsAndChunkedMetadata(embeddedChunkObjects);

// }
// main();


// PRE-PRODUCTION TESTS to check if Redis vector index works and to verify if the correct data
// (i.e. chunk text, vector embeddings, and corresponding metadata) was stored.
async function tests() {
    // Connect to Redis client if it isn't already open; (with validation check)
    redisConnect();
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
//     redisConnect();
//     const flushing = await redisClient.flushAll();
//     console.log(flushing);
//     console.log("\nflushing done!");
//     redisClient.quit();
// }
// flush();