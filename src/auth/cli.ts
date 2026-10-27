import { loadEnvFile } from '../config/env.js';
import { authorizeDevice, type AuthRole } from './tokens.js';

await loadEnvFile();
const role = process.argv[2] as AuthRole | undefined;
if (role !== 'streamer' && role !== 'bot') throw new Error('Usage: pnpm auth <streamer|bot>');
const clientId = process.env.TWITCH_CLIENT_ID;
if (!clientId) throw new Error('Set TWITCH_CLIENT_ID in .env before running pnpm auth');
const token = await authorizeDevice(role, {
  clientId,
  ...(process.env.TWITCH_CLIENT_SECRET ? { clientSecret: process.env.TWITCH_CLIENT_SECRET } : {}),
  onDeviceCode: ({ userCode, verificationUri }) => {
    console.log(`Authorize the ${role} account at: ${verificationUri}`);
    console.log(`Enter code: ${userCode}`);
    console.log('Waiting for Twitch authorization...');
  },
});
console.log(`Logged in as ${token.login} (${role}; user ID ${token.userId}).`);
console.log(`Token saved to .tokens/${role}.json`);
