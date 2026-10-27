import { getOpenAICallGuard, type OpenAICallGuard } from './openai-guard.js';

interface EmbeddingOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  guard?: OpenAICallGuard;
  onUsage?: (tokens: number) => void;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  usage?: { total_tokens?: number };
}

export async function embedText(text: string, options: EmbeddingOptions): Promise<number[]> {
  const vectors = await embedTexts([text], options);
  return vectors[0]!;
}

export async function embedTexts(texts: string[], options: EmbeddingOptions): Promise<number[][]> {
  if (!texts.length) return [];
  const guard = options.guard ?? getOpenAICallGuard();
  const response = await guard.run(() => (options.fetchImpl ?? fetch)('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: options.model ?? 'text-embedding-3-small', input: texts }),
  }));
  if (!response.ok) throw new Error(`OpenAI embedding failed (${response.status})`);
  const body = await response.json() as EmbeddingResponse;
  const vectors = body.data?.map((entry) => entry.embedding ?? []);
  if (!vectors || vectors.length !== texts.length || vectors.some((vector) => !vector.length || vector.some((value) => !Number.isFinite(value)))) throw new Error('OpenAI returned invalid embeddings');
  guard.recordTokens(body.usage?.total_tokens ?? 0);
  options.onUsage?.(body.usage?.total_tokens ?? 0);
  return vectors;
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
