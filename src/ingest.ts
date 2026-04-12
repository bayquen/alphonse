import * as fs from 'fs';  // From NodeJS
import path from 'path';

// Brandon's Pseudocode: 
// Pipeline for ingesting doc files (program reads from a folder of a few uploaded sample docs, for now).
// (Note:) In the context of this application, ingestion involves the E2E pipeline - from reading docs & converting
//       them into file objects, all the way to storing the vector embeddings in a storage index (i.e. Redis)
/** 
* 1. Get directory path of doc files
* 2. Get list of files inside the docs directory
* 3. For each file:
*    - Read file content
*    - Create a file object: {filename, content, source}
* 4. For each file object:
*    - If markdown, then extract section headings (i.e. build extraction function)
*        - Preserve which heading each chunk belongs to for richer metadata 
*          (this allows searching by topic later, e.g. "show me only authentication steps from api.md")
*    - Pass to chunking function to split into chunks (in prep for embedding them into vectors later)
*        - Chunking function:
*            a. Take text + metadata (filename, headings)
*            b. Split text into token chunks w/ overlap
*            c. Return array of {text, metadata (i.e. filename, heading, position)}
* 5. For each chunk:
*    - Call embedding API -> get vector
*    - Store in Redis w/ chunk + vector + metadata (note: I'll need unique keys for each chunk for cleaner querying later)
* 6. Create Redis vector index
*/

interface FileObject {
    file_name: string;
    content: string;
    source: string;
}

// Read directory containing uploaded doc files (for now; TODO: read doc files from git repos or files shared by user)
function readDocsDir(docsPath: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        fs.readdir(docsPath, (err, files) => {
            if (err)
                reject(err);
            else {
                // Prepend full path to each file (i.e. [directory path] + separator + [file name])
                const filePaths = files.map(file => path.join(docsPath, file));
                resolve(filePaths);
            }
        });
    });
}

// Read a single file and create file object
function readFileObject(filePath: string): Promise<FileObject> {
    return new Promise((resolve, reject) => { 
        // Asynchronously read files for server load efficiency (esp. for large-sized docs)
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                reject(err);
            } else {
                // Create file object
                const fileObject: FileObject = {
                    file_name: path.basename(filePath),
                    content: data,
                    source: filePath
                };
                resolve(fileObject);
            }
        });
    });
}

// Pipeline: Read all doc files and return array of file objects
async function ingestAllDocs(): Promise<FileObject[]> {
    try {
        const filePaths = await readDocsDir('/docs');
        const fileObjects = await Promise.all(
            filePaths.map(filePath => readFileObject(filePath))
        );
        return fileObjects;
    } catch (err) {
        console.error('Error ingesting:', err);
        throw err;
    }
}