import { describe, expect, it } from 'vitest';
import { renderBotTemplate } from '../../src/bot/messages.js';

describe('bot message templates', () => {
  it('mentions at most five askers and reports the remainder', () => {
    const message = renderBotTemplate({ type: 'answered-askers', userLogins: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'] });
    expect(message).toBe('Answered this for @a1, @a2, @a3, @a4, @a5 and 2 others.');
    expect((message.match(/@/gu) ?? [])).toHaveLength(5);
  });
});
