import { StrictMode, useCallback, useEffect, useState, type FormEvent, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { asksLabel, tallyMarks } from './presentation.js';
import './styles.css';

interface Wording { text: string; userLogin: string; sentAt?: string }
interface QueueItem {
  id: string; text: string; normalized: string; count: number; askers: string[]; pinned: boolean; rankScore: number;
  suggestedAnswer: { id: string; question: string; answer: string; score: number } | null; wordings?: Wording[];
}
interface Answer { id: string; question: string; answer: string; topicKey: string | null }
interface QueueEnvelope { type: string; items: QueueItem[] }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

function useQueue(): { items: QueueItem[]; error: string; setError: (error: string) => void } {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    const load = (): void => { void api<{ items: QueueItem[] }>('/api/queue').then((result) => { if (active) setItems(result.items); }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load queue'); }); };
    const connect = (): WebSocket => {
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${location.host}/ws`);
      socket.addEventListener('open', () => setError(''));
      socket.addEventListener('message', (event) => {
        try { const data = JSON.parse(String(event.data)) as QueueEnvelope; if (data.type === 'queue') setItems(data.items); }
        catch { setError('Received an invalid queue update'); }
      });
      socket.addEventListener('error', () => setError('Live connection interrupted. Reconnecting…'));
      socket.addEventListener('close', () => { if (active) reconnect = setTimeout(connect, 1500); });
      return socket;
    };
    load(); const socket = connect();
    return () => { active = false; if (reconnect) clearTimeout(reconnect); socket.close(); };
  }, []);
  return { items, error, setError };
}

function CountBadge({ count }: { count: number }): JSX.Element {
  return <span className="count-badge"><span className="tally" aria-hidden="true">{tallyMarks(count)}</span><span>{asksLabel(count)}</span></span>;
}

function Toast({ message }: { message: string }): JSX.Element | null {
  return message ? <div className="toast" role="status">{message}</div> : null;
}

function StatusLine({ mode }: { mode: 'demo' | 'live' }): JSX.Element {
  return <span className="header-status"><i />{mode === 'demo' ? 'DEMO · replay' : 'LIVE · reading chat'}</span>;
}

function Overlay(): JSX.Element {
  const { items, error } = useQueue();
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  useEffect(() => { void api<{ mode: 'demo' | 'live' }>('/api/status').then((status) => setMode(status.mode)).catch(() => undefined); }, []);
  return <main className="overlay-shell">
    <header className="overlay-header"><span className="overlay-brand">backlog</span><span className="overlay-channel">#ankithbuilds</span><StatusLine mode={mode} /></header>
    {error && <p className="connection-note">{error}</p>}
    {items.length === 0 ? <p className="overlay-empty">rail is clear. questions from chat land here.</p> : <div className="overlay-list">
      {items.slice(0, 3).map((item, index) => <article className={`overlay-card ${index === 0 ? 'top-question' : ''}`} key={item.id}>
        <div className="overlay-copy"><p className="question-text">{item.normalized || item.text}</p><p className="asker-line">{item.askers.slice(0, 4).map((name) => `@${name}`).join(' · ')}{item.askers.length > 4 ? ` +${item.askers.length - 4} more` : ''}</p></div>
        <CountBadge count={item.count} />
      </article>)}
    </div>}
  </main>;
}

function Control(): JSX.Element {
  const { items, error, setError } = useQueue();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [question, setQuestion] = useState(''); const [answer, setAnswer] = useState(''); const [editingId, setEditingId] = useState('');
  const [saved, setSaved] = useState(false); const [mode, setMode] = useState<'demo' | 'live'>('demo'); const [formOpen, setFormOpen] = useState(false);
  const refreshAnswers = useCallback(() => { void api<{ answers: Answer[] }>('/api/answers').then((data) => setAnswers(data.answers)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load answers')); }, [setError]);
  useEffect(() => { refreshAnswers(); void api<{ mode: 'demo' | 'live' }>('/api/status').then((status) => setMode(status.mode)).catch(() => undefined); }, [refreshAnswers]);

  const mutate = async (url: string, body?: object): Promise<void> => {
    try { await api(url, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) }); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed'); }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); setSelectedIndex((index) => Math.min(Math.max(0, items.length - 1), index + 1)); }
      else if (event.key.toLowerCase() === 'k') { event.preventDefault(); setSelectedIndex((index) => Math.max(0, index - 1)); }
      else {
        const item = items[selectedIndex]; if (!item) return;
        if (event.key.toLowerCase() === 'a') void mutate(`/api/items/${item.id}/answered`);
        else if (event.key.toLowerCase() === 'd') void mutate(`/api/items/${item.id}/dismiss`);
        else if (event.key.toLowerCase() === 'p') void mutate(`/api/items/${item.id}/pin`);
        else if (event.key.toLowerCase() === 's' && item.suggestedAnswer) void mutate(`/api/items/${item.id}/answered`, { answerId: item.suggestedAnswer.id });
      }
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [items, selectedIndex]);

  const saveAnswer = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const path = editingId ? `/api/answers/${editingId}` : '/api/answers';
      await api(path, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify({ question, answer }) });
      setQuestion(''); setAnswer(''); setEditingId(''); setSaved(true); setTimeout(() => setSaved(false), 2200); refreshAnswers();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save answer'); }
  };

  const totalAsks = items.reduce((total, item) => total + item.count, 0);
  return <main className="control-page">
    <header className="app-header"><a className="brand" href="/control">backlog</a><span className="channel-name">#ankithbuilds</span><StatusLine mode={mode} /><span className="filter-counter"><b>FILTER ON</b> · questions {items.length} · asks {totalAsks}</span></header>
    <div className="control-wrap"><Toast message={error} />
      <div className="control-grid">
        <section className="queue-panel"><div className="panel-heading"><div><h1>Questions from chat</h1><p>Filtered from live chat · ranked by asks and recency</p></div><span className="subtle-count">{items.length} open</span></div>
          {items.length === 0 ? <p className="control-empty">rail is clear. questions from chat land here.</p> : <div className="queue-list">
            {items.map((item, index) => <article className={`queue-card ${index === selectedIndex ? 'keyboard-selected' : ''}`} key={item.id} onMouseEnter={() => setSelectedIndex(index)}>
              <div className="ticket-index">{String(index + 1).padStart(2, '0')}</div><div className="queue-content">
                <div className="queue-meta"><CountBadge count={item.count} />{item.pinned && <span className="pinned-tag">PINNED</span>}</div>
                <h2>{item.normalized || item.text}</h2><p className="asker-line">{item.askers.map((name) => `@${name}`).join(' · ')}</p>
                <details className="wordings"><summary>{item.wordings ? `${item.wordings.length} ${item.wordings.length === 1 ? 'wording' : 'wordings'}` : `${asksLabel(item.count)} · first message only`}</summary>
                  <div className="wording-list">{(item.wordings ?? [{ text: item.text, userLogin: item.askers[0] ?? 'viewer' }]).map((wording, wordingIndex) => <p key={`${wording.userLogin}-${wordingIndex}`}><b>@{wording.userLogin}</b> “{wording.text}”</p>)}</div>
                </details>
                {item.suggestedAnswer && <div className="suggested-answer"><div className="answer-match-label"><span>SAVED ANSWER MATCH</span><strong>{Math.round(item.suggestedAnswer.score * 100)}% match</strong></div><p>{item.suggestedAnswer.answer}</p><button className="send-button" onClick={() => void mutate(`/api/items/${item.id}/answered`, { answerId: item.suggestedAnswer!.id })}>Send in chat <kbd>S</kbd></button></div>}
                <div className="queue-actions"><button className="text-button" onClick={() => void mutate(`/api/items/${item.id}/answered`)}>Mark answered</button><button className="text-button" onClick={() => void mutate(`/api/items/${item.id}/pin`)}>{item.pinned ? 'Unpin' : 'Pin'}</button><button className="text-button text-danger" onClick={() => void mutate(`/api/items/${item.id}/dismiss`)}>Dismiss</button></div>
              </div>
            </article>)}
          </div>}
        </section>
        <aside className="answers-panel"><div className="answers-heading"><h2>Saved answers <span>{answers.length}</span></h2><button className="new-answer" onClick={() => { setEditingId(''); setQuestion(''); setAnswer(''); setFormOpen((open) => !open); }}>+ New answer</button></div>
          {formOpen && <form className="answer-form" onSubmit={(event) => void saveAnswer(event)}><label htmlFor="answer-question">Question</label><input id="answer-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What sensitivity do you use?" required /><label htmlFor="answer-text">Your answer</label><textarea id="answer-text" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write your saved answer…" rows={3} required /><div className="form-actions"><button className="send-button" type="submit">{editingId ? 'Update answer' : 'Save answer'}</button>{editingId && <button className="text-button" type="button" onClick={() => { setEditingId(''); setQuestion(''); setAnswer(''); }}>Cancel</button>}{saved && <span className="saved-note">Saved</span>}</div></form>}
          <div className="saved-list">{answers.length === 0 ? <p className="answers-empty">No saved answers yet.</p> : answers.map((item) => <article className="saved-answer" key={item.id}><div><h3>{item.question}</h3><p>{item.answer}</p></div><div className="saved-actions"><button className="text-button" onClick={() => { setEditingId(item.id); setQuestion(item.question); setAnswer(item.answer); setFormOpen(true); }}>Edit</button><button className="text-button text-danger" onClick={() => { void api(`/api/answers/${item.id}`, { method: 'DELETE' }).then(refreshAnswers).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not delete answer')); }}>Delete</button></div></article>)}</div>
        </aside>
      </div>
      <footer className="page-footer"><span>J/K move · A answered · D dismiss · P pin · S send saved answer</span><span>OBS /overlay</span></footer>
    </div>
  </main>;
}

function App(): JSX.Element {
  if (location.pathname === '/overlay') return <Overlay />;
  if (location.pathname === '/') location.replace('/control');
  return <Control />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
