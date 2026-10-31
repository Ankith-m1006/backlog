import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { requireLiveMode } from './config/mode.js';
import { classify, type Classification, type OpenQuestionContext } from './classifier/openai.js';
import { isCandidate } from './classifier/prefilter.js';
import { embedTexts, cosineSimilarity } from './classifier/embedding.js';
import { env } from './config/env.js';

interface Label { id: string; user: string; text: string; isQuestion: boolean; topicKey: string; channel?: string }
function message(label: Label) { return { id: label.id, channel: label.channel ?? 'eval', userId: label.user, userLogin: label.user, displayName: label.user, text: label.text, isMod: false, isBroadcaster: false, isBot: false, sentAt: new Date().toISOString() }; }
function detection(labels: Label[], predicted: boolean[]): { precision: number; recall: number; f1: number } {
  let tp = 0, fp = 0, fn = 0;
  labels.forEach((item, i) => { if (item.isQuestion && predicted[i]) tp++; else if (!item.isQuestion && predicted[i]) fp++; else if (item.isQuestion) fn++; });
  const precision = tp / (tp + fp || 1), recall = tp / (tp + fn || 1);
  return { precision, recall, f1: 2 * precision * recall / (precision + recall || 1) };
}
function pairAccuracy(labels: Label[], keys: string[]): number {
  const questions = labels.map((item, i) => ({ item, key: keys[i] })).filter(({ item }) => item.isQuestion);
  let correct = 0, total = 0;
  for (let i = 0; i < questions.length; i++) for (let j = i + 1; j < questions.length; j++) {
    const same = questions[i]!.item.topicKey === questions[j]!.item.topicKey;
    const merged = Boolean(questions[i]!.key && questions[i]!.key === questions[j]!.key);
    total++; if (same === merged) correct++;
  }
  return total ? correct / total : 0;
}
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
requireLiveMode();
if (!env('OPENAI_API_KEY')) throw new Error('OPENAI_API_KEY is required for live evaluation');
const raw = await readFile('data/real/labels.jsonl', 'utf8').catch(() => '');
const labels = raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Label);
if (labels.length < 150) throw new Error(`Live evaluation needs 150 real labels in data/real/labels.jsonl; found ${labels.length}.`);
const candidates = labels.map((item) => isCandidate({ text: item.text, channel: item.channel ?? 'eval' }));
const fullStats = { input: 0, output: 0, embedding: 0 };
const baselineStats = { input: 0, output: 0 };
const classifyBatch = async (items: Label[], context: OpenQuestionContext[] = [], usage: { input: number; output: number } = fullStats): Promise<Classification[]> => classify(items.map(message), {
  apiKey: env('OPENAI_API_KEY')!, model: env('OPENAI_MODEL'),
  onUsage: (counts) => { usage.input += counts.inputTokens; usage.output += counts.outputTokens; },
}, context);
const selected = labels.filter((_item, i) => candidates[i]);
const simpleResults: Classification[] = [];
const startSimple = performance.now();
for (let i = 0; i < selected.length; i += 30) simpleResults.push(...await classifyBatch(selected.slice(i, i + 30), [], baselineStats));
const simpleLatency = selected.length ? (performance.now() - startSimple) / Math.ceil(selected.length / 30) : 0;
const simpleById = new Map(simpleResults.map((result) => [result.id, result]));
const simplePred = labels.map((item, i) => candidates[i]! && (simpleById.get(item.id)?.isQuestion ?? false));
const simpleKeys = labels.map((item, i) => simplePred[i] ? simpleById.get(item.id)?.topicKey ?? '' : '');
const fullResults: Array<Classification | undefined> = Array(labels.length);
const fullKeys = labels.map(() => '');
const fullPred = labels.map(() => false);
const open: Array<{ topicKey: string; normalized: string; embedding: number[]; key: string }> = [];
const batchTimes: number[] = [];
for (let i = 0; i < labels.length; i += 30) {
  const indices = labels.slice(i, i + 30).map((_item, offset) => i + offset).filter((index) => candidates[index]);
  if (!indices.length) continue;
  const began = performance.now();
  const results = await classifyBatch(indices.map((index) => labels[index]!), open.slice(-30).map(({ topicKey, normalized }) => ({ topicKey, normalized })));
  batchTimes.push(performance.now() - began);
  const questionResults = results.map((result, j) => ({ result, index: indices[j]! })).filter(({ result }) => result.isQuestion);
  const vectors = await embedTexts(questionResults.map(({ result, index }) => result.normalized || labels[index]!.text), {
    apiKey: env('OPENAI_API_KEY')!, onUsage: (tokens) => { fullStats.embedding += tokens; },
  });
  for (const [j, { result, index }] of questionResults.entries()) {
    fullResults[index] = result;
    fullPred[index] = true;
    const vector = vectors[j]!;
    const match = open.map((item) => ({ item, score: cosineSimilarity(vector, item.embedding) })).sort((a, b) => b.score - a.score)[0];
    const existingKey = match && match.score >= 0.88 ? match.item.key : result.topicKey;
    fullKeys[index] = existingKey;
    if (match && match.score >= 0.88) match.item.key = existingKey;
    else open.push({ topicKey: result.topicKey, normalized: result.normalized, embedding: vector, key: result.topicKey });
  }
}
const fullDetection = detection(labels, fullPred);
const simpleDetection = detection(labels, simplePred);
const rulesPred = candidates;
const rulesKeys = labels.map((item, i) => rulesPred[i] ? item.text.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ') : '');
const rulesDetection = detection(labels, rulesPred);
const systems = [
  { name: 'Rules-only prefilter', detection: rulesDetection, pair: pairAccuracy(labels, rulesKeys), latency: 0 },
  { name: 'Classifier, no context', detection: simpleDetection, pair: pairAccuracy(labels, simpleKeys), latency: simpleLatency },
  { name: 'Full Backlog', detection: fullDetection, pair: pairAccuracy(labels, fullKeys), latency: batchTimes.length ? batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length : 0 },
];
const totalMessages = labels.length;
const totalCost = fullStats.input * 0.1 / 1e6 + fullStats.output * 0.5 / 1e6 + fullStats.embedding * 0.02 / 1e6;
const worst = labels.map((item, i) => ({ item, missed: item.isQuestion && !fullPred[i] })).filter((row) => row.missed).slice(0, 5);
const lines = ['# Real chat evaluation', '', `Evaluated ${totalMessages} hand-labelled messages from anonymized Twitch IRC captures. Classifier: \`${env('OPENAI_MODEL') ?? 'gpt-6-luna'}\`; duplicate merge uses embedding cosine >= 0.88.`, '', '| System | Question precision | Recall | F1 | Duplicate-pair accuracy | Avg batch latency |', '|---|---:|---:|---:|---:|---:|', ...systems.map((row) => `| ${row.name} | ${pct(row.detection.precision)} | ${pct(row.detection.recall)} | ${pct(row.detection.f1)} | ${pct(row.pair)} | ${row.latency.toFixed(0)} ms |`), '', `Full Backlog measured API cost: approximately $${(totalCost * 1000 / totalMessages).toFixed(4)} per 1,000 chat messages (classifier input ${fullStats.input}, output ${fullStats.output}, embedding ${fullStats.embedding} tokens). The no-context baseline used an additional input ${baselineStats.input} and output ${baselineStats.output} classifier tokens.`, '', '## Worst five misses', '', ...(worst.length ? worst.map(({ item }) => `- ${item.text}`) : ['- None.']), ''];
const report = lines.join('\n');
await mkdir('docs', { recursive: true });
await writeFile('docs/EVAL.md', report, 'utf8');
console.log(report);
