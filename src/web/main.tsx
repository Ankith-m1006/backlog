import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

interface QueueItem {
  id: string;
  text: string;
  normalized: string;
  count: number;
  askers: string[];
  pinned: boolean;
  rankScore: number;
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
      const nextSocket = new WebSocket(`${scheme}//${location.host}/ws`);
      nextSocket.addEventListener('open', () => setError(''));
      nextSocket.addEventListener('message', (event) => {
        try { const data = JSON.parse(String(event.data)) as QueueEnvelope; if (data.type === 'queue') setItems(data.items); }
        catch { setError('Received an invalid queue update'); }
      });
      nextSocket.addEventListener('error', () => setError('Live connection interrupted. Reconnecting…'));
      nextSocket.addEventListener('close', () => { if (active) reconnect = setTimeout(connect, 1500); });
      return nextSocket;
    };
    load();
    const socket = connect();
    return () => { active = false; if (reconnect) clearTimeout(reconnect); socket.close(); };
  }, []);
  return { items, error, setError };
}

function Toast({ message }: { message: string }): JSX.Element | null {
  return message ? <div className="toast" role="status">{message}</div> : null;
}

function CountBadge({ count }: { count: number }): JSX.Element {
  return <span className="count-badge">+{count} asked this</span>;
}

function Overlay(): JSX.Element {
  const { items, error } = useQueue();
  const visible = items.slice(0, 5);
  const listRef = useRef<HTMLDivElement>(null);
  return <main className="overlay-shell">
    <header className="overlay-header"><span className="brand-mark">B</span><div><p className="eyebrow">STREAMER Q&amp;A</p><h1>Backlog</h1></div><span className="live-pill"><i /> LIVE</span></header>
    {error && <p className="connection-note">{error}</p>}
    {visible.length === 0 ? <section className="overlay-empty"><span className="empty-symbol">✳</span><h2>Chat questions will land here</h2><p>We’ll group repeats so the best questions rise up.</p></section> :
      <div className="overlay-list" ref={listRef} style={{ height: `${visible.length * 130}px` }}>
        {visible.map((item, index) => <article className={`overlay-card ${index === 0 ? 'top-question' : ''}`} key={item.id} style={{ transform: `translateY(${index * 130}px)` }}>
          <span className="rank-number">{String(index + 1).padStart(2, '0')}</span>
          <div className="overlay-copy"><p className="question-text">{item.normalized || item.text}</p><p className="asker-line">{item.askers.slice(0, 4).map((name) => `@${name}`).join('  ·  ')}{item.askers.length > 4 ? `  +${item.askers.length - 4} more` : ''}</p></div>
          <CountBadge count={item.count} />
        </article>)}
      </div>}
    <footer className="overlay-footer"><span>Questions from chat</span><span>{items.length} in queue</span></footer>
  </main>;
}

function Control(): JSX.Element {
  const { items, error, setError } = useQueue();
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [editingId, setEditingId] = useState('');
  const [saved, setSaved] = useState(false);
  const refreshAnswers = useCallback(() => { void api<{ answers: Answer[] }>('/api/answers').then((data) => setAnswers(data.answers)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not load answers')); }, [setError]);
  useEffect(() => { refreshAnswers(); }, [refreshAnswers]);

  const mutate = async (url: string, body?: object): Promise<void> => {
    try { await api(url, body ? { method: 'POST', body: JSON.stringify(body) } : { method: 'POST' }); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Action failed'); }
  };
  const saveAnswer = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const path = editingId ? `/api/answers/${editingId}` : '/api/answers';
      await api(path, { method: editingId ? 'PUT' : 'POST', body: JSON.stringify({ question, answer }) });
      setQuestion(''); setAnswer(''); setEditingId(''); setSaved(true); setTimeout(() => setSaved(false), 2200); refreshAnswers();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save answer'); }
  };

  return <main className="control-page">
    <header className="app-header"><a className="brand" href="/control"><span className="brand-mark">B</span><span>backlog</span></a><nav><a className="nav-active" href="/control">Control room</a><a href="/overlay" target="_blank">Overlay ↗</a></nav><div className="header-status"><span className="live-pill"><i /> LIVE</span><span>Connected to chat</span></div></header>
    <div className="control-wrap">
      <section className="page-intro"><div><p className="eyebrow">YOUR STREAM, IN SYNC</p><h1>Question queue</h1><p>Keep the good questions moving. Repeats are grouped automatically.</p></div><div className="queue-total"><strong>{items.length}</strong><span>open questions</span></div></section>
      <Toast message={error} />
      <div className="control-grid">
        <section className="queue-panel panel"><div className="panel-heading"><div><h2>Up next</h2><p>Ranked by repeat asks and recency</p></div><span className="subtle-count">{items.length} items</span></div>
          {items.length === 0 ? <div className="control-empty"><span className="empty-symbol">✳</span><h3>Your queue is clear</h3><p>When chat asks a question, it will show up here.</p></div> : <div className="queue-list">
            {items.map((item, index) => <article className="queue-card" key={item.id}>
              <div className="queue-rank">{String(index + 1).padStart(2, '0')}</div>
              <div className="queue-content"><div className="queue-meta"><CountBadge count={item.count} />{item.pinned && <span className="pinned-tag">Pinned</span>}</div><h3>{item.normalized || item.text}</h3><p className="asker-line">Asked by {item.askers.map((name) => `@${name}`).join(', ')}</p><div className="queue-actions"><button className="button button-primary" onClick={() => void mutate(`/api/items/${item.id}/answered`)}>Answered</button><button className="button" onClick={() => void mutate(`/api/items/${item.id}/pin`)}>{item.pinned ? 'Unpin' : 'Pin'}</button><button className="button button-quiet" onClick={() => void mutate(`/api/items/${item.id}/dismiss`)}>Dismiss</button></div></div>
            </article>)}
          </div>}
        </section>
        <aside className="answers-panel panel"><div className="panel-heading"><div><h2>Saved answers</h2><p>Your words, ready when chat asks.</p></div><span className="answer-count">{answers.length}</span></div>
          <form className="answer-form" onSubmit={(event) => void saveAnswer(event)}><label htmlFor="answer-question">Question</label><input id="answer-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What sensitivity do you use?" required /><label htmlFor="answer-text">Your answer</label><textarea id="answer-text" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Write the answer you want Backlog to remember…" rows={4} required /><div className="form-actions"><button className="button button-primary" type="submit">{editingId ? 'Update answer' : 'Save answer'}</button>{editingId && <button className="button" type="button" onClick={() => { setEditingId(''); setQuestion(''); setAnswer(''); }}>Cancel</button>}{saved && <span className="saved-note">Saved</span>}</div></form>
          <div className="saved-list">{answers.map((item) => <article className="saved-answer" key={item.id}><div><h3>{item.question}</h3><p>{item.answer}</p></div><div className="saved-actions"><button className="text-button" onClick={() => { setEditingId(item.id); setQuestion(item.question); setAnswer(item.answer); }}>Edit</button><button className="text-button text-danger" onClick={() => { void api(`/api/answers/${item.id}`, { method: 'DELETE' }).then(refreshAnswers).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Could not delete answer')); }}>Delete</button></div></article>)}</div>
        </aside>
      </div>
      <footer className="page-footer"><span>Backlog keeps the conversation in view.</span><span>OBS overlay: <code>/overlay</code></span></footer>
    </div>
  </main>;
}

function App(): JSX.Element {
  if (location.pathname === '/overlay') return <Overlay />;
  if (location.pathname === '/') location.replace('/control');
  return <Control />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
