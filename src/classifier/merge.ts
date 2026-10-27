import type { ChatMessage } from '../chat/types.js';
import type { Classification } from './openai.js';

export interface QueueQuestion {
  id: string;
  channel: string;
  topicKey: string;
  normalized: string;
  text: string;
  count: number;
  askers: string[];
  createdAt: string;
  updatedAt: string;
}

export class QuestionMerger {
  private readonly questions = new Map<string, QueueQuestion>();

  add(message: ChatMessage, classification: Classification): QueueQuestion | undefined {
    if (!classification.isQuestion || !classification.topicKey) return undefined;
    const key = `${message.channel.toLowerCase()}:${classification.topicKey.trim().toLowerCase()}`;
    const existing = this.questions.get(key);
    if (existing) {
      existing.count += 1;
      if (!existing.askers.includes(message.userLogin)) existing.askers.push(message.userLogin);
      existing.updatedAt = message.sentAt;
      return existing;
    }
    const question: QueueQuestion = {
      id: message.id,
      channel: message.channel,
      topicKey: classification.topicKey.trim().toLowerCase(),
      normalized: classification.normalized.trim(),
      text: message.text,
      count: 1,
      askers: [message.userLogin],
      createdAt: message.sentAt,
      updatedAt: message.sentAt,
    };
    this.questions.set(key, question);
    return question;
  }

  mergeInto(id: string, message: ChatMessage): QueueQuestion | undefined {
    const question = [...this.questions.values()].find((item) => item.id === id && item.channel.toLowerCase() === message.channel.toLowerCase());
    if (!question) return undefined;
    question.count += 1;
    if (!question.askers.includes(message.userLogin)) question.askers.push(message.userLogin);
    question.updatedAt = message.sentAt;
    return question;
  }

  recent(limit = 30): QueueQuestion[] {
    return this.list().sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
  }

  list(): QueueQuestion[] {
    return [...this.questions.values()].map((question) => ({ ...question, askers: [...question.askers] }));
  }
}
