const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const config = require('./config');
const logger = require('./utils/logger');
const storePath = path.join(__dirname, 'data', 'oauth-users.json');
let users = {}; let loaded = false; const states = new Map();
async function load() { if (loaded) return; try { users = JSON.parse(await fs.readFile(storePath, 'utf8')); } catch { users = {}; } loaded = true; }
async function save() { await fs.writeFile(storePath, `${JSON.stringify(users, null, 2)}\n`, 'utf8'); }
function authUrl(userId) { const state = crypto.randomBytes(24).toString('hex'); states.set(state, { userId, expires: Date.now() + 600000 }); const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId(), scope: 'identify guilds guilds.join', redirect_uri: config.oauthRedirectUri(), state, prompt: 'consent' }); return `https://discord.com/oauth2/authorize?${params}`; }
async function exchange(code) { const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.oauthRedirectUri() }); const basic = Buffer.from(`${config.clientId()}:${config.oauthClientSecret()}`).toString('base64'); const response = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body }); if (!response.ok) throw new Error(`OAuth exchange failed: ${response.status}`); return response.json(); }
async function getToken(userId) { await load(); return users[userId]?.accessToken || null; }
async function userGuildIds(userId) {
  const token = await getToken(userId);
  if (!token) {
    logger.info(`Travel membership lookup user=${userId} result=not-connected`);
    return [];
  }
  const response = await fetch('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    logger.error(`Travel membership lookup failed user=${userId} status=${response.status}`);
    return [];
  }
  const guilds = await response.json();
  logger.info(`Travel membership lookup user=${userId} guildCount=${guilds.length}`);
  return guilds.map((guild) => guild.id);
}
async function joinGuild(userId, guildId) { const token = await getToken(userId); if (!token) return false; const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, { method: 'PUT', headers: { Authorization: `Bot ${config.token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: token }) }); return response.ok || response.status === 204; }
function page(title, message, good = true) { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;background:#101827;color:#eaf7ff;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}.card{max-width:520px;margin:24px;padding:36px;border:1px solid #31506b;border-radius:22px;background:linear-gradient(145deg,#1b3045,#132132);box-shadow:0 18px 60px #0008;text-align:center}.logo{font-size:48px}.pill{display:inline-block;padding:7px 14px;border-radius:999px;background:${good ? '#1d8f68' : '#a94758'};font-weight:700}h1{margin:16px 0 10px}p{color:#b9cede;line-height:1.6}</style></head><body><main class="card"><div class="logo">${config.pengEmoji()}</div><span class="pill">${good ? 'CONNECTED' : 'NEEDS ATTENTION'}</span><h1>${title}</h1><p>${message}</p><p>You can close this window and return to Discord.</p></main></body></html>`; }
function startServer() { if (!config.oauthClientSecret() || !config.oauthRedirectUri()) { logger.info('Discord OAuth is disabled: OAUTH_CLIENT_SECRET or OAUTH_REDIRECT_URI is not configured.'); return; } const target = new URL(config.oauthRedirectUri()); http.createServer(async (request, response) => { try { const url = new URL(request.url, `http://${request.headers.host}`); if (url.pathname !== target.pathname) { response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(page('Page not found', 'That PikaPeng route does not exist.', false)); } const session = states.get(url.searchParams.get('state')); states.delete(url.searchParams.get('state')); if (!session || session.expires < Date.now()) { response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }); return response.end(page('Authorization expired', 'Run /addperms in Discord and try again.', false)); } const token = await exchange(url.searchParams.get('code')); const identityResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } }); const identity = await identityResponse.json(); await load(); users[session.userId] = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, discordUserId: identity.id, updatedAt: new Date().toISOString() }; await save(); response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page('Travel permissions connected!', 'PikaPeng can now check your joined servers and help you travel to approved destinations.')); } catch (error) { logger.error('OAuth callback failed', error); response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page('Connection failed', 'PikaPeng could not finish the authorization. Please run /addperms again.', false)); } }).listen(config.oauthPort(), config.oauthHost(), () => logger.info(`Discord OAuth callback listening on ${config.oauthHost()}:${config.oauthPort()}`)); }
setImmediate(startServer);
module.exports = { authUrl, userGuildIds, joinGuild, startServer };
