# OpenSearch Pi

ARM64-compatible hybrid search engine for markdown files, built specifically for Raspberry Pi and OpenClaw integration.

## 🚀 Why OpenSearch Pi?

- **ARM64 Native**: Works perfectly on Raspberry Pi (no exotic runtime dependencies)
- **Hybrid Search**: Combines BM25 full-text + vector semantic search
- **Lightweight**: Small footprint, efficient on low-power devices
- **OpenClaw Optimized**: Built for memory files, documentation, and knowledge bases
- **Token Efficient**: Dramatically reduces API calls by finding only relevant content

## ⚡ Quick Start

```bash
# Install dependencies
cd opensearch
npm install

# Install globally
npm install -g .

# Or link for development
npm link

# Add your first collection
opensearch collection add ~/Documents/notes --name "notes"
opensearch collection add ~/.openclaw/workspace --name "workspace"

# Generate embeddings
opensearch embed

# Search your documents
opensearch search "API authentication"
opensearch vsearch "how to deploy"
opensearch query "error handling patterns"  # Best quality - hybrid search
```

## 🔄 Automated Setup (Recommended)

For hands-free operation, set up automatic re-indexing with file watching:

### 1. Install inotify-tools

```bash
# Debian/Ubuntu/Raspberry Pi OS
sudo apt-get install -y inotify-tools
```

### 2. Create the watch script

```bash
mkdir -p ~/.openclaw/workspace/scripts

cat > ~/.openclaw/workspace/scripts/opensearch-watch.sh << 'EOF'
#!/bin/bash
# Auto-reindex opensearch when workspace files change

WORKSPACE="$HOME/.openclaw/workspace"
INTERVAL=300  # 5 minutes fallback

reindex() {
    opensearch collection update >/dev/null 2>&1
}

# Check if inotifywait is available
if command -v inotifywait &> /dev/null; then
    echo "Watching $WORKSPACE for changes..."
    while true; do
        inotifywait -r -e modify,create,delete,move "$WORKSPACE" --exclude '\.git' -qq
        sleep 2  # debounce
        reindex
    done
else
    echo "inotifywait not found, using periodic refresh every ${INTERVAL}s"
    while true; do
        sleep $INTERVAL
        reindex
    done
fi
EOF

chmod +x ~/.openclaw/workspace/scripts/opensearch-watch.sh
```

### 3. Create systemd user service

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/opensearch-watch.service << 'EOF'
[Unit]
Description=OpenSearch Pi auto-reindex watcher
After=default.target

[Service]
Type=simple
ExecStart=%h/.openclaw/workspace/scripts/opensearch-watch.sh
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
EOF

# Enable and start the service
systemctl --user daemon-reload
systemctl --user enable opensearch-watch.service
systemctl --user start opensearch-watch.service

# Verify it's running
systemctl --user status opensearch-watch.service
```

### 4. Update your AGENTS.md (for OpenClaw)

Add this to your workspace `AGENTS.md` so the agent always uses opensearch:

```markdown
### 🔍 OpenSearch Pi - ALWAYS USE THIS FOR MEMORY QUERIES
**Before loading any memory file or using memory_search, use opensearch:**
\`\`\`bash
opensearch context "your query"   # Returns JSON with relevant snippets
opensearch query "your query"     # Human-readable hybrid search
\`\`\`

**Why:** Reduces token usage by ~95%. Instead of loading 250kb of files, you get only the relevant 2kb snippets.

**Auto-reindex:** A file watcher automatically re-indexes when workspace files change. No manual intervention needed.
```

Now your workspace will auto-reindex on any file change, and your agent will automatically use efficient search instead of loading full files.

---

## 🔍 Search Modes

| Command | Method | Use Case |
|---------|--------|----------|
| `search` | BM25 full-text | Fast keyword search, exact matches |
| `vsearch` | Vector semantic | Conceptual search, similar meanings |
| `query` | Hybrid fusion | Best quality, combines both approaches |

## 📚 Collection Management

```bash
# Add collections
opensearch collection add ~/notes --name "personal" --mask "**/*.md"
opensearch collection add ~/work/docs --name "work"

# List collections
opensearch collection list

# Update all collections (re-index)
opensearch collection update

# Remove a collection
opensearch collection remove personal
```

## 🔧 Advanced Usage

### Search Options

```bash
# Limit results
opensearch query "machine learning" -n 10

# Search specific collection
opensearch search "bug" -c work

# Filter by score threshold
opensearch vsearch "deployment" --min-score 0.5

# JSON output for scripts/agents
opensearch query "authentication" --json
```

### Document Retrieval

```bash
# Get document by path
opensearch get notes/meeting-2024-01-15.md

# Get by document ID (from search results)
opensearch get "#abc12345"

# Limit lines returned
opensearch get notes/long-doc.md -l 50 --from 100
```

## 🤖 OpenClaw Integration

Create a skill to use OpenSearch for efficient memory recall:

```javascript
// In your OpenClaw skill
async function smartMemorySearch(query, options = {}) {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);
  
  const cmd = `opensearch query "${query}" --json --min-score 0.3`;
  const { stdout } = await execAsync(cmd);
  const results = JSON.parse(stdout);
  
  // Return only relevant snippets instead of full files
  return results.map(r => ({
    source: r.path,
    content: r.snippet,
    score: r.score
  }));
}
```

## 📊 Performance & Token Savings

**Before OpenSearch:**
```
User: "What did we decide about API versioning?"
Agent loads: MEMORY.md (50kb) + memory/2024-*.md (200kb) = 250kb context
Token cost: ~60,000 tokens
```

**After OpenSearch:**
```
User: "What did we decide about API versioning?"
OpenSearch finds: 3 relevant snippets (2kb total)
Token cost: ~500 tokens (95% reduction!)
```

## 🏗️ Architecture

OpenSearch Pi uses a multi-layered approach:

1. **BM25 Search**: SQLite FTS5 for fast keyword matching
2. **Vector Search**: Lightweight embeddings using TF-IDF + feature engineering
3. **Hybrid Fusion**: Reciprocal Rank Fusion (RRF) combines both results
4. **Smart Scoring**: Position-aware blending preserves exact matches

### Embedding Strategy

Instead of heavy transformer models, OpenSearch Pi uses:
- **TF-IDF features**: Capture keyword importance
- **N-gram features**: Understand phrase patterns  
- **Character features**: Detect document structure
- **Semantic features**: Simple linguistic patterns

Result: 384-dimensional vectors that work well on ARM64 with minimal compute.

## 🗃️ Data Storage

- **Database**: `~/.cache/opensearch/index.db` (SQLite)
- **Collections**: Defined paths with glob patterns
- **Embeddings**: Stored as JSON vectors in database
- **FTS Index**: Automatic full-text search index

## 🛠️ Development

```bash
# Clone and setup
git clone https://github.com/NYTEMODE/opensearch-pi.git
cd opensearch-pi
npm install

# Run tests
npm test

# Development mode
npm link
```

## 🚧 Roadmap

- [ ] **ONNX Integration**: Optional pre-trained models for better embeddings
- [x] **Real-time Updates**: File system watchers for automatic re-indexing ✅
- [ ] **Query Expansion**: LLM-powered query enhancement
- [ ] **Clustering**: Organize similar documents
- [ ] **Web Interface**: Simple search UI
- [ ] **OpenClaw Plugin**: Native integration

## 📈 Benchmarks

Tested on **Raspberry Pi 4 (4GB)**:

| Operation | Time | Memory |
|-----------|------|--------|
| Index 1000 docs | 30s | 150MB |
| BM25 search | 50ms | 10MB |
| Vector search | 200ms | 50MB |
| Hybrid search | 300ms | 60MB |

## 🤝 Contributing

Built for the OpenClaw community! Contributions welcome:

1. Fork the repo
2. Create feature branch
3. Add tests for new features
4. Submit pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🙏 Acknowledgments

Inspired by QMD's hybrid search approach, adapted for ARM64 compatibility and OpenClaw integration.

---

**Built with ❤️ for the OpenClaw community**

*a nytemode project*