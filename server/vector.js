import { readPrivateText } from './privacy.js';

const DIMENSIONS = 64;

function tokenize(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

export function createEmbedding(input, path = []) {
  const text = readPrivateText(input, path);
  const vector = Array(DIMENSIONS).fill(0);
  for (const token of tokenize(text)) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % DIMENSIONS] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left, right) {
  return left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);
}

export function chunkText(text, maxWords = 90) {
  const words = String(text).trim().split(/\s+/);
  const chunks = [];
  for (let index = 0; index < words.length; index += maxWords) {
    chunks.push(words.slice(index, index + maxWords).join(' '));
  }
  return chunks.filter(Boolean);
}
