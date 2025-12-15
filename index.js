require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const express = require('express');
const session = require('express-session');
const fs = require('fs');

// --- CONFIG ---
const CONFIG = {
    TOKEN: process.env.BOT_TOKEN,
    PASS: process.env.WEB_PASSWORD || "admin",
    PORT: process.env.WEB_PORT || 5000,
    FILE: "voice_data_final.json"
};

if (!CONFIG.TOKEN) { console.error("❌ Thiếu BOT_TOKEN trong .env"); process.exit(1); }

// --- DATA HANDLER ---
const active = new Map();
const loadDB = () => fs.existsSync(CONFIG.FILE) ? JSON.parse(fs.readFileSync(CONFIG.FILE)) : {};
const saveDB = (gid, uid, sec) => {
    if (sec <= 0 || !gid) return;
    const db = loadDB(), date = new Date().toISOString().split('T')[0];
    if (!db[gid]) db[gid] = {}; if (!db[gid][uid]) db[gid][uid] = {};
    db[gid][uid][date] = (db[gid][uid][date] || 0) + sec;
    fs.writeFileSync(CONFIG.FILE, JSON.stringify(db, null, 2));
};

// --- BOT LOGIC ---
const client = new Client({ checkUpdate: false });

client.on('ready', () => {
    console.log(`✅ Bot: ${client.user.tag} | 🌍 Web: http://localhost:${CONFIG.PORT}`);
    client.guilds.cache.forEach(g => g.voiceStates?.cache.forEach(vs => {
        if (vs.channelId) active.set(`${vs.userId}-${g.id}`, Date.now());
    }));
});

client.on('voiceStateUpdate', (oldS, newS) => {
    const key = `${newS.userId}-${newS.guild.id}`, now = Date.now();
    if (!oldS.channelId && newS.channelId) active.set(key, now); // Join
    else if (oldS.channelId && !newS.channelId && active.has(key)) { // Leave
        saveDB(newS.guild.id, newS.userId, Math.floor((now - active.get(key))/1000));
        active.delete(key);
    }
});

setInterval(() => { // Auto Save mỗi phút
    const now = Date.now();
    active.forEach((start, key) => {
        const [uid, gid] = key.split('-');
        if (now - start > 1000) { saveDB(gid, uid, Math.floor((now - start)/1000)); active.set(key, now); }
    });
}, 60000);

// --- WEB SERVER ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'secret', resave: false, saveUninitialized: true }));
const auth = (req, res, next) => req.session.log ? next() : res.redirect('/login');

// HTML Minified
const HTML_LOGIN = (err='') => `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Login</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3/dist/css/bootstrap.min.css" rel="stylesheet"><style>body{background:#121212;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center}.box{background:#1e1e1e;padding:40px;border-radius:10px;width:350px}</style></head><body><div class="box"><h3 class="text-center mb-4">🔐 Đăng Nhập</h3>${err?`<div class="alert alert-danger text-center">${err}</div>`:''}<form method="POST"><input type="password" name="p" class="form-control mb-3" placeholder="Mật khẩu..." required><button class="btn btn-primary w-100">Login</button></form></div></body></html>`;
const HTML_DASH = `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>Voice Tracker</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3/dist/css/bootstrap.min.css" rel="stylesheet"><style>body{background:#0f0f0f;color:#e0e0e0;overflow:hidden}.sidebar{height:100vh;background:#161616;border-right:1px solid #333}.sv{cursor:pointer;padding:10px;margin:5px 0;border-radius:5px}.sv:hover{background:#2a2a2a}.sv.active{background:#5865F2;color:#fff}.main{height:100vh;overflow-y:auto;padding:30px}.live{background:red;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;animation:p 1.5s infinite}@keyframes p{0%{opacity:1}50%{opacity:.5}100%{opacity:1}}</style></head><body><div class="container-fluid"><div class="row"><div class="col-2 sidebar p-3"><input id="s" class="form-control form-control-sm mb-3" placeholder="🔍 Tìm..." style="background:#222;border:0;color:#fff"><div id="list"></div><div class="mt-3 text-center"><a href="/logout" class="text-muted small">Logout</a></div></div><div class="col-10 main"><div class="d-flex justify-content-between mb-4"><h3 id="tt">🔴 Dashboard</h3><div>Ngày: <input type="number" id="d" value="7" style="width:50px;background:#222;color:#fff;border:0;text-align:center"></div></div><table class="table table-dark"><thead><tr><th>#</th><th>User</th><th class="text-end">Status</th><th class="text-end">Time</th></tr></thead><tbody id="tb"></tbody></table></div></div></div><script>let cid=null;async function L(){const r=await fetch('/api/sv');const d=await r.json();const l=document.getElementById('list');l.innerHTML='';d.forEach(s=>{const e=document.createElement('div');e.className='sv';e.innerText=s.n;e.onclick=()=>{cid=s.id;document.getElementById('tt').innerText=s.n;document.querySelectorAll('.sv').forEach(x=>x.classList.remove('active'));e.classList.add('active');F()};l.appendChild(e)})}async function F(){if(!cid)return;const dy=document.getElementById('d').value;const r=await fetch('/api/st?id='+cid+'&d='+dy);const d=await r.json();const b=document.getElementById('tb');b.innerHTML='';d.forEach((u,i)=>{b.innerHTML+='<tr><td>'+(i+1)+'</td><td>'+u.n+'</td><td class="text-end">'+(u.on?'<span class="live">LIVE</span>':'Off')+'</td><td class="text-end">'+u.t+'</td></tr>'})}document.getElementById('s').oninput=e=>{const v=e.target.value.toLowerCase();document.querySelectorAll('.sv').forEach(x=>{x.style.display=x.innerText.toLowerCase().includes(v)?'block':'none'})};setInterval(F,2000);L();</script></body></html>`;

// --- ROUTES ---
app.get('/login', (req, res) => res.send(HTML_LOGIN()));
app.post('/login', (req, res) => {
    if (req.body.p === CONFIG.PASS) { req.session.log = true; res.redirect('/'); }
    else res.send(HTML_LOGIN("Sai mật khẩu!"));
});
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.get('/', auth, (req, res) => res.send(HTML_DASH));

app.get('/api/sv', auth, (req, res) => {
    res.json(client.guilds.cache.map(g => ({ id: g.id, n: g.name })).sort((a,b)=>a.n.localeCompare(b.n)));
});

app.get('/api/st', auth, (req, res) => {
    const { id, d } = req.query;
    const db = loadDB(), final = {};
    const cut = new Date(); cut.setDate(cut.getDate() - (d || 7));
    
    if (db[id]) Object.entries(db[id]).forEach(([u, dates]) => {
        Object.entries(dates).forEach(([dt, s]) => {
            if (new Date(dt) >= cut || dt === new Date().toISOString().split('T')[0]) final[u] = (final[u]||0)+s;
        });
    });
    
    const now = Date.now();
    active.forEach((st, k) => { if(k.endsWith(id)) final[k.split('-')[0]] = (final[k.split('-')[0]]||0) + Math.floor((now-st)/1000); });

    res.json(Object.entries(final).map(([u, s]) => {
        let n = `User ${u}`, mem = client.guilds.cache.get(id)?.members.cache.get(u) || client.users.cache.get(u);
        if (mem) n = mem.displayName || mem.username;
        const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sc=s%60;
        return { n, on: active.has(`${u}-${id}`), t: `${h>0?h+'h ':''}${m>0?m+'m ':''}${sc}s`, s };
    }).sort((a,b)=>b.s-a.s));
});

app.listen(CONFIG.PORT);
client.login(CONFIG.TOKEN);
