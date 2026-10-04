const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const cloud = require('../pikacloud'); const config = require('../config'); const fs = require('node:fs'); const { pipeline } = require('node:stream/promises');
const ts = d => d ? `<t:${Math.floor(d / 1000)}:f>` : '—';
const data = new SlashCommandBuilder().setName('storage').setDescription('Manage your PikaCloud storage')
  .addSubcommand(s => s.setName('plans').setDescription('View PikaCloud plans'))
  .addSubcommand(s => s.setName('buy').setDescription('Buy a PikaCloud plan').addStringOption(o => o.setName('plan').setDescription('Plan').setRequired(true).addChoices(...Object.entries(cloud.PLANS).map(([value, p]) => ({ name: p.name, value })))) )
  .addSubcommand(s => s.setName('info').setDescription('View your PikaCloud account'))
  .addSubcommand(s => s.setName('upload').setDescription('Upload a file').addAttachmentOption(o => o.setName('file').setDescription('File to store').setRequired(true)))
  .addSubcommand(s => s.setName('files').setDescription('List your stored files'))
  .addSubcommand(s => s.setName('download').setDescription('Download a stored file').addStringOption(o => o.setName('file').setDescription('Exact filename').setRequired(true)))
  .addSubcommand(s => s.setName('delete').setDescription('Delete a stored file').addStringOption(o => o.setName('file').setDescription('Exact filename').setRequired(true)))
  .addSubcommand(s => s.setName('renew').setDescription('Renew your subscription'))
  .addSubcommand(s => s.setName('cancel').setDescription('Disable automatic renewal'))
  .addSubcommand(s => s.setName('admin-status').setDescription('View PikaCloud capacity'));
async function execute(i) { const sub = i.options.getSubcommand(); const id = i.user.id;
  if (sub === 'plans') return i.reply({ content: Object.entries(cloud.PLANS).map(([k,p]) => `**${p.name}** (\`${k}\`) — ${cloud.fmt(p.bytes)}, ${p.price.toLocaleString()} fish / 30 days; ${cloud.fmt(p.transfer)} transfer/month`).join('\n') });
  if (sub === 'buy') { try { await cloud.buy(id, i.options.getString('plan')); return i.reply('☁️ PikaCloud plan activated for 30 days.'); } catch (e) { return i.reply({ content: `☁️ ${e.message}`, ephemeral: true }); } }
  if (sub === 'info') { const x = await cloud.getInfo(id); if (!x.subscription) return i.reply('☁️ You do not have a PikaCloud plan.'); const s=x.subscription; return i.reply({ embeds:[new EmbedBuilder().setTitle('☁️ PikaCloud').setDescription(`**${x.plan.name}**\nUsed: ${cloud.fmt(x.used)} / ${cloud.fmt(x.plan.bytes)} (${((x.used/x.plan.bytes)*100).toFixed(1)}%)\nFish: ${x.balance.toLocaleString()}\nRenewal: ${x.plan.price.toLocaleString()} fish\nNext renewal: ${ts(s.expiresAt)}\nStatus: ${s.status}\nTransfer this period: ${cloud.fmt(s.transferUsed)} / ${cloud.fmt(x.plan.transfer)}${s.graceUntil ? `\nGrace/deletion date: ${ts(s.graceUntil)}` : ''}`).setColor(0x72d6e8)] }); }
  if (sub === 'upload') { await i.deferReply(); const a=i.options.getAttachment('file'); let ctx; try { ctx=await cloud.beginUpload(id,a); const res=await cloud.downloadStream(a.url); await pipeline(res, fs.createWriteStream(ctx.target, { flags:'wx' })); const rec=await cloud.finishUpload(id,ctx); const x=await cloud.getInfo(id); return i.editReply(`☁️ Stored **${rec.name}** (${cloud.fmt(rec.size)}). Usage: ${cloud.fmt(x.used)} / ${cloud.fmt(x.plan.bytes)}.`); } catch(e) { if(ctx) await cloud.failUpload(ctx.target); return i.editReply(`☁️ Upload failed: ${e.message}`); } }
  if (sub === 'files') { const files=await cloud.list(id); return i.reply(files.length ? files.slice(0,25).map(f=>`**${f.name}** — ${cloud.fmt(f.size)} — ${ts(f.uploadedAt)}`).join('\n') + (files.length>25?'\n…and more.':'') : '☁️ You have no stored files.'); }
  if (sub === 'download') { await i.deferReply(); try { const {rec,full}=await cloud.filePath(id,i.options.getString('file')); await cloud.consumeTransfer(id,rec.size); return i.editReply({ content:`☁️ ${rec.name}`, files:[new AttachmentBuilder(full,{name:rec.name})] }); } catch(e) { return i.editReply(`☁️ Download failed: ${e.message}`); } }
  if (sub === 'delete') { try { const r=await cloud.deleteFile(id,i.options.getString('file')); return i.reply(`☁️ Deleted **${r.name}**.`); } catch(e) { return i.reply({content:`☁️ ${e.message}`,ephemeral:true}); } }
  if (sub === 'renew') { try { await cloud.renew(id); return i.reply('☁️ Subscription renewed for 30 days.'); } catch(e) { return i.reply({content:`☁️ ${e.message}`,ephemeral:true}); } }
  if (sub === 'cancel') { try { await cloud.cancel(id); return i.reply('☁️ Automatic renewal disabled; storage remains active until expiry.'); } catch(e) { return i.reply({content:`☁️ ${e.message}`,ephemeral:true}); } }
  if (sub === 'admin-status') { if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return i.reply({content:'Administrator access required.',ephemeral:true}); const s=await cloud.adminStatus(); return i.reply(`☁️ **PikaCloud Status**\nAllocated: ${cloud.fmt(s.allocated)} / 100 GB\nActual Used: ${cloud.fmt(s.actual)}\nActive subscriptions: ${s.active}\nGrace period: ${s.grace}\nAvailable allocation: ${cloud.fmt(cloud.MAX_ALLOCATED-s.allocated)}`); }
}
module.exports = { data, restrictedSubcommands: { 'admin-status': 'Administrator' }, execute };
