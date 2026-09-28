const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g;
const OPENAI = /\b(sk-(?:proj-|org-)?[A-Za-z0-9_-]{16,})\b/g;
const GITHUB = /\b((?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,})\b/g;
const AWS = /\b((?:AKIA|ASIA)[A-Z0-9]{16})\b/g;
const DISCORD = /\b([MN][A-Za-z\d]{23,27}\.[\w-]{6}\.[\w-]{25,40})\b/g;
const ASSIGNMENT = /\b(TOKEN|BOT_TOKEN|API_KEY|APIKEY|SECRET|CLIENT_SECRET|PASSWORD|PASSWD|ACCESS_TOKEN|AUTH_TOKEN)\s*=\s*([^\s`'";,]{8,})/gi;
const SAFE_ASSIGNMENT_VALUE = /^(?:https?:\/\/|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$|[0-9a-f]{40})$/i;

function detectAndRedactSecrets(text) {
  let redacted = String(text ?? ''); const detections = [];
  const replace = (regex, type, format) => { redacted = redacted.replace(regex, (...args) => { const match = args[0]; const replacement = format(match, args); detections.push({ type }); return replacement; }); };
  replace(PRIVATE_KEY, 'private_key_pem', () => '-----BEGIN PRIVATE KEY-----\n[REDACTED BY PIKAPENG]\n-----END PRIVATE KEY-----');
  replace(OPENAI, 'openai_api_key', (match) => `${match.match(/^sk-(?:proj-|org-)?/)?.[0] || 'sk-'}${'•'.repeat(Math.max(12, match.length - (match.match(/^sk-(?:proj-|org-)?/)?.[0].length || 3)))}`);
  replace(GITHUB, 'github_token', (match) => `${match.split('_')[0] === 'github' ? 'github_pat_' : match.slice(0, match.indexOf('_') + 1)}${'•'.repeat(Math.max(12, match.length - match.indexOf('_') - 1))}`);
  replace(AWS, 'aws_access_key_id', (match) => `${match.slice(0, 4)}${'•'.repeat(match.length - 4)}`);
  replace(DISCORD, 'discord_token', (match) => `${match.slice(0, 6)}${'•'.repeat(Math.max(12, match.length - 6))}`);
  redacted = redacted.replace(ASSIGNMENT, (full, key, value) => { if (SAFE_ASSIGNMENT_VALUE.test(value)) return full; detections.push({ type: `${key.toLowerCase()}_assignment` }); return `${key}=••••••••••••••••`; });
  return { detected: detections.length > 0, redactedText: redacted, detections };
}

module.exports = { detectAndRedactSecrets };
