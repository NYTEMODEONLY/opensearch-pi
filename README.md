# OpenSearch Pi

ARM64-compatible hybrid search engine for markdown files, built specifically for Raspberry Pi and OpenClaw integration.

## 🚀 Why OpenSearch Pi?

- **ARM64 Native**: Works perfectly on Raspberry Pi (no exotic runtime dependencies)
- **Hybrid Search**: Combines BM25 full-text + vector semantic search
- **Lightweight**: Small footprint, efficient on low-power devices
- **OpenClaw Optimized**: Built for memory files, documentation, and knowledge bases
- **Token Efficient**: Dramatically reduces API calls by finding only relevant content

## 📊 Token Savings

| Approach | Tokens Used | Cost |
|----------|-------------|------|
| Load all memory files | ~60,000 | High |
| Built-in memory_search | ~15,000 | Medium |
| **OpenSearch Pi** | ~2,000 | **95% savings** |

## ⚡ Quick Start

```bash
# Clone the repo
git clone https://github.com/NYTEMODEONLY/opensearch-pi
cd opensearch-pi

# Install dependencies
npm install

# Install globally
npm install -g .

# Add your workspace collection
opensearch collection add ~/.openclaw/workspace --name "workspace"

# Generate embeddings
opensearch embed

# Test it
opensearch query "your search term"
```

## 🤖 OpenClaw Integration (IMPORTANT)

### Step 1: Block Built-in memory_search

Add this to your `~/.openclaw/openclaw.json` to force the agent to use OpenSearch Pi instead of the built-in memory_search tool:

```json
{
  "tools": {
    "profile": "full",
    "deny": [
      "memory_search"
    ]
  }
}
```

**Why this works:** The `tools.deny` array blocks specific tools from being available to agents. By blocking `memory_search`, the agent can't use the built-in (token-heavy) search and must use the `opensearch` CLI command instead.

### Step 2: Add Instructions to AGENTS.md

Add this to your `~/.openclaw/workspace/AGENTS.md`:

```markdown
### 🔍 OpenSearch Pi - ALWAYS USE THIS FOR MEMORY QUERIES

**Before loading any memory file, use opensearch:**
\`\`\`bash
opensearch context "your query"   # Returns JSON with relevant snippets
opensearch query "your query"     # Human-readable hybrid search
\`\`\`

**Why:** Reduces token usage by ~95%. Instead of loading 250kb of files, you get only the relevant 2kb snippets.

**Auto-reindex:** A file watcher automatically re-indexes when workspace files change.
```

### Step 3: Set Up Auto-Reindex Service

```bash
# Install inotify-tools
sudo apt-get install -y inotify-tools

# Create watch script
mkdir -p ~/.openclaw/workspace/scripts

cat > ~/.openclaw/workspace/scripts/opensearch-watch.sh << 'EOF'
#!/bin/bash
WORKSPACE="$HOME/.openclaw/workspace"
INTERVAL=300

reindex() {
    opensearch collection update >/dev/null 2>&1
}

if command -v inotifywait &> /dev/null; then
    echo "Watching $WORKSPACE for changes..."
    while true; do
        inotifywait -r -e modify,create,delete,move "$WORKSPACE" --exclude '\.git' -qq
        sleep 2
        reindex
    done
else
    echo "Using periodic refresh every ${INTERVAL}s"
    while true; do
        sleep $INTERVAL
        reindex
    done
fi
EOF

chmod +x ~/.openclaw/workspace/scripts/opensearch-watch.sh
```

### Step 4: Create systemd Service

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

systemctl --user daemon-reload
systemctl --user enable opensearch-watch.service
systemctl --user start opensearch-watch.service
```

### Complete OpenClaw Config Example

Here's a full `~/.openclaw/openclaw.json` with OpenSearch Pi + Claude Max Proxy integration:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "claude-max": {
        "baseUrl": "http://127.0.0.1:3456/v1",
        "apiKey": "not-needed",
        "api": "openai-completions",
        "models": [
          {
            "id": "claude-opus-4",
            "name": "Claude Opus 4.5 (via Max Proxy)",
            "reasoning": true,
            "contextWindow": 200000,
            "maxTokens": 65536
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "workspace": "/home/lobo/.openclaw/workspace",
      "model": { "primary": "claude-max/claude-opus-4" },
      "compaction": {
        "mode": "safeguard",
        "maxHistoryShare": 0.3,
        "reserveTokensFloor": 50000,
        "memoryFlush": {
          "enabled": true,
          "softThresholdTokens": 40000
        }
      },
      "contextTokens": 60000
    }
  },
  "tools": {
    "profile": "full",
    "exec": {
      "timeoutSec": 300,
      "security": "full",
      "ask": "off"
    },
    "deny": [
      "memory_search"
    ]
  }
}
```

## 🔍 Search Modes

| Command | Method | Use Case |
|---------|--------|----------|
| `search` | BM25 full-text | Fast keyword search, exact matches |
| `vsearch` | Vector semantic | Conceptual search, similar meanings |
| `query` | Hybrid fusion | Best quality, combines both approaches |
| `context` | Smart retrieval | Best for agents, returns JSON |

## 📚 Collection Management

```bash
# Add collections
opensearch collection add ~/notes --name "personal" --mask "**/*.md"
opensearch collection add ~/.openclaw/workspace --name "workspace"

# List collections
opensearch collection list

# Update all collections (re-index)
opensearch collection update

# Remove a collection
opensearch collection remove personal
```

## 🔧 Search Commands

```bash
# Keyword search
opensearch search "API authentication" -n 5

# Semantic search
opensearch vsearch "how to deploy" --min-score 0.5

# Hybrid search (recommended)
opensearch query "error handling" --json

# Smart context for agents
opensearch context "user preferences" --raw
```

## 📈 Performance

Tested on **Raspberry Pi 4 (4GB)**:

| Operation | Time | Memory |
|-----------|------|--------|
| Index 1000 docs | 30s | 150MB |
| BM25 search | 50ms | 10MB |
| Vector search | 200ms | 50MB |
| Hybrid search | 300ms | 60MB |

## 🏗️ Architecture

OpenSearch Pi uses a multi-layered approach:

1. **BM25 Search**: SQLite FTS5 for fast keyword matching
2. **Vector Search**: Lightweight TF-IDF embeddings (no heavy transformers)
3. **Hybrid Fusion**: Reciprocal Rank Fusion (RRF) combines both results
4. **384-dim Vectors**: Efficient on ARM64 with minimal compute

## 🗃️ Data Storage

- **Database**: `~/.cache/opensearch/index.db` (SQLite)
- **Collections**: Defined paths with glob patterns
- **Embeddings**: JSON vectors stored in database

## 🔗 Related Projects

- [Claude Max Proxy](https://github.com/NYTEMODEONLY/claude-max-proxy) - Use Claude Max subscription with OpenClaw
- [OpenClaw](https://github.com/openclaw) - The AI agent framework

## 📄 License

MIT License

---

**Built with ❤️ for the OpenClaw community**

*a [NYTEMODE](https://github.com/NYTEMODEONLY) project*
