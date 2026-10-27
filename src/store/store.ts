import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { QueueQuestion } from '../classifier/merge.js';

const HALF_LIFE_MS = 5 * 60_000;
export type ItemStatus = 'open' | 'answered' | 'dismissed';
export interface StoredQuestion extends QueueQuestion { status: ItemStatus; pinned: boolean; rankScore: number }
export interface SavedAnswer { id: string; question: string; answer: string; topicKey: string | null; embedding: number[] | null; createdAt: string; updatedAt: string }
export interface AnswerInput { question: string; answer: string; topicKey?: string; embedding?: number[] }

export function rankScore(count: number, updatedAt: string, now = Date.now()): number {
  const ageMs = Math.max(0, now - Date.parse(updatedAt));
  return count * (0.5 ** (ageMs / HALF_LIFE_MS));
}

export class BacklogStore extends EventEmitter {
  private readonly db: Database.Database;

  constructor(path = ':memory:') {
    super();
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY, channel TEXT NOT NULL, topic_key TEXT NOT NULL, normalized TEXT NOT NULL,
        text TEXT NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        pinned INTEGER NOT NULL DEFAULT 0, answer_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS questions_channel_status ON questions(channel, status);
      CREATE TABLE IF NOT EXISTS askers (
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        user_login TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY(question_id, user_login)
      );
      CREATE TABLE IF NOT EXISTS saved_answers (
        id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, topic_key TEXT,
        embedding TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, question_id TEXT,
        details TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL
      );
    `);
  }

  upsertQuestion(question: QueueQuestion): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`INSERT INTO questions (id, channel, topic_key, normalized, text, count, created_at, updated_at)
        VALUES (@id, @channel, @topicKey, @normalized, @text, @count, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET topic_key=excluded.topic_key, normalized=excluded.normalized,
        text=excluded.text, count=excluded.count, updated_at=excluded.updated_at`).run(question);
      const replaceAskers = this.db.prepare('INSERT INTO askers (question_id, user_login, message_count) VALUES (?, ?, ?)');
      this.db.prepare('DELETE FROM askers WHERE question_id = ?').run(question.id);
      for (const [login, count] of Object.entries(question.askerCounts)) replaceAskers.run(question.id, login, count);
      this.recordEvent('question.updated', question.id, { count: question.count });
    });
    tx();
    this.emit('queueChanged');
  }

  getQueue(now = Date.now()): StoredQuestion[] {
    const rows = this.db.prepare("SELECT * FROM questions WHERE status = 'open'").all() as Array<Record<string, unknown>>;
    const items = rows.map((row) => {
      const counts = this.db.prepare('SELECT user_login, message_count FROM askers WHERE question_id = ? ORDER BY user_login').all(row.id) as Array<{ user_login: string; message_count: number }>;
      const askerCounts = Object.fromEntries(counts.map((item) => [item.user_login, item.message_count]));
      const updatedAt = String(row.updated_at);
      return {
        id: String(row.id), channel: String(row.channel), topicKey: String(row.topic_key), normalized: String(row.normalized),
        text: String(row.text), count: Number(row.count), askers: Object.keys(askerCounts), askerCounts,
        createdAt: String(row.created_at), updatedAt, status: String(row.status) as ItemStatus,
        pinned: Boolean(row.pinned), rankScore: rankScore(Number(row.count), updatedAt, now),
      } satisfies StoredQuestion;
    });
    return items.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.rankScore - left.rankScore || right.updatedAt.localeCompare(left.updatedAt));
  }

  setAnswered(id: string): boolean { return this.setStatus(id, 'answered'); }
  dismiss(id: string): boolean { return this.setStatus(id, 'dismissed'); }

  togglePin(id: string): boolean | undefined {
    const row = this.db.prepare('SELECT pinned FROM questions WHERE id = ?').get(id) as { pinned: number } | undefined;
    if (!row) return undefined;
    const pinned = row.pinned ? 0 : 1;
    this.db.prepare('UPDATE questions SET pinned = ? WHERE id = ?').run(pinned, id);
    this.recordEvent(pinned ? 'question.pinned' : 'question.unpinned', id);
    this.emit('queueChanged');
    return Boolean(pinned);
  }

  listAnswers(): SavedAnswer[] {
    const rows = this.db.prepare('SELECT * FROM saved_answers ORDER BY updated_at DESC').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id), question: String(row.question), answer: String(row.answer),
      topicKey: row.topic_key === null ? null : String(row.topic_key),
      embedding: row.embedding ? JSON.parse(String(row.embedding)) as number[] : null,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  createAnswer(input: AnswerInput): SavedAnswer { return this.writeAnswer(randomUUID(), input); }
  updateAnswer(id: string, input: AnswerInput): SavedAnswer | undefined {
    const exists = this.db.prepare('SELECT 1 FROM saved_answers WHERE id = ?').get(id);
    return exists ? this.writeAnswer(id, input, true) : undefined;
  }
  deleteAnswer(id: string): boolean {
    const result = this.db.prepare('DELETE FROM saved_answers WHERE id = ?').run(id);
    if (result.changes > 0) this.recordEvent('answer.deleted', null, { answerId: id });
    return result.changes > 0;
  }

  getEvents(): Array<{ eventType: string; questionId: string | null; details: unknown; occurredAt: string }> {
    return (this.db.prepare('SELECT * FROM events ORDER BY id').all() as Array<Record<string, unknown>>).map((row) => ({
      eventType: String(row.event_type), questionId: row.question_id === null ? null : String(row.question_id),
      details: JSON.parse(String(row.details)), occurredAt: String(row.occurred_at),
    }));
  }

  close(): void { this.db.close(); }

  private setStatus(id: string, status: Exclude<ItemStatus, 'open'>): boolean {
    const result = this.db.prepare('UPDATE questions SET status = ? WHERE id = ?').run(status, id);
    if (result.changes === 0) return false;
    this.recordEvent(`question.${status}`, id);
    this.emit('queueChanged');
    return true;
  }

  private writeAnswer(id: string, input: AnswerInput, update = false): SavedAnswer {
    const now = new Date().toISOString();
    if (update) {
      this.db.prepare('UPDATE saved_answers SET question=?, answer=?, topic_key=?, embedding=?, updated_at=? WHERE id=?')
        .run(input.question, input.answer, input.topicKey ?? null, input.embedding ? JSON.stringify(input.embedding) : null, now, id);
    } else {
      this.db.prepare('INSERT INTO saved_answers (id, question, answer, topic_key, embedding, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, input.question, input.answer, input.topicKey ?? null, input.embedding ? JSON.stringify(input.embedding) : null, now, now);
    }
    this.recordEvent(update ? 'answer.updated' : 'answer.created', null, { answerId: id });
    return this.listAnswers().find((answer) => answer.id === id)!;
  }

  private recordEvent(type: string, questionId: string | null, details: Record<string, unknown> = {}): void {
    this.db.prepare('INSERT INTO events (event_type, question_id, details, occurred_at) VALUES (?, ?, ?, ?)')
      .run(type, questionId, JSON.stringify(details), new Date().toISOString());
  }
}
