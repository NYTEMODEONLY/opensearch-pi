import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';

export class DatabaseManager {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
    this.statements = {};
  }

  async initialize() {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Open database
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }
        
        // Configure database
        this.db.serialize(() => {
          this.db.run('PRAGMA journal_mode = WAL');
          this.db.run('PRAGMA synchronous = NORMAL');
          this.db.run('PRAGMA cache_size = 1000');
    
    // Create tables
    this.createTables();
    
    // Prepare common statements
    this.prepareStatements();
  }

  createTables() {
    // Collections table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        mask TEXT NOT NULL DEFAULT '**/*.{md,txt}',
        created_at INTEGER DEFAULT (strftime('%s','now')),
        updated_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    // Documents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT,
        content TEXT NOT NULL,
        collection TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified_at INTEGER NOT NULL,
        indexed_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (collection) REFERENCES collections(name) ON DELETE CASCADE
      )
    `);

    // Full-text search table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        title, content,
        content=documents,
        content_rowid=rowid,
        tokenize='porter unicode61'
      )
    `);

    // Embeddings table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        document_id TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s','now')),
        FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
      )
    `);

    // Indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection);
      CREATE INDEX IF NOT EXISTS idx_documents_path ON documents(path);
      CREATE INDEX IF NOT EXISTS idx_documents_modified ON documents(modified_at);
    `);

    // Triggers to maintain FTS index
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.rowid;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE ON documents BEGIN
        DELETE FROM documents_fts WHERE rowid = old.rowid;
        INSERT INTO documents_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
      END;
    `);
  }

  prepareStatements() {
    // Collection statements
    this.statements.addCollection = this.db.prepare(`
      INSERT OR REPLACE INTO collections (name, path, mask, updated_at)
      VALUES (?, ?, ?, strftime('%s','now'))
    `);

    this.statements.getCollections = this.db.prepare(`
      SELECT c.*, COUNT(d.id) as file_count
      FROM collections c
      LEFT JOIN documents d ON d.collection = c.name
      GROUP BY c.name
      ORDER BY c.name
    `);

    this.statements.removeCollection = this.db.prepare(`
      DELETE FROM collections WHERE name = ?
    `);

    // Document statements
    this.statements.addDocument = this.db.prepare(`
      INSERT OR REPLACE INTO documents 
      (id, path, title, content, collection, size, modified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.statements.getDocument = this.db.prepare(`
      SELECT * FROM documents WHERE id = ?
    `);

    this.statements.getDocumentByPath = this.db.prepare(`
      SELECT * FROM documents WHERE path = ?
    `);

    this.statements.removeDocument = this.db.prepare(`
      DELETE FROM documents WHERE id = ?
    `);

    this.statements.getDocumentsByCollection = this.db.prepare(`
      SELECT * FROM documents WHERE collection = ? ORDER BY path
    `);

    // Cleanup statements
    this.statements.removeOrphanedDocuments = this.db.prepare(`
      DELETE FROM documents 
      WHERE collection NOT IN (SELECT name FROM collections)
    `);

    this.statements.removeOrphanedEmbeddings = this.db.prepare(`
      DELETE FROM embeddings 
      WHERE document_id NOT IN (SELECT id FROM documents)
    `);
  }

  // Wrapper methods for prepared statements
  prepare(sql) {
    return this.db.prepare(sql);
  }

  exec(sql) {
    return this.db.exec(sql);
  }

  transaction(fn) {
    return this.db.transaction(fn);
  }

  // Collection methods
  addCollection(name, path, mask) {
    return this.statements.addCollection.run(name, path, mask);
  }

  getCollections() {
    return this.statements.getCollections.all();
  }

  removeCollection(name) {
    const result = this.statements.removeCollection.run(name);
    this.cleanup(); // Remove orphaned documents and embeddings
    return result;
  }

  // Document methods
  addDocument(id, path, title, content, collection, size, modifiedAt) {
    return this.statements.addDocument.run(id, path, title, content, collection, size, modifiedAt);
  }

  getDocument(id) {
    return this.statements.getDocument.get(id);
  }

  getDocumentByPath(path) {
    return this.statements.getDocumentByPath.get(path);
  }

  removeDocument(id) {
    return this.statements.removeDocument.run(id);
  }

  getDocumentsByCollection(collection) {
    return this.statements.getDocumentsByCollection.all(collection);
  }

  // Utility methods
  cleanup() {
    this.statements.removeOrphanedDocuments.run();
    this.statements.removeOrphanedEmbeddings.run();
    
    // Rebuild FTS index
    this.db.exec('INSERT INTO documents_fts(documents_fts) VALUES("rebuild")');
    
    // Vacuum database
    this.db.exec('VACUUM');
  }

  getStats() {
    return this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM collections) as collections,
        (SELECT COUNT(*) FROM documents) as documents,
        (SELECT COUNT(*) FROM embeddings) as embeddings,
        (SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()) as db_size
    `).get();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // Vector search helper (placeholder - requires sqlite-vec extension)
  initializeVectorSearch() {
    try {
      // Try to load sqlite-vec extension if available
      this.db.loadExtension('sqlite-vec');
      
      // Create vector index table
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(
          document_id TEXT PRIMARY KEY,
          embedding float[384]
        )
      `);
      
      return true;
    } catch (error) {
      console.warn('Vector search extension not available, using fallback cosine distance');
      return false;
    }
  }
}

// Cosine distance fallback for when sqlite-vec is not available
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Register custom functions for SQLite
Database.prototype.function = function(name, options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  
  return this.prepare(`SELECT ${name}(?) as result`).pluck().bind(this, fn);
};

// Add cosine distance function to SQLite
export function registerVectorFunctions(db) {
  db.function('vector_distance_cosine', (a, b) => {
    try {
      const vecA = JSON.parse(a);
      const vecB = JSON.parse(b);
      return 1 - cosineSimilarity(vecA, vecB); // Distance (lower is better)
    } catch (error) {
      return 1; // Maximum distance on error
    }
  });
}