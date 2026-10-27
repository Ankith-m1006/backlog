export type BotTemplate =
  | { type: 'queue-not-found'; userLogin: string }
  | { type: 'queue-position'; userLogin: string; place: number; others: number }
  | { type: 'answered-askers'; userLogins: string[] };

function mention(login: string): string {
  const safe = login.toLowerCase().replace(/[^a-z0-9_]/gu, '').slice(0, 25);
  return safe ? `@${safe}` : '@viewer';
}

export function renderBotTemplate(template: BotTemplate): string {
  if (template.type === 'queue-not-found') return `I don't see a question from you yet, ${mention(template.userLogin)}.`;
  if (template.type === 'queue-position') {
    const others = Math.max(0, Math.floor(template.others));
    const asked = others === 1 ? '1 other viewer asked it too' : `${others} other viewers asked it too`;
    return `${mention(template.userLogin)}, your question is #${Math.max(1, Math.floor(template.place))} in the queue; ${asked}.`;
  }
  const names = template.userLogins.slice(0, 5).map(mention);
  const others = Math.max(0, template.userLogins.length - names.length);
  const people = `${names.join(', ')}${others > 0 ? ` and ${others} others` : ''}`;
  return `Answered this for ${people}.`;
}
