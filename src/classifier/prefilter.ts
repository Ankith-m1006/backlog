import type { ChatMessage } from '../chat/types.js';

const QUESTION_OPENER = /^(?:what|how|why|when|where|who|which|is|are|does|do|can|could|will|would|should|any)\b/iu;
const LINK = /(?:https?:\/\/|www\.|(?:^|\s)[\w-]+\.(?:com|net|org|gg|tv|io|co|ly)(?:\/|\b))/iu;
const EMOTES = new Set([
  'kappa', 'pogchamp', 'poggers', 'lul', 'lulw', 'kekw', 'omegalul', 'trihard', 'biblethump',
  'kreygasm', 'monkas', 'monkaw', 'pausechamp', 'residentsleeper', 'pepega', 'sadge', 'dansgame',
  'wutface', 'notlikethis', 'vohiyo', 'heyguys', 'coolstorybob', 'feelsbadman', 'feelsgoodman',
  'hype', 'catjam', 'widepeepohappy', 'widepeeposad', 'pepelaugh', 'gigachad',
]);

function isEmoteWall(text: string): boolean {
  const tokens = text.split(/\s+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => EMOTES.has(token.replace(/[^a-z0-9_]/giu, '').toLowerCase()));
}

function isRepeatedCharacterSpam(text: string): boolean {
  const compact = text.toLowerCase().replace(/\s+/gu, '');
  return /^(.)\1{3,}[!?]*$/u.test(compact) || /^(?:([a-z]{1,3}))\1{2,}[!?]*$/u.test(compact);
}

export function isCandidate(message: Pick<ChatMessage, 'text' | 'channel'>): boolean {
  const text = message.text.trim();
  if (!text || text.startsWith('!') || LINK.test(text) || isEmoteWall(text) || isRepeatedCharacterSpam(text)) return false;

  const words = text.match(/[\p{L}\p{N}_']+/gu) ?? [];
  if (words.length < 3 && !text.endsWith('?')) return false;

  const channel = message.channel.replace(/^@/u, '').trim();
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const mention = channel.length > 0 && new RegExp(`@${escaped}\\b`, 'iu').test(text);
  return text.endsWith('?') || QUESTION_OPENER.test(text) || mention;
}
