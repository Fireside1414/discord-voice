require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { Client } = require('discord.js-selfbot-v13');

const USER_TOKEN = process.env.BOT_TOKEN;
const WEB_PASSWORD = process.env.WEB_PASSWORD || 'admin';
const WEB_PORT = parseInt(process.env.WEB_PORT || '5000');
const DATA_FILE = 'voice_data_final.json';

if (!USER_TOKEN) {
    console.error('❌ Không tìm thấy BOT_TOKEN trong .env');
    process.exit(1);
}

/* ==========================
   DISCORD SELF BOT
========================== */

const client = new Client({ checkUpdate: false });
const activeUserSessions = new Map();

/* ---------- DATA ---------- */

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveVoiceTime(guildId, userId, seconds) {
    if (seconds <= 0) return;
    const data = loadData();
    const today = new Date().toISOString().slice(0, 10);

    data[guildId] ??= {};
    data[guildId][userId] ??= {};
    data[guildId][userId][today] ??= 0;
    data[guildId][userId][today] += seconds;

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

/* ---------- AUTO SAVE ---------- */

setInterval(() => {
    const now = Date.now() / 1000;
    for (const [key, start] of activeUserSessions.entries()) {
        const dur = Math.floor(now - start);
        if (dur > 0) {
            const [uid, gid] = key.split(':');
            saveVoiceTime(gid, uid, dur);
            activeUserSessions.set(key, now);
        }
    }
}, 60 * 1000);

/* ---------- SCAN VOICE ---------- */

async function scanExistingVoiceUsers() {
    let count = 0;
    const now = Date.now() / 1000;
    client.guilds.cache.forEach(guild => {
        guild.channels.cache
            .filter(c => c.isVoice())
            .forEach(vc => {
                vc.members.forEach(m => {
                    const key = `${m.id}:${guild.id}`;
                    if (!activeUserSessions.has(key)) {
                        activeUserSessions.set(key, now);
                        count++;
                    }
                });
            });
    });
    console.log(`✅ Đã quét ${count} user đang ngồi voice`);
}

/* ---------- EVENTS ---------- */

client.on('ready', async () => {
    console.log(`✅ Logged in as ${client.user.username}`);
    console.log(`🔒 Web UI: http://localhost:${WEB_PORT}`);
    await scanExistingVoiceUsers();
});

client.on('voiceStateUpdate', (oldState, newState) => {
    const uid = newState.id;
    const gid = newState.guild.id;
    const key = `${uid}:${gid}`;
    const now = Date.now() / 1000;

    if (!oldState.channelId && newState.channelId) {
        activeUserSessions.set(key, now);
    }

    if (oldState.channelId && !newState.channelId) {
        if (activeUserSessions.has(key)) {
            const start = activeUserSessions.get(key);
            activeUserSessions.delete(key);
            saveVoiceTime(gid, uid, Math.floor(now - start));
        }
    }
});

/* ==========================
   WEB SERVER
========================== */

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: Math.random().toString(36),
    resave: false,
    saveUninitialized: false
}));

function loginRequired(req, res, next) {
    if (!req.session.logged) return res.redirect('/login');
    next();
}

/* ---------- LOGIN ---------- */

app.get('/login', (req, res) => {
    res.send(`
        <form method="POST">
            <input type="password" name="password" placeholder="Password"/>
            <button>Login</button>
        </form>
    `);
});

app.post('/login', (req, res) => {
    if (req.body.password === WEB_PASSWORD) {
        req.session.logged = true;
        res.redirect('/');
    } else {
        res.send('Sai mật khẩu');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

/* ---------- DASHBOARD ---------- */

app.get('/', loginRequired, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

/* ---------- API ---------- */

app.get('/api/servers', loginRequired, (req, res) => {
    const servers = [...client.guilds.cache.values()]
        .map(g => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    res.json(servers);
});

app.get('/api/stats', loginRequired, (req, res) => {
    const { guild_id, days = 7 } = req.query;
    const data = loadData();
    const cutoff = Date.now() - days * 86400000;
    const now = Date.now() / 1000;

    const finalStats = {};

    if (data[guild_id]) {
        for (const uid in data[guild_id]) {
            for (const date in data[guild_id][uid]) {
                if (new Date(date).getTime() >= cutoff) {
                    finalStats[uid] ??= 0;
                    finalStats[uid] += data[guild_id][uid][date];
                }
            }
        }
    }

    for (const [key, start] of activeUserSessions.entries()) {
        const [uid, gid] = key.split(':');
        if (gid === guild_id) {
            finalStats[uid] ??= 0;
            finalStats[uid] += Math.floor(now - start);
        }
    }

    const guild = client.guilds.cache.get(guild_id);
    const result = [];

    for (const uid in finalStats) {
        const member = guild?.members.cache.get(uid);
        const seconds = finalStats[uid];
        const h = Math.floor(seconds / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        const s = seconds % 60;

        result.push({
            name: member?.displayName || `User ${uid}`,
            time_str: `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${s}s`,
            seconds,
            is_online: activeUserSessions.has(`${uid}:${guild_id}`)
        });
    }

    result.sort((a, b) => b.seconds - a.seconds);
    res.json(result);
});

/* ---------- START ---------- */

app.listen(WEB_PORT, () => {
    console.log(`🌐 Web server running on port ${WEB_PORT}`);
});

client.login(USER_TOKEN);
