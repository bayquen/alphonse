import * as fs from 'fs';  // From NodeJS
import path from 'path';

interface FileObject {
    file_name: string;
    content: string;
    source: string;
}

// Function for reading directory containing uploaded doc files (for now; TODO: read doc files from git repos or files shared by user)
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

// Function for reading a single file and create file object from it
function createFileObject(filePath: string): Promise<FileObject> {
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

// Pipeline: Read each file and create + return array of file objects to be chunked
async function extractFileObjects(): Promise<FileObject[]> {
    try {
        const filePaths = await readDocsDir('/docs');
        const fileObjects = await Promise.all(
            filePaths.map(filePath => createFileObject(filePath))
        );
        // For each object, if markdown file, then extract section headings for chunks w/ richer metadata later
        fileObjects.map(fileObject => )

        return fileObjects;
    } catch (err) {
        console.error('Error ingesting:', err);
        throw err;
    }
}

// Pipeline: Parse any markdown doc files to extract headings (h1, h2, etc.) and convert into
// abstract syntax trees (AST) for richer metadata. Enriches metadata to improve context for agent 
// (vector) search.
async function parseMarkdownIntoAST(): Promise<foo> {
    
}