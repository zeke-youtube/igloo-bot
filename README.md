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
