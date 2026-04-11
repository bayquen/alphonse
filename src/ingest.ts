import * as fs from 'fs';  // From NodeJS

// Brandon's Pseudocode: 
// for pipeline for ingesting and reading doc files (reading from a folder of 2-3 docs inside repo, for now)
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


// Read directory containing uploaded doc files (for now; TODO: read doc files from git repos or files shared by user)
function readDocsDir() {
    fs.readdir('/docs', (err, files) => {
        if (err) 
            console.log(err);
        else {
            return files;
        } 
    })
};

// Asynchronously read files for server load efficiency (esp. for large-sized docs)
// TODO (continue fixing this - 4/11/26)
function readDocFiles() {
    readDocsDir();
    
    fs.readFile('/docs/example.md', 'utf-8', (err, data) => {
        if (err) throw err;
        return data;
    });
};

