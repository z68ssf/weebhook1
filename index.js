const {
  Client, GatewayIntentBits, Events, AuditLogEvent,
  PermissionsBitField, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
} = require('discord.js');
const http = require('http');
const fs   = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.MessageContent,
  ],
});

const PORT = process.env.PORT || 3001;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot is running ✅'); }).listen(PORT, () => {
  console.log(`🌐 Keep-alive server running on port ${PORT}`);
});

const BOT_OWNER_IDS  = ['1224722940701048927','1142877121681829978'];
const BOT_TOKEN      = process.env.BOT_TOKEN;
const CLIENT_ID      = '1370090798586269806';
const LOG_CHANNEL_ID = '1520404061743218773';

const PROXY_BOTS = ['282859044593598464'];

const PROTECTION = { serverSettings: true, antiRaid: false, antiBots: true, botRoleProtect: true };
const LIMITS     = { bans: 10, channelDeletes: 2, roleDeletes: 2, massbanWindow: 5000, massbanCount: 3, channelCreateWindow: 10000, channelCreateCount: 3, mentionWindow: 10000, mentionCount: 3 };

const LOG_EMOJIS = [
];
function getRandLogEmoji() { return LOG_EMOJIS[Math.floor(Math.random() * LOG_EMOJIS.length)]; }

// ======= Whitelist =======
const WL_FILE       = './whitelist.json';
const ROLELOCK_FILE = './rolelock.json';

function loadWhitelist() {
  try {
    const data = JSON.parse(fs.readFileSync(WL_FILE, 'utf8'));
    if (Array.isArray(data)) return { users: data, roles: [], channelDel: [], bots: [], webhookCreate: [], ban: [], addBots: [] };
    return { users: [], roles: [], channelDel: [], bots: [], webhookCreate: [], ban: [], addBots: [], ...data };
  } catch { return { users: [], roles: [], channelDel: [], bots: [], webhookCreate: [], ban: [], addBots: [] }; }
}
function saveWhitelist() { fs.writeFileSync(WL_FILE, JSON.stringify(whitelist, null, 2)); }
let whitelist = loadWhitelist();

function loadRolelock() {
  try { return JSON.parse(fs.readFileSync(ROLELOCK_FILE, 'utf8')); } catch { return []; }
}
function saveRolelock() { fs.writeFileSync(ROLELOCK_FILE, JSON.stringify(lockedRoles, null, 2)); }
let lockedRoles = loadRolelock();

function isWhitelisted(userId, memberRoles = []) {
  if (BOT_OWNER_IDS.includes(userId)) return true;
  if (whitelist.users.includes(userId)) return true;
  if (memberRoles.some(r => whitelist.roles.includes(r))) return true;
  return false;
}
function hasSpecificWL(userId, memberRoles = [], type) {
  if (isWhitelisted(userId, memberRoles)) return true;
  const list = whitelist[type] || [];
  if (list.includes(userId)) return true;
  if (memberRoles.some(r => list.includes(r))) return true;
  return false;
}
async function getMemberRoles(guild, userId) {
  try { const m = await guild.members.fetch(userId); return m.roles.cache.map(r => r.id); } catch { return []; }
}

// ======= Stats =======
const STATS_FILE = './stats.json';
function getToday() { return new Date().toISOString().split('T')[0]; }
function loadStats() { try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')); } catch { return {}; } }
function saveStats() { try { fs.writeFileSync(STATS_FILE, JSON.stringify(dailyActions, null, 2)); } catch {} }
let dailyActions = loadStats();

function incrementCount(userId, action) {
  const t = getToday();
  if (!dailyActions[userId]) dailyActions[userId] = {};
  if (!dailyActions[userId][t]) dailyActions[userId][t] = {};
  dailyActions[userId][t][action] = (dailyActions[userId][t][action] || 0) + 1;
  saveStats();
  return dailyActions[userId][t][action];
}
function getCount(userId, action) { return dailyActions[userId]?.[getToday()]?.[action] || 0; }

const COLORS = { danger: 0xE24B4A, warn: 0xFAA61A, success: 0x57C97A, info: 0x5865F2 };

// ======= Events Log =======
const EVENTS_LOG_FILE = './events.log';
function writeEventLog(type, executor, violation, punishment) {
  const clean = s => String(s).replace(/<[^>]+>/g, '').trim();
  const line = `[${new Date().toISOString()}] [${type}] executor=${clean(executor)} | violation=${clean(violation)} | punishment=${clean(punishment)}\n`;
  try { fs.appendFileSync(EVENTS_LOG_FILE, line); } catch (err) { console.error('❌ Log write failed:', err.message); }
}

function buildLogMessage({ type, executor, violation, punishment, extra = [], color = COLORS.danger }) {
  const e1 = getRandLogEmoji(), e2 = getRandLogEmoji(), e3 = getRandLogEmoji();
  const titles = {
    ban: `${e1} تبنيد عضو`, serverEdit: `${e1} تغيير إعدادات السيرفر`,
    adminRole: `${e1} إعطاء صلاحية Administrator`, channelDel: `${e1} حذف روم`,
    roleDel: `${e1} حذف رتبة`, botAdd: `${e1} إضافة بوت غير مصرح`,
    whitelist: `${e1} تعديل الوايت ليست`, webhook: `${e1} إنشاء ويبهوك`,
    kick: `${e1} طرد عضو`, botRoleMod: `${e1} تعديل صلاحيات رتبة البوت`,
    massban: `${e1} ماس بان — إيقاف فوري`, proxyRole: `${e1} إعطاء رتبة عبر بوت وسيط`,
  };
  const typeLabels = {
    ban: '🔴 تبنيد', serverEdit: '🔴 تغيير السيرفر', adminRole: '🔴 صلاحية Admin',
    channelDel: '🟡 حذف روم', roleDel: '🟡 حذف رتبة', botAdd: '🔴 بوت غير مصرح',
    whitelist: '🟢 وايت ليست', webhook: '🟡 ويبهوك', kick: '🟡 طرد',
    botRoleMod: '🔴 تعديل رتبة البوت', massban: '🔴 ماس بان', proxyRole: '🔴 رتبة عبر بوت',
  };
  const desc = [
    `${e2} **المنفّذ**`, `> ${executor || 'غير معروف'}`, '',
    `${e3} **المخالفة**`, `> ${violation || '—'}`, '',
    `⚠️ **العقوبة**`, `> ${punishment || '—'}`,
  ];
  if (extra.length) extra.forEach(e => desc.push('', `**${e.name}**`, `> ${e.value}`));
  writeEventLog(type, executor, violation, punishment);
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(titles[type] || `${e1} ${type}`)
    .setDescription(desc.join('\n'))
    .addFields([{ name: '━━━━━━━━━━━━━━━━━━', value: `\`${typeLabels[type] || type}\` • <t:${Math.floor(Date.now() / 1000)}:R>`, inline: false }])
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: 'نظام الحماية • by zwh.', iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
}

async function sendLog(options) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (!channel) return;
    await channel.send({ embeds: [buildLogMessage(options)] });
  } catch (err) { console.error(`❌ Log failed: ${err.message}`); }
}

async function punish(guild, userId, reason) {
  try { await guild.members.ban(userId, { reason: `Auto-protection: ${reason}` }); console.log(`🔨 Banned ${userId}`); }
  catch (err) { console.error(`❌ Ban failed: ${err.message}`); }
}
async function kick(guild, userId, reason) {
  try { const m = await guild.members.fetch(userId); await m.kick(`Auto-protection: ${reason}`); console.log(`👢 Kicked ${userId}`); }
  catch (err) { console.error(`❌ Kick failed: ${err.message}`); }
}

async function getAuditEntry(guild, auditAction, targetId = null) {
  try {
    await new Promise(r => setTimeout(r, 500));
    const logs  = await guild.fetchAuditLogs({ limit: 1, type: auditAction });
    const entry = logs.entries.first();
    if (!entry) return null;
    if (targetId && entry.target?.id !== targetId) return null;
    return entry;
  } catch { return null; }
}
async function getAuditUser(guild, auditAction, targetId = null) {
  const entry = await getAuditEntry(guild, auditAction, targetId);
  return entry?.executor || null;
}

async function extractRealExecutorFromReason(reason, guild) {
  if (!reason) return null;
  const matchId = reason.match(/By:\s*(\d{17,20})/i);
  if (matchId) return matchId[1];
  const matchMention = reason.match(/<@!?(\d{17,20})>/);
  if (matchMention) return matchMention[1];
  const matchName = reason.match(/By:\s*([^\s|،,]+)/i);
  if (matchName) {
    const name = matchName[1].trim().toLowerCase();
    try {
      let found = guild.members.cache.find(m =>
        m.user.username.toLowerCase() === name ||
        (m.nickname && m.nickname.toLowerCase() === name) ||
        m.user.globalName?.toLowerCase() === name
      );
      if (!found) {
        const fetched = await guild.members.search({ query: name, limit: 5 });
        found = fetched.find(m =>
          m.user.username.toLowerCase() === name ||
          (m.nickname && m.nickname.toLowerCase() === name) ||
          m.user.globalName?.toLowerCase() === name
        );
      }
      if (found) return found.id;
    } catch {}
  }
  return null;
}

function replyEmbed({ color, title, description, fields = [], footer = 'by zwh.' }) {
  return new EmbedBuilder()
    .setColor(color).setTitle(title).setDescription(description).addFields(fields)
    .setThumbnail(client.user.displayAvatarURL())
    .setFooter({ text: footer, iconURL: client.user.displayAvatarURL() })
    .setTimestamp();
}

// ======= AFK =======
const afkUsers = {};
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ======= Anti Mass Mention =======
const recentMentions = {};

// =======================================
//   Register slash commands
// =======================================
async function registerCommands() {
  const wlTypes = [
    { name: 'Full Whitelist — User',       value: 'user' },
    { name: 'Full Whitelist — Role',        value: 'role' },
    { name: 'Whitelist — Add Bots',         value: 'addBots' },
    { name: 'Whitelist — Ban',              value: 'ban' },
    { name: '#️Whitelist — Channel Delete', value: 'channelDel' },
    { name: 'Whitelist — Webhook Create',   value: 'webhookCreate' },
    { name: 'Whitelist — Specific Bot',     value: 'bots' },
  ];

  const commands = [
    new SlashCommandBuilder()
      .setName('whitelist').setDescription('Manage the advanced whitelist')
      .addSubcommand(s => s.setName('add').setDescription('Add a user or role to the whitelist')
        .addStringOption(o => o.setName('type').setDescription('Whitelist type').setRequired(true).addChoices(...wlTypes))
        .addUserOption(o => o.setName('user').setDescription('User or bot'))
        .addRoleOption(o => o.setName('role').setDescription('Role')))
      .addSubcommand(s => s.setName('remove').setDescription('Remove from the whitelist')
        .addStringOption(o => o.setName('type').setDescription('Whitelist type').setRequired(true).addChoices(...wlTypes))
        .addUserOption(o => o.setName('user').setDescription('User or bot'))
        .addRoleOption(o => o.setName('role').setDescription('Role')))
      .addSubcommand(s => s.setName('list').setDescription('View the full whitelist'))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('protection').setDescription('Manage bot protections')
      .addSubcommand(s => s.setName('status').setDescription('View protection status'))
      .addSubcommand(s => s.setName('toggle').setDescription('Enable or disable a protection')
        .addStringOption(o => o.setName('type').setDescription('Protection type').setRequired(true).addChoices(
          { name: 'Server Settings + Admin', value: 'serverSettings' },
          { name: 'Anti-Raid',               value: 'antiRaid' },
          { name: 'Anti-Bots',               value: 'antiBots' },
          { name: 'Bot Role Protect',         value: 'botRoleProtect' },
        ))
        .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true)))
      .addSubcommand(s => s.setName('limits').setDescription('Edit daily action limits')
        .addIntegerOption(o => o.setName('bans').setDescription('Daily ban limit').setMinValue(1))
        .addIntegerOption(o => o.setName('channels').setDescription('Channel delete limit').setMinValue(1))
        .addIntegerOption(o => o.setName('roles').setDescription('Role delete limit').setMinValue(1))
        .addIntegerOption(o => o.setName('massban').setDescription('Mass ban trigger (per 5s)').setMinValue(2))
        .addIntegerOption(o => o.setName('channelspam').setDescription('Channel spam trigger (per 10s)').setMinValue(2))
        .addIntegerOption(o => o.setName('mention').setDescription('Mass mention trigger (per 10s)').setMinValue(2)))
      .toJSON(),

    new SlashCommandBuilder().setName('restart').setDescription('Restart the bot process').toJSON(),

    new SlashCommandBuilder()
      .setName('afk').setDescription('Set your AFK status')
      .addSubcommand(s => s.setName('set').setDescription('Set AFK with a reason')
        .addStringOption(o => o.setName('reason').setDescription('AFK reason').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Remove your AFK status'))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('rolelock').setDescription('Manage locked roles — only full whitelisted users can assign them')
      .addSubcommand(s => s.setName('add').setDescription('Lock a role')
        .addRoleOption(o => o.setName('role').setDescription('Role to lock').setRequired(true)))
      .addSubcommand(s => s.setName('remove').setDescription('Unlock a role')
        .addRoleOption(o => o.setName('role').setDescription('Role to unlock').setRequired(true)))
      .addSubcommand(s => s.setName('list').setDescription('View all locked roles'))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('logs').setDescription('Show recent protection events')
      .addIntegerOption(o => o.setName('count').setDescription('Number of events (default 10, max 30)').setMinValue(1).setMaxValue(30))
      .toJSON(),

    new SlashCommandBuilder().setName('stats').setDescription('Show today protection statistics').toJSON(),

    new SlashCommandBuilder()
      .setName('unban').setDescription('Unban a user by ID')
      .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for unban'))
      .toJSON(),

    new SlashCommandBuilder()
      .setName('webhooks').setDescription('Manage webhooks')
      .addSubcommand(s => s.setName('list').setDescription('List all webhooks'))
      .addSubcommand(s => s.setName('delete').setDescription('Delete a webhook')
        .addStringOption(o => o.setName('id').setDescription('Webhook ID').setRequired(true)))
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Slash commands registered');
  } catch (err) { console.error(`❌ Failed to register commands: ${err.message}`); }
}

// =======================================
//   Protection 1 — Server Settings + Admin
// =======================================
const guildUpdateCooldown = new Set();
client.on(Events.GuildUpdate, async (oldGuild, newGuild) => {
  if (!PROTECTION.serverSettings) return;
  if (guildUpdateCooldown.has(newGuild.id)) return;
  const changed = oldGuild.name !== newGuild.name || oldGuild.icon !== newGuild.icon
    || oldGuild.banner !== newGuild.banner || oldGuild.vanityURLCode !== newGuild.vanityURLCode;
  if (!changed) return;
  const executor = await getAuditUser(newGuild, AuditLogEvent.GuildUpdate);
  if (!executor || executor.id === client.user.id) return;
  const roles = await getMemberRoles(newGuild, executor.id);
  if (isWhitelisted(executor.id, roles)) return;
  await sendLog({ type: 'serverEdit', executor: `<@${executor.id}>`, violation: 'Changed server settings without permission', punishment: '🔨 بان دائم', color: COLORS.danger });
  guildUpdateCooldown.add(newGuild.id);
  setTimeout(() => guildUpdateCooldown.delete(newGuild.id), 5000);
  await punish(newGuild, executor.id, 'Changed server settings');
  try {
    if (oldGuild.name !== newGuild.name) await newGuild.setName(oldGuild.name);
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode && oldGuild.vanityURLCode) await newGuild.setVanityCode(oldGuild.vanityURLCode);
  } catch {}
});

const memberRoleCooldown = new Set();
const lockedRoleWarns = {};

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!PROTECTION.serverSettings) return;
  if (memberRoleCooldown.has(newMember.id)) return;

  const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));

  // حماية الرتب المقفلة
  const lockedRoleAdded = addedRoles.find(r => lockedRoles.includes(r.id));
  if (lockedRoleAdded) {
    const entryLocked = await getAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
    if (entryLocked) {
      const execLocked = entryLocked.executor;
      if (execLocked && execLocked.id !== client.user.id) {
        let realExecId = execLocked.id;
        if (execLocked.bot && PROXY_BOTS.includes(execLocked.id)) {
          const foundId = await extractRealExecutorFromReason(entryLocked.reason, newMember.guild);
          if (foundId) realExecId = foundId;
        }
        const execRoles = await getMemberRoles(newMember.guild, realExecId);
        if (!isWhitelisted(realExecId, execRoles)) {
          try { await newMember.roles.remove(lockedRoleAdded); } catch {}
          if (!lockedRoleWarns[realExecId]) lockedRoleWarns[realExecId] = 0;
          lockedRoleWarns[realExecId]++;
          const warnCount = lockedRoleWarns[realExecId];
          try {
            const realMember = await newMember.guild.members.fetch(realExecId);
            await realMember.send(
              `⚠️ **بطل واسطات**\n` +
              `**لا تعطي رتب بدون اذن مره ثانيه**\n` +
              `${lockedRoleAdded.name} لـ <@${newMember.id}>\n` +
              `**هذه الرتبة ما عندك صلاحيه ولا يحق لك إعطاؤها.**\n` +
              `**عدد التحذيرات:** ${warnCount}/**3 — عند الوصول لـ 3 ستُطرد من السيرفر.**`
            );
          } catch {}
          await sendLog({
            type: 'adminRole',
            executor: `<@${realExecId}>`,
            violation: `حاول يعطي رتبة مقفلة **${lockedRoleAdded.name}** لـ <@${newMember.id}>`,
            punishment: warnCount >= 3 ? '👢 طرد (3 تحذيرات)' : `⚠️ تحذير ${warnCount}/3 + سحب الرتبة`,
            color: warnCount >= 3 ? COLORS.danger : COLORS.warn,
          });
          if (warnCount >= 3) {
            lockedRoleWarns[realExecId] = 0;
            await kick(newMember.guild, realExecId, 'تجاوز 3 تحذيرات على الرتب المقفلة');
          }
          return;
        }
      }
    }
  }

  // حماية رتبة الأدمن
  const dangerRole = addedRoles.find(r => r.permissions.has(PermissionsBitField.Flags.Administrator) && !lockedRoles.includes(r.id));
  if (!dangerRole) return;

  const entry = await getAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
  if (!entry) return;
  const executor = entry.executor;
  if (!executor || executor.id === client.user.id) return;

  let realExecutorId = executor.id;
  let viaProxy = false;
  if (executor.bot && PROXY_BOTS.includes(executor.id)) {
    const foundId = await extractRealExecutorFromReason(entry.reason, newMember.guild);
    if (foundId) { realExecutorId = foundId; viaProxy = true; }
  }

  const roles = await getMemberRoles(newMember.guild, realExecutorId);
  if (isWhitelisted(realExecutorId, roles)) return;

  const extraInfo = viaProxy
    ? [{ name: '🤖 نُفِّذ عبر بوت', value: `<@${executor.id}> — الشخص الحقيقي: <@${realExecutorId}>` }]
    : [];

  await sendLog({
    type: viaProxy ? 'proxyRole' : 'adminRole',
    executor: `<@${realExecutorId}>`,
    violation: `أعطى رتبة **${dangerRole.name}** (Admin) لـ <@${newMember.id}>${viaProxy ? ` عبر <@${executor.id}>` : ''}`,
    punishment: 'بان',
    extra: extraInfo,
    color: COLORS.danger,
  });

  memberRoleCooldown.add(newMember.id);
  setTimeout(() => memberRoleCooldown.delete(newMember.id), 5000);
  try { await newMember.roles.remove(dangerRole); } catch {}
  await punish(newMember.guild, realExecutorId, 'Gave Administrator role without permission');
});

const roleUpdateCooldown = new Set();
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (!PROTECTION.serverSettings) return;
  if (roleUpdateCooldown.has(newRole.id)) return;
  const hadAdmin = oldRole.permissions.has(PermissionsBitField.Flags.Administrator);
  const hasAdmin = newRole.permissions.has(PermissionsBitField.Flags.Administrator);
  if (hadAdmin || !hasAdmin) return;
  const executor = await getAuditUser(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (!executor || executor.id === client.user.id) return;
  const roles = await getMemberRoles(newRole.guild, executor.id);
  if (isWhitelisted(executor.id, roles)) return;
  await sendLog({ type: 'adminRole', executor: `<@${executor.id}>`, violation: `Added Administrator permission to role **${newRole.name}**`, punishment: 'بان + استعادة الصلاحيات', color: COLORS.danger });
  roleUpdateCooldown.add(newRole.id);
  setTimeout(() => roleUpdateCooldown.delete(newRole.id), 5000);
  try { await newRole.setPermissions(oldRole.permissions); } catch {}
  await punish(newRole.guild, executor.id, 'Added Administrator to a role');
});

// =======================================
//   Protection — Bot Role Protect
// =======================================
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  if (!PROTECTION.botRoleProtect) return;
  const botMember = newRole.guild.members.cache.get(client.user.id);
  if (!botMember) return;
  if (!botMember.roles.cache.has(newRole.id)) return;
  if (oldRole.permissions.bitfield === newRole.permissions.bitfield) return;
  const executor = await getAuditUser(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
  if (!executor || executor.id === client.user.id) return;
  const roles = await getMemberRoles(newRole.guild, executor.id);
  if (isWhitelisted(executor.id, roles)) return;
  await sendLog({ type: 'botRoleMod', executor: `<@${executor.id}>`, violation: `Tried to modify bot's role **${newRole.name}** permissions`, punishment: '🔨 بان فوري + استعادة الصلاحيات', color: COLORS.danger });
  try { await newRole.setPermissions(oldRole.permissions); } catch {}
  await punish(newRole.guild, executor.id, 'Modified bot role permissions');
});

// =======================================
//   Protection 2 — Anti-Raid
// =======================================
client.on(Events.ChannelDelete, async (channel) => {
  if (!PROTECTION.antiRaid || !channel.guild) return;
  const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
  if (!executor) return;
  const roles = await getMemberRoles(channel.guild, executor.id);
  if (hasSpecificWL(executor.id, roles, 'channelDel')) return;
  const count = incrementCount(executor.id, 'channelDeletes');
  const over  = count >= LIMITS.channelDeletes;
  await sendLog({ type: 'channelDel', executor: `<@${executor.id}>`, violation: `Deleted **${channel.name}** — ${count}/${LIMITS.channelDeletes}`, punishment: over ? 'بان' : `⚠️ تحذير — ${LIMITS.channelDeletes - count} متبقية`, color: over ? COLORS.danger : COLORS.warn });
  if (over) await punish(channel.guild, executor.id, `Exceeded channel delete limit`);
});

client.on(Events.GuildRoleDelete, async (role) => {
  if (!PROTECTION.antiRaid) return;
  const executor = await getAuditUser(role.guild, AuditLogEvent.RoleDelete, role.id);
  if (!executor) return;
  const roles = await getMemberRoles(role.guild, executor.id);
  if (isWhitelisted(executor.id, roles)) return;
  const count = incrementCount(executor.id, 'roleDeletes');
  const over  = count >= LIMITS.roleDeletes;
  await sendLog({ type: 'roleDel', executor: `<@${executor.id}>`, violation: `Deleted role **${role.name}** — ${count}/${LIMITS.roleDeletes}`, punishment: over ? 'بان' : `⚠️ تحذير — ${LIMITS.roleDeletes - count} متبقية`, color: over ? COLORS.danger : COLORS.warn });
  if (over) await punish(role.guild, executor.id, `Exceeded role delete limit`);
});

client.on(Events.GuildAuditLogEntryCreate, async (entry, guild) => {
  if (!PROTECTION.antiRaid) return;
  if (entry.action !== AuditLogEvent.MemberBanAdd) return;
  const executor = entry.executor;
  if (!executor || executor.id === client.user.id) return;
  const roles = await getMemberRoles(guild, executor.id);
  if (hasSpecificWL(executor.id, roles, 'ban')) return;

  const count = incrementCount(executor.id, 'bans');

  if (count >= LIMITS.bans) {
    await sendLog({
      type: 'massban',
      executor: `<@${executor.id}>`,
      violation: `وصل ${count} بانات في يوم واحد`,
      punishment: '👢 طرد من السيرفر (تجاوز الحد اليومي)',
      color: COLORS.danger,
    });
    await kick(guild, executor.id, 'Exceeded daily ban limit');
  }
});

// =======================================
//   Protection 3 — Anti-Bots
// =======================================
client.on(Events.GuildMemberAdd, async (member) => {
  if (!PROTECTION.antiBots || !member.user.bot) return;
  if (whitelist.bots.includes(member.id)) return;
  const executor = await getAuditUser(member.guild, AuditLogEvent.BotAdd, member.id);
  const roles = executor ? await getMemberRoles(member.guild, executor.id) : [];
  if (executor && hasSpecificWL(executor.id, roles, 'addBots')) return;
  await sendLog({ type: 'botAdd', executor: executor ? `<@${executor.id}>` : 'غير معروف', violation: `Added bot <@${member.id}> without permission`, punishment: 'بان البوت + بان المضيف', color: COLORS.danger });
  await punish(member.guild, member.id, 'Unauthorized bot added');
  if (executor && !isWhitelisted(executor.id, roles)) await punish(member.guild, executor.id, 'Added unauthorized bot');
});

// =======================================
//   Protection 4 — Webhook guard
// =======================================
client.on(Events.WebhooksUpdate, async (channel) => {
  if (!PROTECTION.serverSettings) return;
  try {
    const executor = await getAuditUser(channel.guild, AuditLogEvent.WebhookCreate);
    if (!executor || executor.id === client.user.id) return;
    const roles = await getMemberRoles(channel.guild, executor.id);
    if (hasSpecificWL(executor.id, roles, 'webhookCreate')) return;
    const hooks   = await channel.fetchWebhooks();
    const newHook = hooks.find(h => h.owner?.id === executor.id);
    await sendLog({ type: 'webhook', executor: `<@${executor.id}>`, violation: `Created webhook in <#${channel.id}>`, punishment: 'بان + حذف الويبهوك', color: COLORS.danger });
    if (newHook) try { await newHook.delete(); } catch {}
    await punish(channel.guild, executor.id, 'Created unauthorized webhook');
  } catch {}
});

// =======================================
//   Protection — Anti Channel Spam
// =======================================
const recentChannelCreates = {};
client.on(Events.ChannelCreate, async (channel) => {
  if (!PROTECTION.antiRaid || !channel.guild) return;
  const executor = await getAuditUser(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
  if (!executor || executor.id === client.user.id) return;
  const roles = await getMemberRoles(channel.guild, executor.id);
  if (isWhitelisted(executor.id, roles)) return;
  const now = Date.now();
  if (!recentChannelCreates[executor.id]) recentChannelCreates[executor.id] = [];
  recentChannelCreates[executor.id].push(now);
  recentChannelCreates[executor.id] = recentChannelCreates[executor.id].filter(t => now - t <= LIMITS.channelCreateWindow);
  const count = recentChannelCreates[executor.id].length;
  if (count >= LIMITS.channelCreateCount) {
    await sendLog({ type: 'channelDel', executor: `<@${executor.id}>`, violation: `أنشأ ${count} رومات في ${LIMITS.channelCreateWindow / 1000}s`, punishment: 'بان (channel spam)', color: COLORS.danger });
    recentChannelCreates[executor.id] = [];
    try { await channel.delete(); } catch {}
    await punish(channel.guild, executor.id, `Channel spam`);
  }
});

// =======================================
//   MessageCreate — AFK + Anti Mention
// =======================================
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;

  // ======= AFK =======
  if (msg.guild) {
    if (afkUsers[msg.author.id]) {
      const { timestamp } = afkUsers[msg.author.id];
      delete afkUsers[msg.author.id];
      const dur = formatDuration(Date.now() - timestamp);
      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<a:by_ez_75:1426985705640296478> Welcome back <@${msg.author.id}>! Your AFK has been removed.`),
          new TextDisplayBuilder().setContent(`<a:by_ez_85:1436789611538944020> You were AFK for **${dur}**`)
        );
      try {
        await msg.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { repliedUser: false },
        });
      } catch {}
    }

    for (const mentioned of msg.mentions.users.values()) {
      if (!afkUsers[mentioned.id]) continue;
      const { reason, timestamp } = afkUsers[mentioned.id];
      const dur = formatDuration(Date.now() - timestamp);
      const jumpLink = `https://discord.com/channels/${msg.guild.id}/${msg.channel.id}/${msg.id}`;
      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<@${mentioned.id}> is currently AFK for reason: **${reason}**`),
          new TextDisplayBuilder().setContent(`<:by_ez_11:1421844801363513525> Since **${dur}** ago`),
          new TextDisplayBuilder().setContent(`🔗 [Jump to message](${jumpLink})`)
        );
      try {
        await msg.reply({
          content: `yo <@${msg.author.id}>`,
          components: [container],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { users: [msg.author.id] },
        });
      } catch {}
    }

    // ======= Anti Mass Mention =======
    if (PROTECTION.antiRaid && msg.mentions.everyone) {
      const userId = msg.author.id;
      const roles  = await getMemberRoles(msg.guild, userId);
      if (!isWhitelisted(userId, roles)) {
        const now = Date.now();
        if (!recentMentions[userId]) recentMentions[userId] = [];
        recentMentions[userId].push(now);
        recentMentions[userId] = recentMentions[userId].filter(t => now - t <= LIMITS.mentionWindow);
        const count = recentMentions[userId].length;
        if (count >= LIMITS.mentionCount) {
          await sendLog({ type: 'ban', executor: `<@${userId}>`, violation: `منشن everyone/here ${count} مرات في ${LIMITS.mentionWindow / 1000}s`, punishment: 'بان', color: COLORS.danger });
          recentMentions[userId] = [];
          try { await msg.delete(); } catch {}
          await punish(msg.guild, userId, `Mass mention`);
          return;
        }
      }
    }
  }
});

// =======================================
//   Interactions
// =======================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const ownerOnly = async () => {
    if (!BOT_OWNER_IDS.includes(interaction.user.id)) {
      await interaction.reply({ embeds: [replyEmbed({ color: COLORS.danger, title: '🚫 Access Denied', description: '> This command is for bot owners only.' })] });
      return false;
    }
    return true;
  };

  // ===================== /restart =====================
  if (interaction.commandName === 'restart') {
    if (!await ownerOnly()) return;
    await interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '🔄 Restarting...', description: '> البوت رح يعيد التشغيل لوحده استناه' })] });
    console.log(`🔄 Restart requested by ${interaction.user.tag}`);
    setTimeout(() => process.exit(0), 1500);
    return;
  }

  // ===================== /afk =====================
  if (interaction.commandName === 'afk') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const reason = interaction.options.getString('reason');
      afkUsers[interaction.user.id] = { reason, timestamp: Date.now() };
      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`<a:0eedb1708500b0f0a1fcfdb2a5fe3f5b:1367454646603354203> You are now AFK`),
          new TextDisplayBuilder().setContent(` Reason: **${reason}**`),
          new TextDisplayBuilder().setContent(`<a:by_ez_110:1467020393289093121> Your AFK will be removed when you send a message.`)
        );
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'remove') {
      if (!afkUsers[interaction.user.id]) {
        const container = new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`⚠️ You are not currently AFK.`));
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }
      delete afkUsers[interaction.user.id];
      const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`✅ Your AFK status has been removed.`));
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  }

  // ===================== /logs =====================
  if (interaction.commandName === 'logs') {
    if (!await ownerOnly()) return;
    await interaction.deferReply();
    const count = interaction.options.getInteger('count') || 10;
    try {
      if (!fs.existsSync(EVENTS_LOG_FILE))
        return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.info, title: 'Logs', description: '> لا يوجد سجل أحداث بعد.' })] });
      const raw   = fs.readFileSync(EVENTS_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
      const lines = raw.slice(-count).reverse();
      if (!lines.length)
        return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.info, title: 'Logs', description: '> السجل فارغ.' })] });
      const formatted = lines.map((l, i) => {
        const match = l.match(/^\[(.+?)\] \[(.+?)\] executor=(.+?) \| violation=(.+?) \| punishment=(.+)$/);
        if (!match) return `\`${l.slice(0, 80)}\``;
        const [, ts, type, exec, viol] = match;
        const time = `<t:${Math.floor(new Date(ts).getTime() / 1000)}:R>`;
        return `**${i + 1}.** \`${type}\` ${time}\n> 👤 ${exec}\n> 📌 ${viol.slice(0, 80)}`;
      });
      const chunks = []; let cur = '';
      for (const l of formatted) {
        if ((cur + '\n\n' + l).length > 3800) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n\n' + l : l;
      }
      if (cur) chunks.push(cur);
      return interaction.editReply({ embeds: chunks.map((c, i) => replyEmbed({ color: COLORS.info, title: i === 0 ? `آخر ${lines.length} أحداث` : '​', description: c })) });
    } catch (err) {
      return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.danger, title: '❌ Error', description: `> ${err.message}` })] });
    }
  }

  // ===================== /stats =====================
  if (interaction.commandName === 'stats') {
    if (!await ownerOnly()) return;
    const today = getToday();
    dailyActions = loadStats();
    let totalBans = 0, totalKicks = 0, totalChannelDel = 0, totalRoleDel = 0;
    for (const uid of Object.keys(dailyActions)) {
      totalBans       += dailyActions[uid]?.[today]?.bans           || 0;
      totalKicks      += dailyActions[uid]?.[today]?.kicks          || 0;
      totalChannelDel += dailyActions[uid]?.[today]?.channelDeletes || 0;
      totalRoleDel    += dailyActions[uid]?.[today]?.roleDeletes    || 0;
    }
    let totalEvents = 0;
    try {
      if (fs.existsSync(EVENTS_LOG_FILE))
        totalEvents = fs.readFileSync(EVENTS_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).length;
    } catch {}
    return interaction.reply({ embeds: [replyEmbed({ color: COLORS.info, title: 'إحصائيات اليوم', description: [
      `**📅 التاريخ:** \`${today}\``, '',
      `**🔨 بانات اليوم:** \`${totalBans}\``,
      `**👢 طرد اليوم:** \`${totalKicks}\``,
      `**🗑️ حذف روم:** \`${totalChannelDel}\``,
      `**🗑️ حذف رتبة:** \`${totalRoleDel}\``, '',
      `**📋 إجمالي الأحداث المسجلة:** \`${totalEvents}\``,
    ].join('\n') })] });
  }

  // ===================== /unban =====================
  if (interaction.commandName === 'unban') {
    if (!await ownerOnly()) return;
    await interaction.deferReply();
    const userId = interaction.options.getString('user_id').trim();
    const reason = interaction.options.getString('reason') || 'Manual unban by owner';
    try {
      await interaction.guild.members.unban(userId, reason);
      await sendLog({ type: 'whitelist', executor: `<@${interaction.user.id}>`, violation: `Unbanned user \`${userId}\``, punishment: `✅ رُفع البان — ${reason}`, color: COLORS.success });
      return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.success, title: '✅ Unbanned', description: `> تم رفع البان عن \`${userId}\`.\n> **السبب:** ${reason}` })] });
    } catch (err) {
      return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.danger, title: '❌ Error', description: `> فشل رفع البان: ${err.message}` })] });
    }
  }

  // ===================== /webhooks =====================
  if (interaction.commandName === 'webhooks') {
    if (!await ownerOnly()) return;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply();
    if (sub === 'list') {
      try {
        const all = await interaction.guild.fetchWebhooks();
        if (!all.size) return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.info, title: '🪝 Webhooks', description: '> No webhooks found.' })] });
        const lines = all.map(w => {
          const ch = w.channelId ? `<#${w.channelId}>` : 'Unknown';
          const ow = w.owner ? `<@${w.owner.id}>` : 'Unknown';
          const mine = w.owner?.id === client.user.id ? ' *(bot)*' : '';
          return `**${w.name}${mine}**\n> 📌 ${ch}\n> 👤 ${ow}\n> 🔑 \`${w.id}\``;
        });
        const chunks = []; let cur = '';
        for (const l of lines) { if ((cur + '\n\n' + l).length > 3800) { chunks.push(cur); cur = l; } else cur = cur ? cur + '\n\n' + l : l; }
        if (cur) chunks.push(cur);
        return interaction.editReply({ embeds: chunks.map((c, i) => replyEmbed({ color: COLORS.info, title: i === 0 ? `🪝 Webhooks (${all.size})` : '​', description: c })) });
      } catch (err) {
        return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.danger, title: '❌ Error', description: `${err.message}` })] });
      }
    }
    if (sub === 'delete') {
      const hookId = interaction.options.getString('id');
      try {
        const hook = await interaction.guild.fetchWebhooks().then(h => h.get(hookId));
        if (!hook) return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️ Not Found', description: '> No webhook found with that ID.' })] });
        await hook.delete('Manual deletion by owner');
        return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.success, title: '✅ Deleted', description: `> Webhook **${hook.name}** deleted.` })] });
      } catch (err) {
        return interaction.editReply({ embeds: [replyEmbed({ color: COLORS.danger, title: '❌ Error', description: `${err.message}` })] });
      }
    }
  }

  // ===================== /protection =====================
  if (interaction.commandName === 'protection') {
    if (!await ownerOnly()) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const s = v => v ? '✅ Enabled' : '❌ Disabled';
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.info, title: 'Protection Status', description: [
        `**Server Settings**`, `> ${s(PROTECTION.serverSettings)}`, '',
        `**Anti-Raid**`, `> ${s(PROTECTION.antiRaid)} — Bans: \`${LIMITS.bans}/day\` | Ch: \`${LIMITS.channelDeletes}\` | Roles: \`${LIMITS.roleDeletes}\``, '',
        `**Anti Channel Spam**`, `> ${s(PROTECTION.antiRaid)} — Trigger: \`${LIMITS.channelCreateCount}/${LIMITS.channelCreateWindow/1000}s\``, '',
        `**Anti Mass Mention**`, `> ${s(PROTECTION.antiRaid)} — Trigger: \`${LIMITS.mentionCount}/${LIMITS.mentionWindow/1000}s\``, '',
        `**Anti-Bots**`, `> ${s(PROTECTION.antiBots)}`, '',
        `**Bot Role Protect**`, `> ${s(PROTECTION.botRoleProtect)}`,
      ].join('\n') })] });
    }
    if (sub === 'toggle') {
      const type    = interaction.options.getString('type');
      const enabled = interaction.options.getBoolean('enabled');
      const names   = { serverSettings: 'Server Settings + Admin', antiRaid: 'Anti-Raid', antiBots: 'Anti-Bots', botRoleProtect: 'Bot Role Protect' };
      PROTECTION[type] = enabled;
      return interaction.reply({ embeds: [replyEmbed({ color: enabled ? COLORS.success : COLORS.danger, title: enabled ? '✅ Enabled' : '❌ Disabled', description: `> **${names[type]}** is now ${enabled ? 'enabled' : 'disabled'}.` })] });
    }
    if (sub === 'limits') {
      const bans        = interaction.options.getInteger('bans');
      const ch          = interaction.options.getInteger('channels');
      const rl          = interaction.options.getInteger('roles');
      const massban     = interaction.options.getInteger('massban');
      const channelspam = interaction.options.getInteger('channelspam');
      const mention     = interaction.options.getInteger('mention');
      const changes = [];
      if (bans        != null) { LIMITS.bans               = bans;        changes.push(`Bans/day: \`${bans}\``); }
      if (ch          != null) { LIMITS.channelDeletes     = ch;          changes.push(`Channels: \`${ch}\``); }
      if (rl          != null) { LIMITS.roleDeletes        = rl;          changes.push(`Roles: \`${rl}\``); }
      if (massban     != null) { LIMITS.massbanCount       = massban;     changes.push(`Mass Ban: \`${massban}/${LIMITS.massbanWindow/1000}s\``); }
      if (channelspam != null) { LIMITS.channelCreateCount = channelspam; changes.push(`Channel Spam: \`${channelspam}/${LIMITS.channelCreateWindow/1000}s\``); }
      if (mention     != null) { LIMITS.mentionCount       = mention;     changes.push(`Mass Mention: \`${mention}/${LIMITS.mentionWindow/1000}s\``); }
      if (!changes.length) return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️', description: '> No values provided.' })] });
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.success, title: '✅ Limits Updated', description: `> ${changes.join(' — ')}` })] });
    }
  }

  // ===================== /rolelock =====================
  if (interaction.commandName === 'rolelock') {
    if (!await ownerOnly()) return;
    const sub  = interaction.options.getSubcommand();
    const role = interaction.options.getRole('role');

    if (sub === 'add') {
      if (lockedRoles.includes(role.id))
        return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️ موجودة', description: `> <@&${role.id}> مقفلة مسبقاً.` })] });
      lockedRoles.push(role.id);
      saveRolelock();
      await sendLog({ type: 'whitelist', executor: `<@${interaction.user.id}>`, violation: `قفل رتبة <@&${role.id}>`, punishment: 'فقط الفول وايت ليست يقدرون يعطونها', color: COLORS.warn });
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.success, title: '🔒 تم القفل', description: `> <@&${role.id}> الحين مقفلة.` })] });
    }
    if (sub === 'remove') {
      if (!lockedRoles.includes(role.id))
        return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️ مو موجودة', description: `> <@&${role.id}> مو مقفلة.` })] });
      lockedRoles = lockedRoles.filter(id => id !== role.id);
      saveRolelock();
      await sendLog({ type: 'whitelist', executor: `<@${interaction.user.id}>`, violation: `فك قفل رتبة <@&${role.id}>`, punishment: '—', color: COLORS.success });
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.success, title: '🔓 تم الفك', description: `> <@&${role.id}> الحين غير مقفلة.` })] });
    }
    if (sub === 'list') {
      const desc = lockedRoles.length
        ? lockedRoles.map(id => `> <@&${id}>`).join('\n')
        : '> *لا يوجد رتب مقفلة*';
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.info, title: '🔒 الرتب المقفلة', description: desc })] });
    }
  }

  // ===================== /whitelist =====================
  if (interaction.commandName === 'whitelist') {
    if (!await ownerOnly()) return;
    const sub  = interaction.options.getSubcommand();
    const type = interaction.options.getString('type');
    const keyMap    = { user:'users', role:'roles', addBots:'addBots', ban:'ban', channelDel:'channelDel', webhookCreate:'webhookCreate', bots:'bots' };
    const typeNames = { user:'Full Whitelist (User)', role:'Full Whitelist (Role)', addBots:'Add Bots Whitelist', ban:'Ban Whitelist', channelDel:'Channel Delete Whitelist', webhookCreate:'Webhook Create Whitelist', bots:'Specific Bot Whitelist' };

    const getTarget = () => {
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (type === 'role') { if (!role) return { error: 'يجب تحديد **رتبة**.' }; return { id: role.id, name: `<@&${role.id}>` }; }
      if (type === 'bots') { if (!user) return { error: 'يجب تحديد **بوت**.' }; return { id: user.id, name: `<@${user.id}>` }; }
      if (user) return { id: user.id, name: `<@${user.id}>` };
      if (role) return { id: role.id, name: `<@&${role.id}>` };
      return { error: 'يجب تحديد **شخص** أو **رتبة**.' };
    };

    if (sub === 'add') {
      const target = getTarget();
      if (target.error) return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️', description: `> ${target.error}` })] });
      const key = keyMap[type]; const list = whitelist[key] || [];
      if (list.includes(target.id)) return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️ Already Exists', description: `> ${target.name} is already in **${typeNames[type]}**.` })] });
      whitelist[key] = [...list, target.id]; saveWhitelist();
      await sendLog({ type: 'whitelist', executor: `<@${interaction.user.id}>`, violation: `Added ${target.name} to (${typeNames[type]})`, punishment: '—', color: COLORS.success });
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.success, title: '✅ Added', description: `> ${target.name} added to **${typeNames[type]}**.` })] });
    }
    if (sub === 'remove') {
      const target = getTarget();
      if (target.error) return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️', description: `> ${target.error}` })] });
      const key = keyMap[type]; const list = whitelist[key] || [];
      if (!list.includes(target.id)) return interaction.reply({ embeds: [replyEmbed({ color: COLORS.warn, title: '⚠️ Not Found', description: `> ${target.name} is not in **${typeNames[type]}**.` })] });
      whitelist[key] = list.filter(id => id !== target.id); saveWhitelist();
      await sendLog({ type: 'whitelist', executor: `<@${interaction.user.id}>`, violation: `Removed ${target.name} from (${typeNames[type]})`, punishment: '—', color: COLORS.danger });
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.success, title: '✅ Removed', description: `> ${target.name} removed from **${typeNames[type]}**.` })] });
    }
    if (sub === 'list') {
      const sections = [
        { key:'users', label:'Full Whitelist (Users)', mention: id => `<@${id}>` },
        { key:'roles', label:'Full Whitelist (Roles)', mention: id => `<@&${id}>` },
        { key:'addBots', label:'Can Add Bots', mention: id => `<@${id}>` },
        { key:'ban', label:'Can Ban', mention: id => `<@${id}>` },
        { key:'channelDel', label:'Can Delete Channels', mention: id => `<@${id}>` },
        { key:'webhookCreate', label:'Can Create Webhooks', mention: id => `<@${id}>` },
        { key:'bots', label:'Allowed Bots', mention: id => `<@${id}>` },
      ];
      const desc = sections.map(s => { const l = whitelist[s.key] || []; return `**${s.label}**\n> ${l.length ? l.map(s.mention).join(' ') : '*empty*'}`; }).join('\n\n');
      return interaction.reply({ embeds: [replyEmbed({ color: COLORS.info, title: 'Full Whitelist', description: desc, footer: `by zwh. • Total users: ${whitelist.users.length}` })] });
    }
  }
});

// =======================================
//   Ready
// =======================================
client.once(Events.ClientReady, async () => {
  const presences = [
    { name: '𝒃𝒚 𝒛𝒘𝒉.', type: 0 },
    { name: 'discord.gg/ez1', type: 3 },
    { name: 'hello', type: 3 },
    { name: '𝒃𝒚 𝒛𝒘𝒉.', type: 2 },
  ];
  let presenceIndex = 0;
  const setPresence = () => { client.user.setPresence({ status: 'dnd', activities: [presences[presenceIndex++ % presences.length]] }); };
  setPresence();
  setInterval(setPresence, 15_000);
  console.log(`\n🤖 ${client.user.tag} — Online`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  await registerCommands();
  console.log('\n✅ Protections:');
  console.log(`  ${PROTECTION.serverSettings ? '✅' : '❌'} Server Settings `);
  console.log(`  ${PROTECTION.antiRaid       ? '✅' : '❌'} Anti-Raid`);
  console.log(`  ${PROTECTION.antiBots       ? '✅' : '❌'} Anti-Bots`);
  console.log(`  ${PROTECTION.botRoleProtect ? '✅' : '❌'} Bot Role Protect`);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

client.login(BOT_TOKEN);
