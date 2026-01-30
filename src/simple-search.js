#!/usr/bin/env node

/**
 * Simple ARM64-compatible search engine
 * Uses file system operations instead of SQLite for immediate ARM64 compatibility
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

export class SimpleSearchEngine {
  constructor(workspaceDir = '.') {
    this.workspaceDir = path.resolve(workspaceDir);
    this.collectionsFile = path.join(this.workspaceDir, '.opensearch-collections.json');
  }

  // Load collections from JSON file
  loadCollections() {
    if (!fs.existsSync(this.collectionsFile)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.collectionsFile, 'utf8'));
    } catch (error) {
      console.warn('Error loading collections:', error.message);
      return {};
    }
  }

  // Save collections to JSON file
  saveCollections(collections) {
    try {
      fs.writeFileSync(this.collectionsFile, JSON.stringify(collections, null, 2));
    } catch (error) {
      console.error('Error saving collections:', error.message);
    }
  }

  // Add a collection
  async addCollection(name, collectionPath, mask = '**/*.{md,txt}') {
    const collections = this.loadCollections();
    const absolutePath = path.resolve(collectionPath);
    
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Path does not exist: ${absolutePath}`);
    }

    collections[name] = {
      name,
      path: absolutePath,
      mask,
      addedAt: Date.now()
    };

    this.saveCollections(collections);
    return collections[name];
  }

  // List collections
  async listCollections() {
    const collections = this.loadCollections();
    return Object.values(collections).map(col => ({
      ...col,
      files: this.countFiles(col.path, col.mask)
    }));
  }

  // Remove collection
  async removeCollection(name) {
    const collections = this.loadCollections();
    if (!collections[name]) {
      throw new Error(`Collection "${name}" not found`);
    }
    delete collections[name];
    this.saveCollections(collections);
  }

  // Count files in a collection
  countFiles(collectionPath, mask) {
    try {
      const pattern = path.join(collectionPath, mask);
      const files = glob.sync(pattern, { 
        ignore: ['**/node_modules/**', '**/.git/**'],
        nodir: true 
      });
      return files.length;
    } catch (error) {
      return 0;
    }
  }

  // Smart search using ripgrep or grep
  async search(query, options = {}) {
    const { 
      limit = 5, 
      collection = null, 
      contextLines = 2, 
      maxChars = 2000,
      caseSensitive = false 
    } = options;

    const collections = this.loadCollections();
    let searchPaths = [];

    if (collection) {
      if (!collections[collection]) {
        throw new Error(`Collection "${collection}" not found`);
      }
      searchPaths = [collections[collection].path];
    } else {
      searchPaths = Object.values(collections).map(c => c.path);
    }

    if (searchPaths.length === 0) {
      searchPaths = [this.workspaceDir];
    }

    const results = [];
    let totalChars = 0;

    for (const searchPath of searchPaths) {
      if (totalChars >= maxChars) break;

      try {
        // Try ripgrep first, fallback to grep
        const caseSensitiveFlag = caseSensitive ? '' : '-i';
        let cmd;
        
        // Check if ripgrep is available
        try {
          execSync('which rg', { stdio: 'ignore' });
          cmd = `rg ${caseSensitiveFlag} -n -C ${contextLines} --type md --type txt "${query}" "${searchPath}" 2>/dev/null || true`;
        } catch (e) {
          // Fallback to grep
          cmd = `find "${searchPath}" -type f \\( -name "*.md" -o -name "*.txt" \\) -exec grep ${caseSensitiveFlag} -H -n -C ${contextLines} "${query}" {} \\; 2>/dev/null || true`;
        }

        const output = execSync(cmd, { 
          encoding: 'utf8',
          maxBuffer: 1024 * 1024 // 1MB max
        });

        if (output.trim()) {
          const lines = output.trim().split('\n');
          const collectionName = Object.values(collections).find(c => c.path === searchPath)?.name || 'default';
          
          for (const line of lines.slice(0, limit * 3)) {
            if (totalChars >= maxChars) break;
            
            const match = this.parseSearchResult(line, searchPath, collectionName);
            if (match && match.content.trim()) {
              results.push(match);
              totalChars += match.content.length;
            }
          }
        }
      } catch (error) {
        console.warn(`Search error in ${searchPath}:`, error.message);
        continue;
      }
    }

    // Score and sort results
    const scoredResults = this.scoreResults(results, query)
      .slice(0, limit);

    return {
      results: scoredResults,
      totalChars,
      tokenEstimate: Math.round(totalChars / 4),
      query,
      collectionsSearched: searchPaths.length
    };
  }

  // Parse a search result line
  parseSearchResult(line, basePath, collection) {
    // Handle different grep/rg output formats
    const parts = line.split(':');
    if (parts.length < 3) return null;

    const filePath = parts[0];
    const lineNumber = parseInt(parts[1]) || 1;
    const content = parts.slice(2).join(':');

    // Extract relative path
    const relativePath = path.relative(basePath, filePath);

    // Extract title from content (first few words)
    const title = content.replace(/^\s*#+\s*/, '').split(/[.!?]|$$/)[0].trim().substring(0, 100);

    return {
      id: this.generateId(filePath, lineNumber),
      path: relativePath,
      fullPath: filePath,
      line: lineNumber,
      title: title || path.basename(filePath),
      content: content.trim(),
      collection,
      score: 0 // Will be calculated later
    };
  }

  // Score results based on query relevance
  scoreResults(results, query) {
    const queryTerms = query.toLowerCase().split(/\s+/);
    
    return results.map(result => {
      let score = 0;
      const content = result.content.toLowerCase();
      const title = result.title.toLowerCase();
      
      // Title matches worth more
      for (const term of queryTerms) {
        if (title.includes(term)) {
          score += 10;
        }
        if (content.includes(term)) {
          score += 1;
        }
      }
      
      // Boost for multiple term matches
      const matchedTerms = queryTerms.filter(term => content.includes(term)).length;
      score += matchedTerms * 2;
      
      // Normalize score
      result.score = Math.min(1, score / (queryTerms.length * 5));
      
      return result;
    }).sort((a, b) => b.score - a.score);
  }

  // Generate simple ID for a result
  generateId(filePath, lineNumber) {
    const hash = filePath + lineNumber;
    return hash.substring(hash.length - 8);
  }

  // Get statistics
  async getStats() {
    const collections = this.loadCollections();
    const collectionList = Object.values(collections);
    
    let totalFiles = 0;
    for (const col of collectionList) {
      totalFiles += this.countFiles(col.path, col.mask);
    }

    return {
      collections: collectionList.length,
      totalFiles,
      collectionsFile: this.collectionsFile
    };
  }

  // Get a document by path
  async getDocument(filePath, options = {}) {
    const { maxLines = null, fromLine = 1 } = options;
    
    if (!path.isAbsolute(filePath)) {
      // Try to find file in collections
      const collections = this.loadCollections();
      for (const collection of Object.values(collections)) {
        const fullPath = path.join(collection.path, filePath);
        if (fs.existsSync(fullPath)) {
          filePath = fullPath;
          break;
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      let content = fs.readFileSync(filePath, 'utf8');
      
      if (maxLines || fromLine > 1) {
        const lines = content.split('\n');
        const start = fromLine - 1;
        const end = maxLines ? start + maxLines : lines.length;
        content = lines.slice(start, end).join('\n');
      }

      const title = path.basename(filePath, path.extname(filePath))
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

      return {
        path: filePath,
        title,
        content,
        size: content.length
      };
    } catch (error) {
      throw new Error(`Could not read file: ${error.message}`);
    }
  }
}

export default SimpleSearchEngine;