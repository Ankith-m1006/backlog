import { describe, expect, it } from 'vitest';
import { isCandidate } from '../../src/classifier/prefilter.js';

const cases: Array<[string, boolean]> = [
  ['How do I unlock the next map?', true], ['What weapon are you using?', true],
  ['Why did that boss reset?', true], ['When does ranked open?', true],
  ['Where did the key drop?', true], ['Who is in your squad?', true],
  ['Which perk should I choose?', true], ['Is this build still viable?', true],
  ['Are you playing on hard mode?', true], ['Does armor affect poison?', true],
  ['Do headshots matter here?', true], ['Can you show the map?', true],
  ['Could this run on Switch?', true], ['Will the patch reset saves?', true],
  ['Would you recommend this game?', true], ['Should I spend these tokens?', true],
  ['Any tips for the final boss?', true], ['@streamer what sensitivity do you use', true],
  ['hey @streamer can you check chat', true], ['Is it worth upgrading the rifle?', true],
  ['How did you get that skin?', true], ['What does this button do?', true],
  ['Do you have a build guide?', true], ['Can we get a save point?', true],
  ['That was a clean dodge', false], ['LMAO that ragdoll', false],
  ['ggs everyone', false], ['we take those', false], ['Kappa Kappa PogChamp', false],
  ['KEKW', false], ['????????', false], ['LOLOLOL', false], ['aaaaaaaaaaaa', false],
  ['!song', false], ['!q', false], ['check this out https://example.com', false],
  ['www.free-skins.gg claim now', false], ['example.com has the patch notes', false],
  ['nice shot!', false], ['yes', false], ['hello streamer', false],
  ['thanks for the stream tonight', false], ['pausechamp pausechamp pausechamp', false],
  ['this game is wild', false], ['I just got here', false],
];

describe('isCandidate', () => {
  it.each(cases)('%s => %s', (text, expected) => {
    expect(isCandidate({ text, channel: 'streamer' })).toBe(expected);
  });
});
