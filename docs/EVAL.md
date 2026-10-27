# Real chat evaluation

Not run yet. The repository does not include real Twitch chat captures or human labels, and synthetic replay data is excluded from evaluation.

After recording and labelling at least 150 real public chat messages, set `BACKLOG_MODE=live` and run `pnpm eval`. The command writes the measured precision, recall, F1, duplicate-pair accuracy, batch latency, token cost, and worst misses here.
