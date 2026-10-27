import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';
import { parseIrcLine, pseudonymize, type IrcChatLine } from './chat/irc.js';

const channel = process.argv[2]?.replace(/^#/u, '').toLowerCase();
const minutes = Number(process.argv[3]);
if (!channel || !/^[a-z0-9_]{1,25}$/u.test(channel) || !Number.isFinite(minutes) || minutes <= 0) {
  throw new Error('Usage: pnpm record-chat <channel> <minutes>');
}
const socket = new WebSocket('wss://irc-ws.chat.twitch.tv');
const messages: IrcChatLine[] = [];
const target = join('data', 'real', `${channel}-${new Date().toISOString().slice(0, 10)}.jsonl`);
socket.on('open', () => {
  socket.send(`NICK justinfan${Math.floor(Math.random() * 1_000_000_000)}`);
  socket.send(`JOIN #${channel}`);
  console.log(`Recording public chat from #${channel} for ${minutes} minutes; usernames are pseudonymized before writing.`);
});
socket.on('message', (raw: Buffer) => {
  for (const line of raw.toString().split(/\r?\n/u)) {
    if (line.startsWith('PING ')) { socket.send(line.replace(/^PING/u, 'PONG')); continue; }
    const parsed = parseIrcLine(line);
    if (parsed) messages.push(parsed);
  }
});
socket.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
const timer = setTimeout(() => socket.close(), minutes * 60_000);
socket.on('close', async () => {
  clearTimeout(timer);
  const safe = pseudonymize(messages);
  await mkdir(join('data', 'real'), { recursive: true });
  await writeFile(target, `${safe.map((line) => JSON.stringify(line)).join('\n')}${safe.length ? '\n' : ''}`, 'utf8');
  console.log(`Saved ${safe.length} anonymized messages to ${target}`);
});

