import { env } from './config/env.js';

const file = process.argv[2] ?? 'data/sample-chat.synthetic.jsonl';
const speed = process.argv[3] ?? '1';
if (!env('BACKLOG_MODE')) process.env.BACKLOG_MODE = 'demo';
process.env.BACKLOG_REPLAY_FILE = file;
process.env.REPLAY_SPEED = speed;
console.log(`Starting Backlog demo replay from ${file} at ${speed}x; open http://127.0.0.1:3001/control`);
await import('./server/main.js');
