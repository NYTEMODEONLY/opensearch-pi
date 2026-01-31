#!/usr/bin/env node

/**
 * Smart Context Retrieval for OpenClaw Agents
 *
 * This module provides LLM-optimized context retrieval that dramatically
 * reduces token usage by returning only relevant snippets instead of full files.
 *
 * Expected token savings: 90-95% compared to loading full files
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';

export class ContextRetriever {
  constructor(workspaceDir) {
    this.workspaceDir = path.resolve(workspaceDir || process.cwd());
    this.collectionsFile = path.join(this.workspaceDir, '.opensearch-collections.json');

    // Core files that define agent identity (small, always relevant)
    this.identityFiles = ['IDENTITY.md', 'SOUL.md', 'USER.md'];

    // Files to search for context (not loaded fully)
    this.contextFiles = ['MEMORY.md', 'AGENTS.md', 'TOOLS.md', 'memory/*.md'];

    // Maximum tokens for different context types
    this.limits = {
      identity: 1000,      // Core identity is small
      search: 2000,        // Search results
      total: 4000          // Total context limit
    };
  }

  /**
   * Get smart context for a user query
   * Returns only relevant information instead of full files
   */
  async getContext(query, options = {}) {
    const {
      includeIdentity = true,
      maxTokens = this.limits.total,
      searchLimit = 5
    } = options;

    const context = {
      identity: '',
      relevant: '',
      tokenEstimate: 0,
      sources: [],
      savings: {}
    };

    let tokensUsed = 0;

    // 1. Always include compact identity (it's small and essential)
    if (includeIdentity) {
      const identity = await this.getCompactIdentity();
      context.identity = identity.content;
      tokensUsed += identity.tokens;
      context.sources.push(...identity.sources);
    }

    // 2. Search for relevant context based on query
    if (query && tokensUsed < maxTokens) {
      const searchResults = await this.searchContext(query, {
        maxTokens: maxTokens - tokensUsed,
        limit: searchLimit
      });
      context.relevant = searchResults.content;
      tokensUsed += searchResults.tokens;
      context.sources.push(...searchResults.sources);
    }

    // 3. Calculate savings
    const fullFileTokens = await this.estimateFullFileTokens();
    context.tokenEstimate = tokensUsed;
    context.savings = {
      fullFileTokens,
      actualTokens: tokensUsed,
      saved: fullFileTokens - tokensUsed,
      percentSaved: Math.round((1 - tokensUsed / fullFileTokens) * 100)
    };

    return context;
  }

  /**
   * Get compact identity information
   * Only includes essential files that are small
   */
  async getCompactIdentity() {
    const parts = [];
    const sources = [];
    let totalTokens = 0;

    for (const file of this.identityFiles) {
      const filePath = path.join(this.workspaceDir, file);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8').trim();
          const tokens = Math.round(content.length / 4);

          if (totalTokens + tokens <= this.limits.identity) {
            parts.push(`<!-- ${file} -->\n${content}`);
            sources.push(file);
            totalTokens += tokens;
          }
        } catch (e) {
          // Skip unreadable files
        }
      }
    }

    return {
      content: parts.join('\n\n'),
      tokens: totalTokens,
      sources
    };
  }

  /**
   * Search for relevant context using ripgrep/grep
   */
  async searchContext(query, options = {}) {
    const { maxTokens = 2000, limit = 5 } = options;

    const results = [];
    const sources = [];
    let totalChars = 0;
    const maxChars = maxTokens * 4; // Approximate chars per token

    // Search in memory files
    const searchPaths = this.contextFiles.map(f => path.join(this.workspaceDir, f));

    for (const pattern of searchPaths) {
      if (totalChars >= maxChars) break;

      try {
        // Use glob to find matching files
        const files = glob.sync(pattern, { nodir: true });

        for (const file of files) {
          if (totalChars >= maxChars) break;
          if (!fs.existsSync(file)) continue;

          // Search within this file
          const matches = await this.searchInFile(file, query, {
            contextLines: 3,
            maxMatches: limit
          });

          for (const match of matches) {
            if (totalChars >= maxChars) break;

            results.push(match);
            totalChars += match.content.length;

            if (!sources.includes(match.source)) {
              sources.push(match.source);
            }
          }
        }
      } catch (e) {
        // Skip errors
      }
    }

    // Format results as markdown
    const content = this.formatSearchResults(results, query);

    return {
      content,
      tokens: Math.round(totalChars / 4),
      sources,
      matchCount: results.length
    };
  }

  /**
   * Search within a specific file
   */
  async searchInFile(filePath, query, options = {}) {
    const { contextLines = 2, maxMatches = 5 } = options;
    const matches = [];

    try {
      const caseSensitiveFlag = '-i';
      let cmd;

      // Try ripgrep first
      try {
        execSync('which rg', { stdio: 'ignore' });
        cmd = `rg ${caseSensitiveFlag} -n -C ${contextLines} "${query}" "${filePath}" 2>/dev/null || true`;
      } catch (e) {
        cmd = `grep ${caseSensitiveFlag} -n -C ${contextLines} "${query}" "${filePath}" 2>/dev/null || true`;
      }

      const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 512 * 1024 });

      if (output.trim()) {
        const blocks = output.split('--\n').slice(0, maxMatches);

        for (const block of blocks) {
          if (block.trim()) {
            matches.push({
              source: path.relative(this.workspaceDir, filePath),
              content: block.trim(),
              query
            });
          }
        }
      }
    } catch (e) {
      // Search failed, skip
    }

    return matches;
  }

  /**
   * Format search results as clean markdown
   */
  formatSearchResults(results, query) {
    if (results.length === 0) {
      return `<!-- No matches found for: ${query} -->`;
    }

    const parts = [`<!-- Relevant context for: "${query}" -->`];

    // Group by source
    const bySource = {};
    for (const result of results) {
      if (!bySource[result.source]) {
        bySource[result.source] = [];
      }
      bySource[result.source].push(result.content);
    }

    for (const [source, contents] of Object.entries(bySource)) {
      parts.push(`\n### From ${source}:`);
      parts.push(contents.join('\n...\n'));
    }

    return parts.join('\n');
  }

  /**
   * Estimate tokens if we loaded all files fully
   */
  async estimateFullFileTokens() {
    let totalChars = 0;
    const allFiles = [...this.identityFiles, ...this.contextFiles];

    for (const pattern of allFiles) {
      try {
        const files = glob.sync(path.join(this.workspaceDir, pattern), { nodir: true });
        for (const file of files) {
          if (fs.existsSync(file)) {
            const stat = fs.statSync(file);
            totalChars += stat.size;
          }
        }
      } catch (e) {
        // Skip
      }
    }

    return Math.round(totalChars / 4);
  }

  /**
   * Format context for LLM consumption
   */
  formatForLLM(context) {
    const parts = [];

    if (context.identity) {
      parts.push('## Identity\n' + context.identity);
    }

    if (context.relevant) {
      parts.push('## Relevant Context\n' + context.relevant);
    }

    parts.push(`\n<!-- Token usage: ${context.tokenEstimate} (saved ${context.savings.percentSaved}% vs full files) -->`);

    return parts.join('\n\n');
  }
}

export default ContextRetriever;
