import natural from 'natural';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Simple lightweight embedding engine for ARM64 compatibility
export class EmbeddingEngine {
  constructor() {
    this.tfidf = new natural.TfIdf();
    this.vocabulary = new Map();
    this.dimensions = 384; // Standard dimension for many embedding models
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Load or create vocabulary
    await this.loadVocabulary();
    this.initialized = true;
  }

  // Generate embedding for text using TF-IDF + dimensionality reduction
  async embed(text) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Clean and tokenize text
    const cleanText = this.preprocessText(text);
    const tokens = natural.WordTokenizer.tokenize(cleanText);
    
    if (!tokens || tokens.length === 0) {
      return new Array(this.dimensions).fill(0);
    }

    // Create TF-IDF document
    this.tfidf.addDocument(tokens);
    const docIndex = this.tfidf.documents.length - 1;
    
    // Generate feature vector
    const vector = this.createFeatureVector(tokens, docIndex);
    
    // Remove the temporary document
    this.tfidf.documents.splice(docIndex, 1);
    
    return this.normalizeVector(vector);
  }

  // Preprocess text for embedding
  preprocessText(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Remove punctuation
      .replace(/\s+/g, ' ')      // Normalize whitespace
      .trim();
  }

  // Create feature vector from tokens
  createFeatureVector(tokens, docIndex) {
    const vector = new Array(this.dimensions).fill(0);
    const termFreq = new Map();
    
    // Count term frequencies
    for (const token of tokens) {
      const stemmed = natural.PorterStemmer.stem(token);
      termFreq.set(stemmed, (termFreq.get(stemmed) || 0) + 1);
    }

    // Generate features using multiple strategies
    let featureIndex = 0;
    
    // 1. TF-IDF features (first 128 dimensions)
    for (const [term, freq] of termFreq.entries()) {
      if (featureIndex >= 128) break;
      
      const tfidfScore = this.tfidf.tfidf(term, docIndex);
      vector[featureIndex] = tfidfScore;
      featureIndex++;
    }
    
    // 2. N-gram features (next 128 dimensions)
    featureIndex = 128;
    const bigrams = this.generateNGrams(tokens, 2);
    for (const bigram of bigrams) {
      if (featureIndex >= 256) break;
      
      const hash = this.hashFeature(bigram) % 128;
      vector[128 + hash] += 1 / bigrams.length;
    }
    
    // 3. Character-level features (next 64 dimensions)
    featureIndex = 256;
    const charFeatures = this.generateCharFeatures(tokens.join(' '));
    for (let i = 0; i < Math.min(64, charFeatures.length); i++) {
      vector[256 + i] = charFeatures[i];
    }
    
    // 4. Semantic features (remaining dimensions)
    featureIndex = 320;
    const semanticFeatures = this.generateSemanticFeatures(tokens);
    for (let i = 0; i < Math.min(64, semanticFeatures.length); i++) {
      vector[320 + i] = semanticFeatures[i];
    }
    
    return vector;
  }

  // Generate n-grams from tokens
  generateNGrams(tokens, n) {
    const ngrams = [];
    for (let i = 0; i <= tokens.length - n; i++) {
      ngrams.push(tokens.slice(i, i + n).join(' '));
    }
    return ngrams;
  }

  // Generate character-level features
  generateCharFeatures(text) {
    const features = [];
    const chars = text.split('');
    
    // Character frequency features
    const charFreq = new Map();
    for (const char of chars) {
      charFreq.set(char, (charFreq.get(char) || 0) + 1);
    }
    
    // Convert to normalized features
    const totalChars = chars.length;
    const sortedChars = Array.from(charFreq.entries()).sort((a, b) => b[1] - a[1]);
    
    for (let i = 0; i < Math.min(32, sortedChars.length); i++) {
      features.push(sortedChars[i][1] / totalChars);
    }
    
    // Statistical features
    features.push(text.length / 1000);  // Normalized length
    features.push((text.match(/[A-Z]/g) || []).length / totalChars);  // Uppercase ratio
    features.push((text.match(/\d/g) || []).length / totalChars);     // Digit ratio
    features.push((text.match(/\s/g) || []).length / totalChars);     // Whitespace ratio
    
    return features;
  }

  // Generate semantic features using word patterns
  generateSemanticFeatures(tokens) {
    const features = [];
    
    // POS tag distribution (simplified)
    const posCount = { noun: 0, verb: 0, adj: 0, other: 0 };
    
    for (const token of tokens) {
      // Simple heuristic POS tagging
      if (token.endsWith('ing') || token.endsWith('ed') || token.endsWith('s')) {
        posCount.verb++;
      } else if (token.endsWith('ly') || token.endsWith('al') || token.endsWith('ful')) {
        posCount.adj++;
      } else if (token.length > 4 && !token.endsWith('ly')) {
        posCount.noun++;
      } else {
        posCount.other++;
      }
    }
    
    const totalTokens = tokens.length;
    features.push(posCount.noun / totalTokens);
    features.push(posCount.verb / totalTokens);
    features.push(posCount.adj / totalTokens);
    features.push(posCount.other / totalTokens);
    
    // Word length distribution
    const lengths = tokens.map(t => t.length);
    features.push(this.mean(lengths) / 10);  // Average word length
    features.push(this.stddev(lengths) / 10); // Length variance
    
    // Complexity features
    const longWords = tokens.filter(t => t.length > 6).length;
    features.push(longWords / totalTokens);
    
    const uniqueWords = new Set(tokens).size;
    features.push(uniqueWords / totalTokens);  // Lexical diversity
    
    return features;
  }

  // Hash a feature to a bucket
  hashFeature(feature) {
    const hash = crypto.createHash('md5').update(feature).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  // Normalize vector to unit length
  normalizeVector(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    
    return vector.map(val => val / magnitude);
  }

  // Statistical helper functions
  mean(arr) {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  stddev(arr) {
    const avg = this.mean(arr);
    const variance = arr.reduce((sum, val) => sum + (val - avg) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
  }

  // Load/save vocabulary (for future improvements)
  async loadVocabulary() {
    // For now, we'll build vocabulary on-the-fly
    // In a more advanced version, we could pre-train on a corpus
    this.vocabulary = new Map();
  }

  // Batch embedding for efficiency
  async embedBatch(texts) {
    const embeddings = [];
    for (const text of texts) {
      embeddings.push(await this.embed(text));
    }
    return embeddings;
  }

  // Similarity computation
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Find most similar embeddings
  findSimilar(queryEmbedding, candidateEmbeddings, topK = 5) {
    const similarities = candidateEmbeddings.map((embedding, index) => ({
      index,
      similarity: this.cosineSimilarity(queryEmbedding, embedding)
    }));
    
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}

// Alternative: Sentence transformer-like approach for better quality
export class SentenceEmbeddingEngine extends EmbeddingEngine {
  constructor() {
    super();
    this.model = null;
  }

  // This would integrate with a pre-trained model if available
  async initialize() {
    // Try to load a pre-trained model (placeholder)
    try {
      // In a real implementation, this could load something like:
      // - Universal Sentence Encoder
      // - MiniLM
      // - All-MiniLM-L6-v2 (converted to ONNX)
      console.log('Using lightweight TF-IDF based embeddings');
      await super.initialize();
    } catch (error) {
      console.warn('Pre-trained model not available, using TF-IDF fallback');
      await super.initialize();
    }
  }
}

// Export default engine
export default EmbeddingEngine;