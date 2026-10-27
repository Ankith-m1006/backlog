import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { isCandidate } from './classifier/prefilter.js';

interface Recorded { offsetMs: number; user: string; text: string; channel: string }
const directory = 'data/real';
const files = (await readdir(directory).catch(() => [])).filter((file) => file.endsWith('.jsonl') && file !== 'labels.jsonl');
const pool: Recorded[] = [];
for (const file of files) {
  const lines = (await readFile(`${directory}/${file}`, 'utf8')).split(/\r?\n/u).filter(Boolean);
  const channel = file.split('-')[0]!.replace(/[^a-z0-9_]/giu, '').toLowerCase();
  pool.push(...lines.map((line) => ({ ...(JSON.parse(line) as Omit<Recorded, 'channel'>), channel })));
}
if (pool.length < 150) throw new Error(`Need at least 150 recorded messages; found ${pool.length}. Run pnpm record-chat first.`);
const candidates = pool.filter((line) => isCandidate({ text: line.text, channel: line.channel }));
const nonCandidates = pool.filter((line) => !isCandidate({ text: line.text, channel: line.channel }));
const shuffled = <T,>(values: T[]): T[] => [...values].sort(() => Math.random() - 0.5);
const selected = candidates.length >= 150 ? shuffled(candidates).slice(0, 150) : [...shuffled(candidates), ...shuffled(nonCandidates).slice(0, 150 - candidates.length)];
const io = createInterface({ input: stdin, output: stdout });
const labels: Array<Recorded & { id: string; isQuestion: boolean; topicKey: string }> = [];
for (const [index, message] of selected.entries()) {
  stdout.write(`\n${index + 1}/150  ${message.user}: ${message.text}\n`);
  let answer = '';
  while (!['y', 'n'].includes(answer.toLowerCase())) answer = (await io.question('Real question to the streamer? [y/n] ')).trim();
  const isQuestion = answer.toLowerCase() === 'y';
  const topicKey = isQuestion ? (await io.question('Short topic key (same key for duplicates): ')).trim().toLowerCase() : '';
  labels.push({ ...message, id: `label-${index + 1}`, isQuestion, topicKey });
}
io.close();
await writeFile(`${directory}/labels.jsonl`, `${labels.map((label) => JSON.stringify(label)).join('\n')}\n`, 'utf8');
console.log(`Saved ${labels.length} labels to ${directory}/labels.jsonl`);
