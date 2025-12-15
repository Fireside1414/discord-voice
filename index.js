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
    console.error('❌ Thiếu BOT_TOKEN trong .env');
    process.exit(1);
}

/* ================= DISCORD ================= */

const client = new Client({ checkUpdate: false });
const activeUserSessions = new Map();

/* ================= DATA ================= */

function loadData() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveVoiceTime(gid, uid, sec) {
    if (sec <= 0) return;
    const data = loadData();
    const today = new Date().toISOString().slice(0, 10);

    data[gid] ??= {};
    data[gid][uid] ??= {};
    data[gid][uid][today] ??= 0;
    data[gid][uid][today] += sec;

    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

/* ================= AUTO SAVE ================= */

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
}, 60000);

/* ================= VOICE ================= */

async function scanVoice() {
    let c = 0;
    const now = Date.now() / 1000;
    client.guilds.cache.forEach(g => {
        g.channels.cache.filter(c => c.isVoice()).forEach(vc => {
            vc.members.forEach(m => {
                const key = `${m.id}:${g.id}`;
                if (!activeUserSessions.has(key)) {
                    activeUserSessions.set(key, now);
                    c++;
                }
            });
        });
    });
    console.log(`✅ Quét ${c} user đang voice`);
}

client.on('ready', async () => {
    console.log(`✅ Logged in: ${client.user.username}`);
    console.log(`🌐 Web: http://localhost:${WEB_PORT}`);
    await scanVoice();
});

client.on('voiceStateUpdate', (oldS, newS) => {
    const uid = newS.id;
    const gid = newS.guild.id;
    const key = `${uid}:${gid}`;
    const now = Date.now() / 1000;

    if (!oldS.channelId && newS.channelId) {
        activeUserSessions.set(key, now);
    }

    if (oldS.channelId && !newS.channelId && activeUserSessions.has(key)) {
        saveVoiceTime(gid, uid, Math.floor(now - activeUserSessions.get(key)));
        activeUserSessions.delete(key);
    }
});

/* ================= WEB ================= */

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: Math.random().toString(36),
    resave: false,
    saveUninitialized: false
}));

function auth(req, res, next) {
    if (!req.session.logged) return res.redirect('/login');
    next();
}

/* ---------- LOGIN ---------- */

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.post('/login', (req, res) => {
    if (req.body.password === WEB_PASSWORD) {
        req.session.logged = true;
        res.redirect('/');
    } else {
        res.send(`<script>alert("Sai mật khẩu");location="/login"</script>`);
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

/* ---------- UI ---------- */

app.get('/', auth, (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

/* ---------- API ---------- */

app.get('/api/servers', auth, (req, res) => {
    res.json([...client.guilds.cache.values()]
        .map(g => ({ id: g.id, name: g.name }))
        .sort((a, b) => a.name.localeCompare(b.name)));
});

app.get('/api/stats', auth, (req, res) => {
    const { guild_id, days = 7 } = req.query;
    const data = loadData();
    const cutoff = Date.now() - days * 86400000;
    const now = Date.now() / 1000;
    const final = {};

    if (data[guild_id]) {
        for (const uid in data[guild_id]) {
            for (const d in data[guild_id][uid]) {
                if (new Date(d).getTime() >= cutoff) {
                    final[uid] ??= 0;
                    final[uid] += data[guild_id][uid][d];
                }
            }
        }
    }

    for (const [k, start] of activeUserSessions.entries()) {
        const [uid, gid] = k.split(':');
        if (gid === guild_id) {
            final[uid] ??= 0;
            final[uid] += Math.floor(now - start);
        }
    }

    const g = client.guilds.cache.get(guild_id);
    const result = [];

    for (const uid in final) {
        const s = final[uid];
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;

        result.push({
            name: g?.members.cache.get(uid)?.displayName || `User ${uid}`,
            seconds: s,
            time_str: `${h ? h + 'h ' : ''}${m ? m + 'm ' : ''}${sec}s`,
            is_online: activeUserSessions.has(`${uid}:${guild_id}`)
        });
    }

    result.sort((a, b) => b.seconds - a.seconds);
    res.json(result);
});

/* ---------- RESET ---------- */

app.post('/api/reset', auth, (req, res) => {
    const { guild_id } = req.body;
    const data = loadData();

    delete data[guild_id];
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));

    for (const k of activeUserSessions.keys()) {
        if (k.endsWith(`:${guild_id}`)) {
            activeUserSessions.set(k, Date.now() / 1000);
        }
    }

    res.json({ ok: true });
});

/* ---------- START ---------- */

app.listen(WEB_PORT);
client.login(USER_TOKEN);
