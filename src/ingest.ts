import * as fs from 'fs';  // file-system module From NodeJS
import path from 'path';
import { MarkdownParser } from "markdown-parser";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { TokenTextSplitter } from "@langchain/textsplitters";
import { redisClient } from "./redisClient.js";
import { SCHEMA_FIELD_TYPE, SCHEMA_VECTOR_FIELD_ALGORITHM } from 'redis';  // Redis imports for Redis v5.x.x
// Use CommonJS's (CJS) Node require() over ESM since VoyageAI (v0.2.1) module import for ESM is fkin broken.
const require = createRequire(import.meta.url);
const { VoyageAIClient, VoyageAIError } = require("voyageai") as typeof import("voyageai");

dotenv.config();

const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const voyageClient = new VoyageAIClient({ apiKey: voyageAPIKey});

// const redisClient = createClient();

interface FileMetadata {
    type: "file",
    filename: string;
    content: string;
    sourcePath: string;
}

interface MarkdownMetadata {
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

// Function for reading directory containing uploaded doc files (for now; TODO: read doc files from git repos or files shared by user)
function readDocsDir(docsPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        fs.readdir(docsPath, (err, files) => {
            if (err)
                reject(err);
            else {
                // Prepend full path to each file (i.e. [directory path] + '/' + [file name])
                const filePaths = files.map(file => path.join(docsPath, file));
                resolve(filePaths);
            }
        });
    });
}

// Function for reading a single file and create file object from it
function createFileObject(filePath: string): Promise<FileMetadata> {
    return new Promise((resolve, reject) => { 
        // Asynchronously read files for server load efficiency (esp. for large-sized docs)
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                // Create file object
                const metadata: FileMetadata = {
                    type: "file",
                    filename: path.basename(filePath),
                    content: data,
                    sourcePath: filePath
                };
                resolve(metadata);
            }
        });
    });
}

// Pipeline: Parse any markdown doc files to extract headings (h1, h2, h3) and other metadata, then convert into
// file metadata objects. Enriches metadata to improve context for agent (vector) search.
async function extractMDHeadingsAndContent(
    fileObject: FileMetadata
 ): Promise<MarkdownMetadata[]> {
    const fileText = fileObject.content;

    const parser = new MarkdownParser();
    const nodes = parser.parse(fileText);

    let currentH1 = null;
    let currentH2 = null;
    let currentH3 = null;
    const results: MarkdownMetadata[] = [];

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

            const metadata: MarkdownMetadata = {
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

// Pipeline: Read each file and create + return array of file metadata objects with their text to be chunked after
async function extractFileObjects(): Promise<(FileMetadata | MarkdownMetadata)[]> {
    try {
        const filePaths = await readDocsDir('/home/bayquen/projects/rtfm-agent/docs');
        const fileObjects = await Promise.all(
            filePaths.map(filePath => createFileObject(filePath))
        );
        
        let allMetadataObjects: (FileMetadata | MarkdownMetadata)[] = [];
        let mdResults: MarkdownMetadata[] = []; 
        let mdFiles: FileMetadata[] = [];
        // Check if each file object is an .md file. If yes, then save into separate array 
        // for .md metadata extraction
        for (const fileObject of fileObjects) {
            if (path.basename(fileObject.sourcePath).split('.').pop()?.toLowerCase() == 'md') {
                mdFiles.push(fileObject);
            } else {
                allMetadataObjects.push(fileObject);  // Else, save file object directly in end-results array
            }
        }
        // Extract .md metadata and save to end results array.
        // TODO: Time (and space?) complexity is O(n^2), I think. Figure out O(n) or O(nlog(n)) way to do this?
        for (const mdFile of mdFiles) {
            const extractedMDObjects = await extractMDHeadingsAndContent(mdFile);
            for (const object of extractedMDObjects) {
                allMetadataObjects.push(object);
            }
        }
        // Function debugging logs
        // console.log(allMetadataObjects);
        // console.log("\n\nMetadata object's type:", typeof(allMetadataObjects));
        // console.log("\n\n");
        // console.log("Length of resulting metadata object array:", allMetadataObjects.length);
        return allMetadataObjects;
    } catch (err) {
        console.error('Error ingesting:', err);
        throw err;
    }
}

// TODO (7/15/26): Refactor chunkTextContent() so that it takes in GitHub file objects as input data
// Pipeline: Split all doc file text into chunks in prep for vector embedding
export async function chunkTextContentOld() {
    const allFileObjects = await extractFileObjects();
    // Token-aware text splitter, with added ~1.2x chunkSize multiplier since Voyage AI models use that ~1.2x more tokens 
    // than the OpenAI-based splitter (via LangChain library) used here.
    // Note that embedding model I'm using is voyage-code-3, which has a max context len. of 32k tokens.
    const splitter = new TokenTextSplitter({ encodingName: "cl100k_base", chunkSize: 480, chunkOverlap: 100 });
    let rows: EmbeddedChunkData[] = [];
    let chunkIndex: number = 1;
    for (const fileObject of allFileObjects) {
        // For given file text, split into chunks and save into an array
        const chunkedText = await splitter.splitText(fileObject.content);
        for (const chunk of chunkedText) {
            if (fileObject.type == "file") {
                let row: EmbeddedChunkData = {
                    chunkContent: chunk,
                    embedding: [],
                    chunkIndex: chunkIndex,
                    filename: fileObject.filename,
                    sourcePath: fileObject.sourcePath,
                    paragraph: "",
                    h1: "",
                    h2: "",
                    h3: "",
                }
                // Add current chunk data inside of rows
                rows.push(row);
            }
            if (fileObject.type == "markdown") {
                let row: EmbeddedChunkData = {
                    chunkContent: chunk,
                    embedding: [],
                    chunkIndex: chunkIndex,
                    filename: fileObject.filename,
                    sourcePath: fileObject.sourcePath,
                    paragraph: fileObject.paragraph,
                    h1: fileObject.h1,
                    h2: fileObject.h2,
                    h3: fileObject.h3,
                }
                // Add current chunk data inside of rows
                rows.push(row);
            }
            // Increment chunkIndex after each chunk iteration of current file object
            chunkIndex += 1;        
        }
        // chunkLists.push(chunkedText);
    }
    // Return chunked rows object (2D array, I think?)
    return rows;
}


// (7/15/26): REFACTORED function that takes in GitHub repo file objects as input, then
// splits all file text into chunks in prep for vector embedding
// export async function chunkTextContentNew(fileObjects: object[]) {
//     // Token-aware text splitter, with added ~1.2x chunkSize multiplier since Voyage AI models use that ~1.2x more tokens 
//     // than the OpenAI-based splitter (via LangChain library) used here.
//     // Note that embedding model I'm using is voyage-code-3, which has a max context len. of 32k tokens.
//     const splitter = new TokenTextSplitter({ encodingName: "cl100k_base", chunkSize: 480, chunkOverlap: 100 });
//     let rows: EmbeddedChunkData[] = [];
//     let chunkIndex: number = 1;
//     for (const fileObject of fileObjects) {
//         // For given file text, split into chunks and save into an array
//         const chunkedText = await splitter.splitText(fileObject.content);
//         for (const chunk of chunkedText) {
//             if (fileObject.type == "file") {
//                 let row: EmbeddedChunkData = {
//                     chunkContent: chunk,
//                     embedding: [],
//                     chunkIndex: chunkIndex,
//                     filename: fileObject.filename,
//                     sourcePath: fileObject.sourcePath,
//                     paragraph: "",
//                     h1: "",
//                     h2: "",
//                     h3: "",
//                 }
//                 // Add current chunk data inside of rows
//                 rows.push(row);
//             }
//             if (fileObject.type == "markdown") {
//                 let row: EmbeddedChunkData = {
//                     chunkContent: chunk,
//                     embedding: [],
//                     chunkIndex: chunkIndex,
//                     filename: fileObject.filename,
//                     sourcePath: fileObject.sourcePath,
//                     paragraph: fileObject.paragraph,
//                     h1: fileObject.h1,
//                     h2: fileObject.h2,
//                     h3: fileObject.h3,
//                 }
//                 // Add current chunk data inside of rows
//                 rows.push(row);
//             }
//             // Increment chunkIndex after each chunk iteration of current file object
//             chunkIndex += 1;        
//         }
//         // chunkLists.push(chunkedText);
//     }
//     // Return chunked rows object (2D array, I think?)
//     return rows;
// }

export async function createEmbeddingVectorsFromChunks(allChunks: EmbeddedChunkData[]) {
    // VoyageAI client
    // let embeddings = [];   
    for (let chunk of allChunks) {
        const response = await voyageClient.embed({
            input: chunk.chunkContent,
            model: "voyage-code-3"
        });
        const embedding = response.data?.[0]?.embedding;

        // Add embedding into corresponding EmbeddedChunkData for Redis vector storing later
        if (embedding) {
            chunk.embedding = embedding;
        }
        
        // Debugging chunked data object output
        // console.log("Current chunk object:", chunk);

        // Debugging VoyageAI output:
        // console.log("Response embedding from VoyageAi", response);
        }

        // Debugging the new results of all chunked data objects:
        // console.log(allChunks);
        // console.log("\n\n\n");
        // console.log("Printed current chunk data objects! \n")
        return allChunks;
}

// For storing vector embeddings, Redis requires reading RAW BYTEs rather than a JSON array.
// Thus, this functionality is necessary!
function embeddingToBuffer(embedding: number[]): Buffer {
    // `Buffer.from` is a Node.js native method for creating buffers.
    return Buffer.from(new Float32Array(embedding).buffer);
}

// Pipeline: Store vector embeddings, chunk text, and their corresponding metadata in a Redis vector index
export async function storeVectorsAndChunkedMetadata(embeddedChunkObjects: EmbeddedChunkData[]) {
    redisClient.on('error', err => console.log('Redis Client Error', err));
    await redisClient.connect();

    try {
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
        console.log("Successfully created Redis vector index!")
    } catch (err: any) {
        if (!err.message.includes('Index already exists')) {
            throw err;
        }
        console.log("Redis vector index already exists.")
    }
    
    
    for (const [i, chunk] of embeddedChunkObjects.entries()) {
        // Skip current embedding store if not correct dimension.
        if (chunk.embedding.length !== 1024) {
            continue;
        }

        // One hash is set per chunked object. Hence, the for loop.
        await redisClient.hSet(`doc:${i + 1}`, {
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
        // TESTS
    // Connect to Redis client again
    await redisClient.connect();
    // Test: Verify if our vector index exists and if the correct data is stored in it
    const vectorIndex = await redisClient.ft.info('vector_idx');
    console.log(vectorIndex);
    // Test: Verify if one of my stored document keys exists and contains chunk text, metadata fields, and embedding vector
    const redisGetAll = await redisClient.hGetAll('doc:1');
    console.log("\n\n\n");
    console.log(redisGetAll);

    // Manually exit Redis client (required)
    await redisClient.quit();
}

// tests();