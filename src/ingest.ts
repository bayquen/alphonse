import * as fs from 'fs';  // file-system module From NodeJS
import path from 'path';
import { MarkdownParser } from "markdown-parser";
import { VoyageAIClient } from "voyageai";
import dotenv from "dotenv";
import { AutoTokenizer, PreTrainedTokenizer } from "@huggingface/transformers";
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { TokenTextSplitter } from "@langchain/textsplitters";

dotenv.config();
const voyageAPIKey: string | undefined = process.env.VOYAGE_API_KEY;
const client = new VoyageAIClient({ apiKey: voyageAPIKey});

const tokenizer = await AutoTokenizer.from_pretrained("voyageai/voyage-code-3");
// const enc = new Tiktoken(cl100k_base);

interface FileMetadata {
    filename: string;
    content: string;
    sourcePath: string;
}

interface MarkdownMetadata {
    filename: string;
    content: string;
    paragraph: string;
    h1: string | null;
    h2: string | null;
    h3: string | null;
    sourcePath: string;
}

// TODO: Does this make sense for my chunking needs???
interface ChunkedFile {
    filename: string
    content: string;
    tokenCount: number;
    sourcePath: string;
    contentMetadata: {
        paragraph: string;
        h1: string | null;
        h2: string | null;
        h3: string | null;
        chunkIndex: number;
    }
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
        console.log(allMetadataObjects);
        console.log("\n\nMetadata object's type:", typeof(allMetadataObjects));
        console.log("\n\n");
        console.log("Length of resulting metadata object array:", allMetadataObjects.length);
        return allMetadataObjects;
    } catch (err) {
        console.error('Error ingesting:', err);
        throw err;
    }
}

// Helper function to tokenize text chunks
async function tokenizeTextChunks(textContent: string) {
    const tokens = tokenizer.tokenize(textContent);
    // Return array of strings (tokens)
    return tokens;
}

// async function estimateVoyageTokens(fileObject: (FileMetadata | MarkdownMetadata)): Promise<number> {
//     // Get array of file metadata objects
//     // const allFileObjects = await extractFileObjects();

//     // Initialize var for token estimation
//     let voyageEstimate: number = 0;
//     // for (const fileObject of allFileObjects) {
//     const tikTokens = enc.encode(fileObject.content);
//     const tikCount = tikTokens.length;

//     // voyage-code-3 model produces an average of 1.15x more tokens than Tiktoken tokenizer
//     voyageEstimate = Math.ceil(tikCount * 1.15);
//     // }
//     return voyageEstimate;
// }

// Pipeline: Split all doc file text into chunks in prep for vector embedding
async function chunkTextContent() {
    const allFileObjects = await extractFileObjects();

    // const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 800, chunkOverlap: 100 });

    // Token-aware text splitter, with added ~1.2x chunkSize multiplier since Voyage AI models use that ~1.2x more tokens 
    // than the OpenAI-based splitter (via LangChain library) used here.
    // Note that embedding model I'm using is voyage-code-3, which has a max context len. of 32k tokens.
    const splitter = new TokenTextSplitter({ encodingName: "cl100k_base", chunkSize: 480, chunkOverlap: 100 });
    let chunkLists: string[][] = [];
    for (const fileObject of allFileObjects) {
        // For given file text, split into chunks and save into an array
        const chunkedText = await splitter.splitText(fileObject.content);

        chunkLists.push(chunkedText);
    }

    // Tokenize each chunk within each list of chunks
    let allTokenLists: string[][] = []
    for (const currentList of chunkLists) {
        for (const chunks of currentList) {
            const tokens = await tokenizeTextChunks(chunks);
            allTokenLists.push(tokens);
        }
    }

    return allTokenLists;
}

async function createEmbeddingVectorsFromChunks(textChunks: string[]) {
    // TODO: Vector embedding functionality goes here bayBEEE!!!
    // VoyageAI client
    const response = await client.embed({
        input: textChunks,
        model: "voyage-code-3"
    });
}

function main() {
    // // Execute and print out results?
    // extractFileObjects();
}
main();