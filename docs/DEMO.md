# Three-minute demo recording

Use a test channel and a bot account you control. The 400-message fixture is synthetic replay data. To show a real bot message in chat, configure valid Twitch credentials and run the replay in live mode; live mode calls OpenAI and can send chat messages.

## Before recording

Build the UI and start the app with a fast synthetic replay. This starts the same queue pipeline used by live EventSub messages:

```powershell
pnpm install
pnpm build:web
$env:BACKLOG_MODE='live'
$env:BACKLOG_REPLAY_FILE='data/sample-chat.synthetic.jsonl'
$env:REPLAY_SPEED='12'
pnpm server
```

Use `BACKLOG_MODE=live` and Twitch bot credentials in `.env`; add a saved answer in Control before the relevant question appears. Keep the channel under your control because the demo posts saved text to its chat.

## Recording (3:00)

| Time | Show and say |
|---|---|
| 0:00–0:25 | Show the control page and overlay. Explain that repeated chat questions get buried during a stream. |
| 0:25–1:00 | Start or restart the replay with the command above. Show the queue filling from chat at `/control` and `/overlay`. |
| 1:00–1:30 | Point out duplicate wording collapsing into one row and the `+N asked this` count rising as repeats arrive. |
| 1:30–2:00 | Select the suggested saved answer and press **Answered · send saved answer**. Show the saved text posted in the controlled Twitch channel. The askers receive one follow-up mention message. |
| 2:00–2:25 | In Twitch chat, type `!q` as a viewer and show the bot's queue position. Type `!qclear` as a moderator/broadcaster only if demonstrating queue reset. |
| 2:25–3:00 | Open `docs/EVAL.md` and explain the three-system precision/recall/F1 and duplicate-pair comparison. Use this segment after real chat has been recorded and labelled; do not present synthetic replay as evaluation. |

For recording the real data used by the eval segment, run these separately ahead of time:

```powershell
pnpm record-chat channel_name 10
pnpm label
$env:BACKLOG_MODE='live'
pnpm eval
```

`pnpm record-chat` is intentionally not part of the demo startup command. Usernames are pseudonymized before the recorder writes its JSONL file.
