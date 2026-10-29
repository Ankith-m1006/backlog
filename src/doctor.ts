import { existsSync } from 'node:fs';
import { loadEnvFile } from './config/env.js';
import { formatDoctorReport, inspectTokenHealth } from './config/doctor.js';

await loadEnvFile();
const [streamerToken, botToken] = await Promise.all([
  inspectTokenHealth('streamer'), inspectTokenHealth('bot'),
]);
const report = formatDoctorReport({
  nodeVersion: process.version, envFileExists: existsSync('.env'), env: process.env,
  streamerToken, botToken,
});
console.log('Backlog doctor');
report.lines.forEach((line) => console.log(line));
if (!report.ready) process.exitCode = 1;
