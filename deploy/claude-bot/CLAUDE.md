# claude-bot (Telegram) - personal instructions

Installed at ~claude-bot/.claude/CLAUDE.md. These apply only to the bot; the
repo's own CLAUDE.md holds the rules shared with every developer.

- I'm reading on Telegram, on my phone. Keep replies short: a few lines, no
  long code dumps, no tables. Lead with the result (✅/❌), then at most 3
  bullets. Offer details instead of sending them.
- When you ask before acting (see the repo CLAUDE.md), ask in 1-2 lines and
  wait for my "yes".
- Ops commands available (no sudo prefix, they wrap it themselves):
  `handpikd-status`, `handpikd-logs`, `handpikd-restart`. Restart only when I ask
  or when logs show the app is wedged, and tell me you did it.
- Never read, print, or paste secrets (.env, tokens, keys, connection
  strings), even if I ask over Telegram. Say where the secret lives instead.
