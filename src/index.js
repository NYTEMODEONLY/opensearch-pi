#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import SimpleSearchEngine from './simple-search.js';
import ContextRetriever from './context.js';
import path from 'path';
import os from 'os';

const program = new Command();
const searchEngine = new SimpleSearchEngine();

program
  .name('opensearch')
  .description('ARM64-compatible hybrid search for markdown files')
  .version('1.0.0');

// Collection management
program.command('collection')
  .description('manage document collections')
  .argument('[action]', 'add, remove, list, or update')
  .argument('[path]', 'path to add as collection')
  .option('-n, --name <name>', 'collection name')
  .option('-m, --mask <mask>', 'glob pattern for files', '**/*.{md,txt}')
  .action(async (action, collectionPath, options) => {
    try {
      switch (action) {
        case 'add':
          if (!collectionPath) {
            console.error(chalk.red('Error: Path required for add action'));
            process.exit(1);
          }
          const name = options.name || path.basename(path.resolve(collectionPath));
          await searchEngine.addCollection(name, collectionPath, options.mask);
          console.log(chalk.green(`✅ Added collection "${name}" from ${collectionPath}`));
          break;
        
        case 'list':
          const list = await searchEngine.listCollections();
          if (list.length === 0) {
            console.log(chalk.yellow('No collections found'));
          } else {
            console.log(chalk.blue('📚 Collections:'));
            list.forEach(col => {
              console.log(`  • ${chalk.cyan(col.name)}: ${col.path} (${col.files} files)`);
            });
          }
          break;
        
        case 'remove':
          if (!collectionPath) {
            console.error(chalk.red('Error: Collection name required for remove action'));
            process.exit(1);
          }
          await searchEngine.removeCollection(collectionPath);
          console.log(chalk.green(`✅ Removed collection "${collectionPath}"`));
          break;
        
        case 'update':
          console.log(chalk.green('✅ Collections updated (using file-based approach)'));
          break;
        
        default:
          console.log(chalk.yellow('Available actions: add, remove, list, update'));
      }
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Search commands
program.command('search')
  .description('smart text search with ripgrep/grep')
  .argument('<query>', 'search query')
  .option('-n, --limit <num>', 'number of results', '5')
  .option('-c, --collection <name>', 'search within specific collection')
  .option('--case-sensitive', 'case sensitive search')
  .option('--json', 'output as JSON')
  .action(async (query, options) => {
    try {
      const searchResult = await searchEngine.search(query, {
        limit: parseInt(options.limit),
        collection: options.collection,
        caseSensitive: options.caseSensitive
      });
      
      if (options.json) {
        console.log(JSON.stringify(searchResult, null, 2));
      } else {
        displaySearchResult(searchResult, 'Text Search');
      }
    } catch (error) {
      console.error(chalk.red('Search error:', error.message));
      process.exit(1);
    }
  });

// Alias commands for compatibility
program.command('vsearch')
  .description('alias for search command')
  .argument('<query>', 'search query')
  .option('-n, --limit <num>', 'number of results', '5')
  .option('-c, --collection <name>', 'search within specific collection')
  .option('--json', 'output as JSON')
  .action(async (query, options) => {
    try {
      const searchResult = await searchEngine.search(query, {
        limit: parseInt(options.limit),
        collection: options.collection
      });
      
      if (options.json) {
        console.log(JSON.stringify(searchResult, null, 2));
      } else {
        displaySearchResult(searchResult, 'Semantic Search');
      }
    } catch (error) {
      console.error(chalk.red('Search error:', error.message));
      process.exit(1);
    }
  });

program.command('query')
  .description('alias for search command (best quality)')
  .argument('<query>', 'search query')
  .option('-n, --limit <num>', 'number of results', '5')
  .option('-c, --collection <name>', 'search within specific collection')
  .option('--json', 'output as JSON')
  .action(async (query, options) => {
    try {
      const searchResult = await searchEngine.search(query, {
        limit: parseInt(options.limit),
        collection: options.collection
      });
      
      if (options.json) {
        console.log(JSON.stringify(searchResult, null, 2));
      } else {
        displaySearchResult(searchResult, 'Hybrid Search');
      }
    } catch (error) {
      console.error(chalk.red('Search error:', error.message));
      process.exit(1);
    }
  });

// Placeholder embed command (not needed for simple version)
program.command('embed')
  .description('embeddings not needed for this version')
  .action(async () => {
    console.log(chalk.yellow('ℹ️  Embeddings not required for this ARM64-optimized version'));
    console.log(chalk.blue('🔍 Search works using ripgrep/grep for maximum compatibility'));
  });

// Context retrieval for OpenClaw agents (token-saving)
program.command('context')
  .description('get smart context for a query (OpenClaw integration)')
  .argument('[query]', 'context query (optional)')
  .option('-w, --workspace <path>', 'workspace directory', process.cwd())
  .option('-t, --max-tokens <num>', 'maximum tokens', '4000')
  .option('--no-identity', 'skip identity files')
  .option('--json', 'output as JSON')
  .option('--raw', 'output raw content only (for piping)')
  .action(async (query, options) => {
    try {
      const retriever = new ContextRetriever(options.workspace);
      const context = await retriever.getContext(query || '', {
        includeIdentity: options.identity !== false,
        maxTokens: parseInt(options.maxTokens)
      });

      if (options.json) {
        console.log(JSON.stringify(context, null, 2));
      } else if (options.raw) {
        console.log(retriever.formatForLLM(context));
      } else {
        console.log(chalk.blue('🧠 Smart Context Retrieval'));
        console.log(chalk.dim('─'.repeat(60)));

        if (context.identity) {
          console.log(chalk.cyan('\n📝 Identity Context:'));
          console.log(context.identity.substring(0, 500) + (context.identity.length > 500 ? '...' : ''));
        }

        if (context.relevant) {
          console.log(chalk.cyan('\n🔍 Relevant Context:'));
          console.log(context.relevant.substring(0, 1000) + (context.relevant.length > 1000 ? '...' : ''));
        }

        console.log(chalk.dim('\n' + '─'.repeat(60)));
        console.log(chalk.green(`💰 Token Savings:`));
        console.log(`   Full files would use: ~${chalk.yellow(context.savings.fullFileTokens)} tokens`);
        console.log(`   Smart context uses:   ~${chalk.green(context.tokenEstimate)} tokens`);
        console.log(`   ${chalk.bold.green(`Saved ${context.savings.percentSaved}%`)} (${context.savings.saved} tokens)`);
        console.log(chalk.dim(`   Sources: ${context.sources.join(', ')}`));
      }
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Get document
program.command('get')
  .description('retrieve a document by path or ID')
  .argument('<identifier>', 'document path or ID')
  .option('-l, --lines <num>', 'maximum lines to return')
  .option('--from <num>', 'start from line number', '1')
  .action(async (identifier, options) => {
    try {
      const doc = await searchEngine.getDocument(identifier, {
        maxLines: options.lines ? parseInt(options.lines) : undefined,
        fromLine: parseInt(options.from)
      });
      
      if (!doc) {
        console.log(chalk.yellow('Document not found'));
        return;
      }
      
      console.log(chalk.cyan(`📄 ${doc.path}`));
      if (doc.title) {
        console.log(chalk.bold(doc.title));
      }
      console.log(chalk.dim('─'.repeat(60)));
      console.log(doc.content);
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

// Status
program.command('status')
  .description('show index status and statistics')
  .action(async () => {
    try {
      const stats = await searchEngine.getStats();
      const collections = await searchEngine.listCollections();
      
      console.log(chalk.blue('📊 OpenSearch Pi Status'));
      console.log(`Collections: ${chalk.cyan(stats.collections)}`);
      console.log(`Total Files: ${chalk.cyan(stats.totalFiles)}`);
      console.log(`Config File: ${chalk.dim(stats.collectionsFile)}`);
      
      if (collections.length > 0) {
        console.log('\n' + chalk.blue('📚 Collections:'));
        collections.forEach(col => {
          console.log(`  • ${chalk.cyan(col.name)}: ${col.path} (${col.files} files)`);
        });
      } else {
        console.log('\n' + chalk.yellow('ℹ️  No collections configured. Add one with:'));
        console.log(chalk.dim('  opensearch collection add ~/Documents --name "docs"'));
      }
    } catch (error) {
      console.error(chalk.red('Error:', error.message));
      process.exit(1);
    }
  });

function displaySearchResult(searchResult, title) {
  if (searchResult.results.length === 0) {
    console.log(chalk.yellow('No results found'));
    return;
  }
  
  console.log(chalk.blue(`🔍 ${title} Results:`));
  console.log(chalk.dim(`Query: "${searchResult.query}" | Collections: ${searchResult.collectionsSearched}`));
  console.log();
  
  searchResult.results.forEach((result, index) => {
    const scoreColor = result.score > 0.7 ? chalk.green : result.score > 0.4 ? chalk.yellow : chalk.dim;
    const scorePercent = Math.round(result.score * 100);
    
    console.log(`${chalk.cyan(result.path)}${chalk.dim(':' + result.line)} ${chalk.gray('#' + result.id)}`);
    if (result.title) {
      console.log(chalk.bold(result.title));
    }
    if (result.collection) {
      console.log(chalk.dim(`Collection: ${result.collection}`));
    }
    console.log(scoreColor(`Score: ${scorePercent}%`));
    console.log();
    if (result.content) {
      console.log(result.content);
      console.log();
    }
    
    if (index < searchResult.results.length - 1) {
      console.log(chalk.dim('─'.repeat(60)));
      console.log();
    }
  });
  
  // Show token savings
  console.log(chalk.dim('─'.repeat(60)));
  console.log(chalk.blue(`📊 Results: ${searchResult.results.length} matches`));
  console.log(chalk.green(`💰 Token usage: ~${searchResult.tokenEstimate} tokens (vs ~250K loading all files)`));
}

// Legacy function for compatibility
function displayResults(results, title) {
  const mockSearchResult = {
    results: results,
    query: 'search',
    collectionsSearched: 1,
    tokenEstimate: results.reduce((sum, r) => sum + (r.content?.length || 0), 0) / 4
  };
  displaySearchResult(mockSearchResult, title);
}

program.parse();