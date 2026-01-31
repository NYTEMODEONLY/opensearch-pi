---
name: smart-context
description: "Use OpenSearch Pi for token-efficient context retrieval. Saves 90%+ tokens by loading only relevant snippets instead of full files."
metadata: {"openclaw":{"emoji":"🧠","requires":{"bins":["opensearch"]}}}
---

# Smart Context Skill

Use `opensearch` for intelligent context retrieval. This dramatically reduces token usage by loading only relevant content instead of full files.

## Why This Matters

Loading full files wastes tokens:
- MEMORY.md might be 50K tokens
- AGENTS.md might be 10K tokens
- But you only need ~500 tokens of relevant context

**Smart context saves 90%+ tokens.**

## Usage

### Get Context for a Query
```bash
# Get relevant context for what you're working on
opensearch context "user preferences" --workspace ~/.openclaw/workspace --raw

# JSON output for parsing
opensearch context "discord setup" --json
```

### Search Memory
```bash
# Find relevant snippets
opensearch search "API keys" --limit 3

# Search specific content
opensearch query "user timezone"
```

### Get Specific File Section
```bash
# Get first 50 lines of a file
opensearch get MEMORY.md --lines 50
```

## Integration Pattern

**INSTEAD OF:**
```bash
# DON'T DO THIS - wastes tokens
cat ~/.openclaw/workspace/MEMORY.md
cat ~/.openclaw/workspace/AGENTS.md
```

**DO THIS:**
```bash
# Smart context retrieval
opensearch context "what I'm looking for" --raw
```

## When to Use Full Files

Only load full files when:
1. User explicitly asks to see entire file
2. You need to edit/update the file
3. File is small (<500 tokens)

## Token Savings Example

| Approach | Tokens Used |
|----------|-------------|
| Load all memory files | ~50,000 |
| Smart context search | ~2,000 |
| **Savings** | **96%** |

## Commands Reference

| Command | Use Case |
|---------|----------|
| `opensearch context "<query>"` | Get relevant context (best) |
| `opensearch search "<query>"` | Find specific mentions |
| `opensearch get <file>` | Get file or portion |
| `opensearch status` | Check indexed files |
