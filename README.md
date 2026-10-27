# Backlog

Backlog turns Twitch chat questions into a ranked queue for streamers.
It groups repeats and suggests only answers the streamer has saved.

![Backlog control room](docs/screenshots/backlog-control.png)

![OBS overlay](docs/screenshots/backlog-overlay.png)

## Setup

Requirements: Node.js 22 or newer and pnpm.

1. Create a Twitch application in the Twitch Developer Console and copy its client ID and client secret. Backlog uses Twitch's Device Code Grant Flow, so no callback URL or callback server is needed.
2. Copy `.env.example` to `.env` and set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. The secret can be omitted if the app is registered as a public client. Keep `.env` private.
3. Authorize the broadcaster and bot separately. Sign into the broadcaster account when prompted by the first command, then the bot account for the second:

   ```sh
   pnpm auth streamer
   pnpm auth bot
   ```

   The streamer grant requests `user:read:chat`; the bot grant requests `user:read:chat` and `user:write:chat`. Enter the displayed code at Twitch's verification URL. Backlog validates and prints the Twitch login, then stores tokens and rotating refresh tokens in `.tokens/`, which Git ignores. The server refreshes tokens shortly before expiry and persists each rotated refresh token.

4. Set `CHANNEL` and `OPENAI_API_KEY` in `.env` for live mode. `TWITCH_BROADCASTER_USER_ID`, `BOT_USER_ID`, and `BOT_USERNAME` can be omitted when the matching device-code token files exist; Backlog reads these identities from Twitch. Keep `TWITCH_ACCESS_TOKEN` blank unless using it as a legacy fallback.
5. Install and build:

   ```sh
   pnpm install
   pnpm build:web
   ```

Token files are local credentials. Do not copy or commit `.tokens/`.

## Run

Demo mode is the default and uses deterministic local demo embeddings. It is for UI previews and cannot be used for evaluation.

```sh
pnpm replay data/sample-chat.synthetic.jsonl
```

Open [http://127.0.0.1:3001/control](http://127.0.0.1:3001/control). Open `/overlay` as an OBS browser source. The fixture is synthetic and is only for the replay demo.

For live chat, set `BACKLOG_MODE=live`, configure Twitch and OpenAI values in `.env`, set `CHANNEL`, `TWITCH_BROADCASTER_USER_ID`, `BOT_USER_ID`, and `BOT_USERNAME`, then run:

```sh
pnpm build:web
pnpm server
```

The cost guard defaults to 30 OpenAI calls per minute; change `OPENAI_MAX_CALLS_PER_MINUTE` if needed. The logs report token use. Bot chat messages share a queue capped at one message per 10 seconds.

## Record, label, evaluate

Capture public chat without a Twitch token. Every sender and explicit `@mention` is replaced with a stable `user_N` pseudonym before the JSONL file is written:

```sh
pnpm record-chat channel_name 10
pnpm label
```

`pnpm label` samples 150 messages, includes all prefilter candidates where possible, and asks for a yes/no label and a short topic key. After collecting and labelling real public chat, run evaluation only in live mode:

```sh
$env:BACKLOG_MODE='live' # PowerShell; use BACKLOG_MODE=live in POSIX shells
pnpm eval
```

The report is written to `docs/EVAL.md`. It compares the rules-only prefilter, a classifier without cross-batch context, and full Backlog. The repository does not contain real chat or human labels; do not treat the synthetic replay as evaluation data. `pnpm eval` refuses demo mode.

## Architecture

```mermaid
flowchart LR
  IRC[Twitch IRC recorder] --> Anon[User pseudonyms]
  Anon --> Labels[Human labels]
  Labels --> Eval[Live-only evaluation]
  EventSub[Twitch EventSub] --> Filter[Question prefilter]
  Replay[Synthetic replay] --> Filter
  Filter --> Batch[2 second classifier batches]
  Batch --> Merge[Topic keys and embedding merge]
  Merge --> SQLite[(SQLite queue and answers)]
  SQLite --> API[Fastify REST and WebSocket]
  API --> Control[Streamer control page]
  API --> Overlay[OBS overlay]
  Control --> SafeBot[Saved-answer-only bot]
  SafeBot --> Helix[Twitch Helix chat]
```

## Limits and safety

- Backlog does not generate answers. It suggests a saved answer only above the configured embedding threshold, and the bot sends only a saved answer selected by ID.
- Demo embeddings are local word-hash vectors. They are not semantic embeddings and demo mode is blocked from evaluation.
- Real evaluation depends on the channel mix and the quality of human labels. Duplicate pair accuracy is calculated over labelled question pairs.
- Twitch's Device Code Grant Flow is used by the local CLI; it does not require a callback server. Revoked or expired refresh tokens require running `pnpm auth <streamer|bot>` again.
- The recorder stores message text and pseudonymous user labels, not Twitch usernames or IDs. Avoid recording private information in public chat; captured files are local data and are not uploaded by the recorder.
- Twitch and OpenAI availability, API limits, and model pricing can change.

## Development

```sh
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm build:web
```

MIT licensed; see [LICENSE](LICENSE).
