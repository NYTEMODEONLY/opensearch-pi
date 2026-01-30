import { DatabaseManager, registerVectorFunctions } from './db.js';
import { EmbeddingEngine } from './embeddings.js';
import path from 'path';
import os from 'os';

export class SearchEngine {
  constructor(dbPath = null) {
    this.dbPath = dbPath || path.join(os.homedir(), '.cache', 'opensearch', 'index.db');
    this.db = new DatabaseManager(this.dbPath);
    this.embeddings = new EmbeddingEngine();
  }

  async initialize() {
    await this.db.initialize();
    await this.embeddings.initialize();
    
    // Register vector functions for cosine similarity
    registerVectorFunctions(this.db.db);
  }

  // BM25 full-text search
  async textSearch(query, options = {}) {
    const { limit = 5, collection = null, minScore = 0 } = options;
    
    let sql = `
      SELECT 
        d.id, d.path, d.title, d.collection, d.content,
        highlight(documents_fts, 2, '<mark>', '</mark>') as snippet,
        bm25(documents_fts) as score
      FROM documents_fts fts
      JOIN documents d ON d.id = fts.rowid
      WHERE documents_fts MATCH ?
    `;
    
    const params = [query];
    
    if (collection) {
      sql += ' AND d.collection = ?';
      params.push(collection);
    }
    
    sql += `
      AND bm25(documents_fts) >= ?
      ORDER BY score DESC
      LIMIT ?
    `;
    params.push(-minScore); // BM25 scores are negative, higher is better
    params.push(limit);
    
    const results = this.db.prepare(sql).all(...params);
    
    return results.map(row => ({
      id: row.id,
      path: row.path,
      title: row.title,
      collection: row.collection,
      snippet: this.cleanSnippet(row.snippet),
      score: Math.max(0, Math.min(1, (-row.score) / 10)) // Normalize BM25 score
    }));
  }

  // Vector semantic search
  async vectorSearch(query, options = {}) {
    const { limit = 5, collection = null, minScore = 0 } = options;
    
    // Generate query embedding
    const queryVector = await this.embeddings.embed(query);
    
    let sql = `
      SELECT 
        d.id, d.path, d.title, d.collection, d.content,
        (1.0 / (1.0 + vector_distance_cosine(e.embedding, ?))) as score
      FROM embeddings e
      JOIN documents d ON d.id = e.document_id
      WHERE score >= ?
    `;
    
    const params = [JSON.stringify(queryVector), minScore];
    
    if (collection) {
      sql += ' AND d.collection = ?';
      params.push(collection);
    }
    
    sql += `
      ORDER BY score DESC
      LIMIT ?
    `;
    params.push(limit);
    
    const results = this.db.prepare(sql).all(...params);
    
    return results.map(row => ({
      id: row.id,
      path: row.path,
      title: row.title,
      collection: row.collection,
      snippet: this.extractSnippet(row.content, query),
      score: row.score
    }));
  }

  // Hybrid search combining BM25 and vector search
  async hybridSearch(query, options = {}) {
    const { limit = 5, collection = null, minScore = 0 } = options;
    
    // Run both searches
    const [textResults, vectorResults] = await Promise.all([
      this.textSearch(query, { limit: limit * 2, collection, minScore: 0 }),
      this.vectorSearch(query, { limit: limit * 2, collection, minScore: 0 })
    ]);
    
    // Combine and rank using Reciprocal Rank Fusion
    const combined = this.fuseResults(textResults, vectorResults, query);
    
    // Filter by minimum score and return top results
    return combined
      .filter(result => result.score >= minScore)
      .slice(0, limit);
  }

  // Reciprocal Rank Fusion implementation
  fuseResults(textResults, vectorResults, query) {
    const k = 60; // RRF parameter
    const resultMap = new Map();
    
    // Add text search results
    textResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      resultMap.set(result.id, {
        ...result,
        textRank: index + 1,
        textScore: result.score,
        vectorRank: null,
        vectorScore: 0,
        rrfScore: rrfScore * 2 // Weight text search higher for exact matches
      });
    });
    
    // Add vector search results
    vectorResults.forEach((result, index) => {
      const rrfScore = 1 / (k + index + 1);
      
      if (resultMap.has(result.id)) {
        // Document found in both searches
        const existing = resultMap.get(result.id);
        existing.vectorRank = index + 1;
        existing.vectorScore = result.score;
        existing.rrfScore += rrfScore;
        
        // Use the better snippet
        if (result.score > existing.vectorScore || !existing.snippet) {
          existing.snippet = result.snippet;
        }
      } else {
        // Document only in vector search
        resultMap.set(result.id, {
          ...result,
          textRank: null,
          textScore: 0,
          vectorRank: index + 1,
          vectorScore: result.score,
          rrfScore: rrfScore
        });
      }
    });
    
    // Convert to array and sort by RRF score
    const results = Array.from(resultMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map(result => ({
        id: result.id,
        path: result.path,
        title: result.title,
        collection: result.collection,
        snippet: result.snippet,
        score: this.computeFinalScore(result)
      }));
    
    return results;
  }

  // Compute final score combining text and vector scores
  computeFinalScore(result) {
    // Weighted combination based on ranks
    let finalScore = result.rrfScore;
    
    // Boost if document appears in both searches
    if (result.textRank && result.vectorRank) {
      finalScore *= 1.2;
    }
    
    // Boost for top-ranked results
    if (result.textRank === 1 || result.vectorRank === 1) {
      finalScore *= 1.1;
    }
    
    // Normalize to 0-1 range
    return Math.min(1, Math.max(0, finalScore));
  }

  // Generate embeddings for all documents
  async generateEmbeddings(force = false) {
    const documents = this.db.prepare(`
      SELECT id, title, content FROM documents
      ${force ? '' : 'WHERE id NOT IN (SELECT document_id FROM embeddings)'}
    `).all();
    
    console.log(`Processing ${documents.length} documents...`);
    
    for (const doc of documents) {
      try {
        const text = this.prepareTextForEmbedding(doc.title, doc.content);
        const embedding = await this.embeddings.embed(text);
        
        this.db.prepare(`
          INSERT OR REPLACE INTO embeddings (document_id, embedding)
          VALUES (?, ?)
        `).run(doc.id, JSON.stringify(embedding));
        
        process.stdout.write('.');
      } catch (error) {
        console.error(`\nError embedding document ${doc.id}: ${error.message}`);
      }
    }
    
    console.log('\n✅ Embeddings complete');
  }

  // Get document by path or ID
  async getDocument(identifier, options = {}) {
    const { maxLines = null, fromLine = 1 } = options;
    
    let doc;
    if (identifier.startsWith('#')) {
      // Search by ID
      doc = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(identifier.slice(1));
    } else {
      // Search by path (with fuzzy matching)
      doc = this.db.prepare('SELECT * FROM documents WHERE path = ? OR path LIKE ?').get(identifier, `%${identifier}`);
    }
    
    if (!doc) return null;
    
    let content = doc.content;
    if (maxLines || fromLine > 1) {
      const lines = content.split('\n');
      const start = fromLine - 1;
      const end = maxLines ? start + maxLines : lines.length;
      content = lines.slice(start, end).join('\n');
    }
    
    return {
      id: doc.id,
      path: doc.path,
      title: doc.title,
      collection: doc.collection,
      content: content
    };
  }

  // Get search engine statistics
  async getStats() {
    const stats = this.db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM documents) as documents,
        (SELECT COUNT(DISTINCT collection) FROM documents) as collections,
        (SELECT COUNT(*) FROM embeddings) as embeddings
    `).get();
    
    return {
      ...stats,
      dbPath: this.dbPath
    };
  }

  // Helper methods
  prepareTextForEmbedding(title, content) {
    const text = `${title ? title + '\n' : ''}${content}`;
    return text.substring(0, 8000); // Limit length for embedding model
  }

  extractSnippet(content, query, maxLength = 200) {
    if (!content) return '';
    
    const queryTerms = query.toLowerCase().split(/\s+/);
    const sentences = content.split(/[.!?]+/);
    
    // Find sentence with most query terms
    let bestSentence = sentences[0];
    let maxMatches = 0;
    
    for (const sentence of sentences) {
      const lowerSentence = sentence.toLowerCase();
      const matches = queryTerms.filter(term => lowerSentence.includes(term)).length;
      
      if (matches > maxMatches) {
        maxMatches = matches;
        bestSentence = sentence;
      }
    }
    
    // Truncate and highlight
    let snippet = bestSentence.trim();
    if (snippet.length > maxLength) {
      snippet = snippet.substring(0, maxLength) + '...';
    }
    
    // Simple highlighting
    for (const term of queryTerms) {
      const regex = new RegExp(`(${term})`, 'gi');
      snippet = snippet.replace(regex, '**$1**');
    }
    
    return snippet;
  }

  cleanSnippet(snippet) {
    if (!snippet) return '';
    return snippet
      .replace(/<mark>/g, '**')
      .replace(/<\/mark>/g, '**')
      .replace(/\s+/g, ' ')
      .trim();
  }
}