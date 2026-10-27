import { getOpenAICallGuard, type OpenAICallGuard } from './openai-guard.js';

interface EmbeddingOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  guard?: OpenAICallGuard;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  usage?: { total_tokens?: number };
}

export async function embedText(text: string, options: EmbeddingOptions): Promise<number[]> {
  const guard = options.guard ?? getOpenAICallGuard();
  const response = await guard.run(() => (options.fetchImpl ?? fetch)('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model ?? 'text-embedding-3-small', input: text }),
  }));
  if (!response.ok) throw new Error(`OpenAI embedding failed (${response.status})`);
  const body = await response.json() as EmbeddingResponse;
  const vector = body.data?.[0]?.embedding;
  if (!vector?.length || vector.some((value) => !Number.isFinite(value))) throw new Error('OpenAI returned an invalid embedding');
  guard.recordTokens(body.usage?.total_tokens ?? 0);
  return vector;
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!;
    leftNorm += left[index]! ** 2;
    rightNorm += right[index]! ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
