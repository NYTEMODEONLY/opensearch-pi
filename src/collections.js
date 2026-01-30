import { DatabaseManager } from './db.js';
import { glob } from 'glob';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export class CollectionManager {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(os.homedir(), '.cache', 'opensearch', 'index.db');
    this.db = new DatabaseManager(this.dbPath);
  }

  async initialize() {
    await this.db.initialize();
  }

  // Add a new collection
  async add(name, collectionPath, mask = '**/*.{md,txt}') {
    await this.initialize();
    
    const absolutePath = path.resolve(collectionPath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${absolutePath}`);
    }

    // Add collection to database
    this.db.addCollection(name, absolutePath, mask);

    // Index files in the collection
    await this.indexCollection(name);
    
    return { name, path: absolutePath, mask };
  }

  // Remove a collection
  async remove(name) {
    await this.initialize();
    
    const result = this.db.removeCollection(name);
    if (result.changes === 0) {
      throw new Error(`Collection "${name}" not found`);
    }
    
    return result;
  }

  // List all collections
  async list() {
    await this.initialize();
    
    const collections = this.db.getCollections();
    return collections.map(col => ({
      name: col.name,
      path: col.path,
      mask: col.mask,
      files: col.file_count,
      createdAt: new Date(col.created_at * 1000),
      updatedAt: new Date(col.updated_at * 1000)
    }));
  }

  // Update all collections (re-index)
  async update() {
    await this.initialize();
    
    const collections = this.db.getCollections();
    
    for (const collection of collections) {
      console.log(`Updating collection: ${collection.name}`);
      await this.indexCollection(collection.name);
    }
    
    // Clean up orphaned records
    this.db.cleanup();
  }

  // Index files in a specific collection
  async indexCollection(collectionName) {
    await this.initialize();
    
    const collections = this.db.getCollections();
    const collection = collections.find(c => c.name === collectionName);
    
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    console.log(`Indexing collection: ${collection.name} (${collection.path})`);
    
    // Find all matching files
    const pattern = path.join(collection.path, collection.mask);
    const files = await glob(pattern, { 
      ignore: ['**/node_modules/**', '**/.git/**', '**/.*/**'],
      nodir: true 
    });

    console.log(`Found ${files.length} files to index`);
    
    // Get existing documents for this collection
    const existingDocs = this.db.getDocumentsByCollection(collection.name);
    const existingPaths = new Set(existingDocs.map(doc => doc.path));
    
    // Track processed files
    const processedPaths = new Set();
    let indexed = 0;
    let skipped = 0;
    
    // Index each file
    const indexTransaction = this.db.transaction((files) => {
      for (const filePath of files) {
        try {
          processedPaths.add(filePath);
          
          const stat = fs.statSync(filePath);
          const modifiedTime = Math.floor(stat.mtimeMs);
          
          // Check if file needs re-indexing
          const existingDoc = existingDocs.find(doc => doc.path === filePath);
          if (existingDoc && existingDoc.modified_at >= modifiedTime) {
            skipped++;
            continue;
          }
          
          // Read and parse file
          const content = fs.readFileSync(filePath, 'utf8');
          const { title, cleanContent } = this.parseMarkdownFile(content, filePath);
          
          // Generate document ID
          const docId = this.generateDocumentId(filePath, modifiedTime);
          
          // Store document
          this.db.addDocument(
            docId,
            filePath,
            title,
            cleanContent,
            collection.name,
            stat.size,
            modifiedTime
          );
          
          indexed++;
          
          if (indexed % 10 === 0) {
            process.stdout.write('.');
          }
          
        } catch (error) {
          console.error(`\nError indexing ${filePath}: ${error.message}`);
        }
      }
    });
    
    // Execute indexing transaction
    indexTransaction(files);
    
    // Remove documents that no longer exist
    const removedPaths = Array.from(existingPaths).filter(p => !processedPaths.has(p));
    if (removedPaths.length > 0) {
      const removeTransaction = this.db.transaction((paths) => {
        for (const filePath of paths) {
          const doc = existingDocs.find(d => d.path === filePath);
          if (doc) {
            this.db.removeDocument(doc.id);
          }
        }
      });
      
      removeTransaction(removedPaths);
      console.log(`\nRemoved ${removedPaths.length} deleted files`);
    }
    
    console.log(`\n✅ Indexed ${indexed} files, skipped ${skipped} unchanged`);
    
    return { indexed, skipped, removed: removedPaths.length };
  }

  // Parse markdown file to extract title and content
  parseMarkdownFile(content, filePath) {
    const lines = content.split('\n');
    let title = null;
    let contentStart = 0;
    
    // Look for title in various formats
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();
      
      // H1 markdown header
      if (line.startsWith('# ')) {
        title = line.substring(2).trim();
        contentStart = i + 1;
        break;
      }
      
      // Setext-style header
      if (i < lines.length - 1 && lines[i + 1].trim().match(/^=+$/)) {
        title = line;
        contentStart = i + 2;
        break;
      }
      
      // YAML frontmatter title
      if (line.match(/^title:\s*(.+)$/i)) {
        title = line.replace(/^title:\s*/i, '').replace(/['"]/g, '');
        // Don't set contentStart here, let frontmatter be processed
      }
    }
    
    // Fallback to filename if no title found
    if (!title) {
      title = path.basename(filePath, path.extname(filePath))
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    }
    
    // Clean content (remove frontmatter, excessive whitespace)
    let cleanContent = lines.slice(contentStart).join('\n');
    
    // Remove YAML frontmatter if present
    if (cleanContent.startsWith('---')) {
      const endIndex = cleanContent.indexOf('\n---', 3);
      if (endIndex !== -1) {
        cleanContent = cleanContent.substring(endIndex + 4);
      }
    }
    
    // Clean up whitespace and normalize
    cleanContent = cleanContent
      .replace(/\r\n/g, '\n')  // Normalize line endings
      .replace(/\n{3,}/g, '\n\n')  // Collapse excessive newlines
      .replace(/[ \t]+$/gm, '')  // Remove trailing whitespace
      .trim();
    
    return { title, cleanContent };
  }

  // Generate consistent document ID
  generateDocumentId(filePath, modifiedTime) {
    const hash = crypto.createHash('sha256');
    hash.update(filePath);
    hash.update(modifiedTime.toString());
    return hash.digest('hex').substring(0, 8);
  }

  // Get collection statistics
  async getCollectionStats(name) {
    await this.initialize();
    
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as documents,
        AVG(size) as avg_size,
        SUM(size) as total_size,
        MAX(modified_at) as latest_modified,
        MIN(modified_at) as earliest_modified
      FROM documents 
      WHERE collection = ?
    `).get(name);
    
    if (!stats.documents) {
      return null;
    }
    
    return {
      documents: stats.documents,
      avgSize: Math.round(stats.avg_size || 0),
      totalSize: stats.total_size || 0,
      latestModified: stats.latest_modified ? new Date(stats.latest_modified) : null,
      earliestModified: stats.earliest_modified ? new Date(stats.earliest_modified) : null
    };
  }

  // Validate collection path and mask
  validateCollection(collectionPath, mask) {
    const absolutePath = path.resolve(collectionPath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    const stat = fs.statSync(absolutePath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${absolutePath}`);
    }

    // Test glob pattern
    try {
      const testPattern = path.join(absolutePath, mask);
      glob.sync(testPattern, { nodir: true, limit: 1 });
    } catch (error) {
      throw new Error(`Invalid glob pattern: ${mask}`);
    }

    return { valid: true, absolutePath };
  }

  // Close database connection
  close() {
    this.db.close();
  }
}