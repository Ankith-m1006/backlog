import { afterEach, describe, expect, it } from 'vitest';
import { answerMatchThreshold, env } from '../../src/config/env.js';

const previousBroadcaster = process.env.TWITCH_BROADCASTER_USER_ID;
const previousThreshold = process.env.ANSWER_MATCH_THRESHOLD;
afterEach(() => {
  if (previousBroadcaster === undefined) delete process.env.TWITCH_BROADCASTER_USER_ID;
  else process.env.TWITCH_BROADCASTER_USER_ID = previousBroadcaster;
  if (previousThreshold === undefined) delete process.env.ANSWER_MATCH_THRESHOLD;
  else process.env.ANSWER_MATCH_THRESHOLD = previousThreshold;
});

describe('environment values', () => {
  it('treats an empty broadcaster ID as unset so stored identity is used', () => {
    process.env.TWITCH_BROADCASTER_USER_ID = '   ';
    const streamerIdentity = { userId: 'stored-streamer-id' };
    expect(env('TWITCH_BROADCASTER_USER_ID') ?? streamerIdentity.userId).toBe('stored-streamer-id');
  });

  it('uses the default answer match threshold when its env value is empty', () => {
    process.env.ANSWER_MATCH_THRESHOLD = '';
    expect(answerMatchThreshold()).toBe(0.82);
  });
});
