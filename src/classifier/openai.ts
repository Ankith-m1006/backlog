import type { ChatMessage } from '../chat/types.js';
import { getOpenAICallGuard, type OpenAICallGuard } from './openai-guard.js';

export interface Classification {
  id: string;
  isQuestion: boolean;
  normalized: string;
  topicKey: string;
}

interface ClassifyOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
  guard?: OpenAICallGuard;
}

export interface OpenQuestionContext { topicKey: string; normalized: string }

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

const schema = {
  name: 'chat_question_classifications',
  strict: true,
  schema: {
    type: 'object', additionalProperties: false, required: ['results'],
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['id', 'isQuestion', 'normalized', 'topicKey'],
          properties: {
            id: { type: 'string' }, isQuestion: { type: 'boolean' },
            normalized: { type: 'string' }, topicKey: { type: 'string' },
          },
        },
      },
    },
  },
};

export async function classify(messages: ChatMessage[], options: ClassifyOptions, openItems: OpenQuestionContext[] = []): Promise<Classification[]> {
  if (messages.length === 0) return [];
  const request = (options.fetchImpl ?? fetch);
  const guard = options.guard ?? getOpenAICallGuard();
  const response = await guard.run(() => request('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model ?? 'gpt-4.1-mini', temperature: 0,
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [
        { role: 'system', content: 'Identify genuine questions asking the streamer for information. Ignore banter, spam, emote walls, rhetorical remarks, and commands. When a question asks the same thing as an open queue item, reuse that item’s topicKey even if the wording differs; invent a new topicKey only for a genuinely new question. Return only the required JSON. For non-questions, use empty normalized and topicKey strings. Never answer the questions.' },
        { role: 'user', content: JSON.stringify({ openItems: openItems.slice(0, 30), messages: messages.map(({ id, userLogin, text }) => ({ id, user: userLogin, text })) }) },
      ],
    }),
  }));
  if (!response.ok) throw new Error(`OpenAI classification failed (${response.status})`);
  const body = await response.json() as OpenAIResponse;
  const usage = (body as OpenAIResponse & { usage?: { total_tokens?: number } }).usage;
  guard.recordTokens(usage?.total_tokens ?? 0);
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty classification');
  const parsed = JSON.parse(content) as { results?: Classification[] };
  if (!Array.isArray(parsed.results) || parsed.results.length !== messages.length) {
    throw new Error('OpenAI returned the wrong number of classifications');
  }
  return parsed.results.map((result, index) => {
    if (result.id !== messages[index]?.id || typeof result.isQuestion !== 'boolean' || typeof result.normalized !== 'string' || typeof result.topicKey !== 'string') {
      throw new Error(`OpenAI returned an invalid classification at index ${index}`);
    }
    return {
      ...result,
      normalized: result.isQuestion ? result.normalized.trim() : '',
      topicKey: result.isQuestion ? result.topicKey.trim().toLowerCase() : '',
    };
  });
}
