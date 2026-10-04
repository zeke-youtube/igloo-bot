# PengBot — PikaPeng

PengBot is the official-feeling PikaPeng companion for the PikaStudio Discord server, built with Node.js and discord.js v14.

## Setup

1. Install Node.js 18.17+.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in the bot token, application ID, server ID, announcements channel ID, and optional role IDs.
4. Invite the bot with the `bot` and `applications.commands` scopes. It needs View Channel, Send Messages, Embed Links, and Manage Roles (with its highest role above self-assignable roles).
5. Run `npm run deploy` to register guild slash commands.
6. Run `npm start`.

FriendUber uses the Discord `GuildPresences` gateway intent to show only listed members whose status is online. Enable **Presence Intent** under the bot's **Privileged Gateway Intents** in the Discord Developer Portal if Discord requires it for this application.

Use `/pikascreaminglang encode text:<text>` or `/pikascreaminglang decode text:<text>` for the existing PikaScreamingLang format. Its encoder normalizes whitespace and maps letters to uppercase, so decoding cannot recover original letter case or repeated/newline whitespace.

Set `STAFF_LIST_CHANNEL_ID` in `.env` to the channel where IglooBot should maintain the live PikaStudio staff list. It uses the fixed verified staff role `1551168459159896166`; the maintained message ID is saved in `src/data/staff-list.json` (persisted by the existing Docker data volume).

To remove every slash command registered by this PengBot application, run `npm run clear-commands`. This does not remove commands belonging to another bot/application.

## Docker / QNAP deployment

Keep `.env` on the NAS beside `compose.yaml`; it is loaded into the container at runtime and is not copied into the image.

Build and start IglooBot with:

```bash
docker compose up -d --build
```

View logs with:

```bash
docker compose logs -f igloobot
```

The Compose volume `igloobot_data` persists Fish balances and KTV tracking data stored under `src/data`. Stop the bot with `docker compose down`; the named data volume is retained.

## Commands

- `/pengfact` sends one of the facts in `src/data/pengfacts.json`.
- `/pikastudiosites` renders entries from `src/data/sites.json`.
- `/announcements` is limited to Administrators or `STAFF_ROLE_ID`; previews are private and require Publish.
- `/coinflip` flips a PikaPeng coin.
- `/help` lists available PengBot commands.
- `/clear amount:<1-100>` lets members with Manage Messages remove recent messages.
- `/global-cooldown seconds:<0-21600>` applies slowmode across all text channels for authorized staff.
- `/createroom` creates one temporary voice KTV per user inside the configured PikaPeng KTV category.
- `/frienduber find`, `stock`, `unstock`, `status`, `block`, and `unblock` provide the server-only FriendUber service. FriendUber must first be purchased from `/shop`; sessions use Fish only and give neither user authority over the other.

Announcement mentions are escaped by default. Set `ALLOW_ANNOUNCEMENT_MENTIONS=true` only when intentional. Never place bot tokens in source control.

## Member commands

- `/shutdownbot` and `/openbot` are restricted to `BOT_OWNER_ID` in `.env`. Shutdown mode persists in the existing member feature JSON store, keeps Discord connected, sets the bot invisible, and blocks normal commands and interactions. The owner can reopen it without restarting.
- `/pengongus start` opens one server lobby for 4–10 players. The host starts it in a private channel. Waddlers complete two private tasks, Pengostors can use the 40°C heater once per round, and active players privately vote after an Emergency Waddle. Matches are limited to eight rounds; inactive lobbies expire after 15 minutes, and result channels close after 90 seconds. Games persist in the existing member feature JSON file and stale matches are ended safely on restart.

- `/timezone zone:Asia/Taipei` saves an IANA timezone; `/time member:@name` shows the member's current local date and time. Timezones are stored in `src/data/member-features.json`.
- `/wikipengia query:Linux language:en` searches Wikimedia's MediaWiki API. Supported language codes are `en`, `zh`, `zh-tw`, `fr`, `de`, `es`, `ja`, `ko`, `ru`, `pt`, `it`, and `nl`.
- `/pepy package:requests` reads package metadata from PyPI. It does not install packages.
- `/httpcat code:404` displays the CatHTTPWeb image and HTTP meaning.
- `/pengwater` starts or displays the channel's game; `/pengwater guess:a` submits one letter. Correct guesses reveal letters; seven wrong guesses lose. One active game is kept per channel; the built-in word list is curated, family-friendly, and currently uncategorized. Game state and basic outcomes persist in `member-features.json`.
- `/chess challenge member:@name`, then `/chess move move:e4`, `/chess board`, `/chess games`, `/chess resign`, and `/chess stats`. Chess uses `chess.js`; accepted games persist their FEN and move history. Challenges expire after 24 hours; games support legal moves, checkmate, draw detection, resignation, and draw offers.
- `/rentmonitor create url:https://example.com days:7`, `/rentmonitor list`, `/rentmonitor status id:...`, `/rentmonitor cancel id:...`. Rentals cost 50 Fish per day by default (`MONITOR_RENTAL_PRICE_PER_DAY`), allow 1, 7, or 30 days, and permit 3 concurrent rentals per member (`MONITOR_MAX_ACTIVE_PER_USER`). Monitors are checked about every five minutes by a single loop with at most three checks in flight. HTTP responses below 500 count as UP; network errors and 5xx responses count as DOWN. Only state changes trigger a DM. Rentals and status persist in `member-features.json`.

Monitor requests accept public HTTP(S) only. The bot rejects local/private/reserved IP destinations, resolves and checks all DNS answers before each request and redirect, pins the first checked address for that request, follows at most three validated redirects, uses HEAD with a seven second timeout, and sends no response body to the bot. This is intended for public website uptime and blocks private network/NAS targets. Monitoring state, chess, timezone, and PengWater data share a small atomic JSON store. Wikimedia, PyPI, and CatHTTPWeb are accessed over HTTPS; API results are not cached.
