import discord
from discord.ext import commands, tasks
import json
import time
from datetime import datetime, timedelta
import os
import threading
from flask import Flask, jsonify, render_template_string, request, session, redirect, url_for
import logging
from functools import wraps
from dotenv import load_dotenv  # <--- Thư viện mới

# =====================================================
#                 KHU VỰC CẤU HÌNH (TỰ ĐỘNG LẤY TỪ .ENV)
# =====================================================

# Load nội dung từ file .env
load_dotenv()

USER_TOKEN = os.getenv("BOT_TOKEN")
WEB_PASSWORD = os.getenv("WEB_PASSWORD", "admin") # Mặc định là admin nếu không tìm thấy
WEB_PORT = int(os.getenv("WEB_PORT", 5000))       # Mặc định port 5000
DATA_FILE = "voice_data_final.json"

# Kiểm tra xem đã điền Token chưa
if not USER_TOKEN:
    print("❌ LỖI: Không tìm thấy Token! Vui lòng tạo file .env và điền BOT_TOKEN.")
    exit()

# =====================================================
#                 PHẦN 1: LOGIC BOT (BACKEND)
# =====================================================

log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

bot = commands.Bot(command_prefix=">", self_bot=True)
active_user_sessions = {} 

def load_data():
    if not os.path.exists(DATA_FILE): return {}
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f: return json.load(f)
    except: return {}

def save_voice_time(guild_id, user_id, seconds):
    if seconds <= 0 or guild_id is None: return
    data = load_data()
    gid, uid = str(guild_id), str(user_id)
    today = datetime.now().strftime('%Y-%m-%d')

    if gid not in data: data[gid] = {}
    if uid not in data[gid]: data[gid][uid] = {}
    if today not in data[gid][uid]: data[gid][uid][today] = 0
    
    data[gid][uid][today] += seconds
    with open(DATA_FILE, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)

@tasks.loop(minutes=1)
async def auto_save_task():
    if not active_user_sessions: return
    now = time.time()
    for (uid, gid), start in list(active_user_sessions.items()):
        dur = int(now - start)
        if dur > 0:
            save_voice_time(gid, uid, dur)
            active_user_sessions[(uid, gid)] = now 

async def scan_existing_voice_users():
    print("🔄 Đang quét người dùng trong voice...")
    count = 0
    now = time.time()
    for guild in bot.guilds:
        for vc in guild.voice_channels:
            for member in vc.members:
                key = (member.id, guild.id)
                if key not in active_user_sessions:
                    active_user_sessions[key] = now
                    count += 1
    print(f"✅ Đã thêm {count} người đang ngồi voice từ trước.")

@bot.event
async def on_ready():
    print(f"✅ Bot đã online: {bot.user}")
    print(f"🔒 Web UI: http://localhost:{WEB_PORT}")
    print(f"🔑 Chế độ bảo mật: Đã ẩn Token & Password vào file .env")
    await scan_existing_voice_users()
    auto_save_task.start()

@bot.event
async def on_voice_state_update(member, before, after):
    uid, gid = member.id, member.guild.id
    now = time.time()
    if before.channel is None and after.channel is not None:
        active_user_sessions[(uid, gid)] = now
    elif before.channel is not None and after.channel is None:
        key = (uid, gid)
        if key in active_user_sessions:
            start = active_user_sessions.pop(key)
            save_voice_time(gid, uid, int(now - start))

# =====================================================
#                 PHẦN 2: WEB SERVER (FLASK)
# =====================================================

app = Flask(__name__)
app.secret_key = os.urandom(24) # Tạo secret key ngẫu nhiên mỗi lần chạy cho bảo mật

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function

# --- HTML TEMPLATES ---
LOGIN_HTML = """
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <title>Login System</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #121212; color: #fff; height: 100vh; display: flex; align-items: center; justify-content: center; }
        .box { background: #1e1e1e; padding: 40px; border-radius: 10px; width: 350px; box-shadow: 0 0 15px rgba(0,0,0,0.5); }
    </style>
</head>
<body>
    <div class="box">
        <h3 class="text-center mb-4">🔐 Đăng Nhập</h3>
        {% if error %}<div class="alert alert-danger text-center">{{ error }}</div>{% endif %}
        <form method="POST">
            <input type="password" name="password" class="form-control mb-3" placeholder="Nhập mật khẩu..." required>
            <button class="btn btn-primary w-100">Truy cập Dashboard</button>
        </form>
    </div>
</body>
</html>
"""

DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voice Tracker Pro</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #0f0f0f; color: #e0e0e0; font-family: 'Segoe UI', sans-serif; overflow: hidden; }
        .sidebar { height: 100vh; overflow-y: auto; background: #161616; border-right: 1px solid #333; }
        .server-item { cursor: pointer; padding: 10px; border-radius: 5px; margin-bottom: 5px; display: flex; align-items: center; transition: 0.2s; }
        .server-item:hover { background: #2a2a2a; }
        .server-item.active { background: #5865F2; color: white; }
        .server-icon { width: 30px; height: 30px; background: #444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 10px; font-weight: bold; font-size: 12px; }
        .main { height: 100vh; overflow-y: auto; padding: 30px; }
        .live-badge { background: #ff0000; color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: bold; animation: pulse 1.5s infinite; }
        .time-text { font-family: monospace; font-size: 1.1em; color: #00e676; }
        @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }
    </style>
</head>
<body>
    <div class="container-fluid">
        <div class="row">
            <div class="col-md-3 col-lg-2 sidebar p-3">
                <input type="text" id="search" class="form-control form-control-sm mb-3" placeholder="🔍 Tìm kiếm..." style="background:#222; border:none; color:white;">
                <div id="server-list"></div>
                <div class="mt-3 text-center"><a href="/logout" class="text-muted small text-decoration-none">Đăng xuất</a></div>
            </div>
            <div class="col-md-9 col-lg-10 main">
                <div class="d-flex justify-content-between align-items-center mb-4">
                    <h3 id="server-title">🔴 Dashboard</h3>
                    <div class="d-flex align-items-center gap-2">
                        <small>Lọc ngày:</small>
                        <input type="number" id="days" value="7" class="form-control form-control-sm text-center" style="width: 60px; background:#222; color:white; border:none;">
                    </div>
                </div>
                <div class="card bg-dark border-secondary">
                    <table class="table table-dark table-hover mb-0">
                        <thead>
                            <tr><th width="50">#</th><th>Thành viên</th><th class="text-end">Trạng thái</th><th class="text-end">Thời gian</th></tr>
                        </thead>
                        <tbody id="table-body">
                            <tr><td colspan="4" class="text-center text-muted py-5">Chọn server bên trái để xem dữ liệu...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
    <script>
        let currentGuildId = null;
        let allServers = [];
        let intervalId = null;

        async function loadServers() {
            const res = await fetch('/api/servers');
            allServers = await res.json();
            renderServers(allServers);
        }

        function renderServers(list) {
            const container = document.getElementById('server-list');
            container.innerHTML = '';
            list.forEach(sv => {
                const div = document.createElement('div');
                div.className = 'server-item';
                div.innerHTML = `<div class="server-icon">${sv.name.substring(0,2).toUpperCase()}</div> ${sv.name}`;
                div.onclick = () => selectServer(sv.id, sv.name, div);
                container.appendChild(div);
            });
        }

        function selectServer(gid, name, el) {
            currentGuildId = gid;
            document.getElementById('server-title').innerText = "📊 " + name;
            document.querySelectorAll('.server-item').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            if (intervalId) clearInterval(intervalId);
            fetchStats();
            intervalId = setInterval(fetchStats, 1000);
        }

        async function fetchStats() {
            if (!currentGuildId) return;
            const days = document.getElementById('days').value;
            try {
                const res = await fetch(`/api/stats?guild_id=${currentGuildId}&days=${days}`);
                const data = await res.json();
                renderTable(data);
            } catch (e) {}
        }

        function renderTable(data) {
            const tbody = document.getElementById('table-body');
            if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted">Chưa có dữ liệu.</td></tr>'; return; }
            let html = '';
            data.forEach((u, i) => {
                let color = i===0 ? '#FFD700' : (i===1 ? '#C0C0C0' : (i===2 ? '#CD7F32' : 'white'));
                let status = u.is_online ? '<span class="live-badge">ĐANG NÓI</span>' : '<span class="text-muted small">Offline</span>';
                let rowClass = u.is_online ? 'table-active' : '';
                html += `<tr class="${rowClass}"><td class="text-center fw-bold" style="color:${color}">${i+1}</td><td>${u.name}</td><td class="text-end">${status}</td><td class="text-end"><span class="time-text">${u.time_str}</span></td></tr>`;
            });
            tbody.innerHTML = html;
        }

        document.getElementById('search').addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            renderServers(allServers.filter(s => s.name.toLowerCase().includes(term)));
        });
        loadServers();
    </script>
</body>
</html>
"""

# --- API ROUTES ---
@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('password') == WEB_PASSWORD:
            session['logged_in'] = True
            return redirect(url_for('index'))
        else:
            return render_template_string(LOGIN_HTML, error="Sai mật khẩu!")
    return render_template_string(LOGIN_HTML)

@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))

@app.route('/')
@login_required
def index(): return render_template_string(DASHBOARD_HTML)

@app.route('/api/servers')
@login_required
def get_servers():
    sv = [{'id': str(g.id), 'name': g.name} for g in bot.guilds]
    sv.sort(key=lambda x: x['name'])
    return jsonify(sv)

@app.route('/api/stats')
@login_required
def get_stats():
    guild_id = request.args.get('guild_id')
    days = int(request.args.get('days', 7))
    data = load_data()
    final_stats = {} 
    cutoff = datetime.now() - timedelta(days=days)
    current_time = time.time()

    if guild_id in data:
        for uid, dates in data[guild_id].items():
            total = 0
            for d_str, secs in dates.items():
                try:
                    if datetime.strptime(d_str, '%Y-%m-%d') >= cutoff: total += secs
                except: continue
            if total > 0: final_stats[uid] = total

    for (uid, gid), start_time in active_user_sessions.items():
        if str(gid) == guild_id: 
            str_uid = str(uid)
            elapsed = int(current_time - start_time)
            if str_uid in final_stats: final_stats[str_uid] += elapsed
            else: final_stats[str_uid] = elapsed

    result = []
    guild_obj = bot.get_guild(int(guild_id)) if guild_id else None
    for uid_str, seconds in final_stats.items():
        name, is_online = f"User {uid_str}", False
        if guild_obj:
            mem = guild_obj.get_member(int(uid_str))
            if mem:
                name = mem.display_name
                if (int(uid_str), int(guild_id)) in active_user_sessions: is_online = True
        
        m, s = divmod(seconds, 60)
        h, m = divmod(m, 60)
        time_parts = []
        if h > 0: time_parts.append(f"{h}h")
        if m > 0: time_parts.append(f"{m}m")
        time_parts.append(f"{s}s")
        result.append({'name': name, 'time_str': " ".join(time_parts), 'seconds': seconds, 'is_online': is_online})

    result.sort(key=lambda x: x['seconds'], reverse=True)
    return jsonify(result)

def run_flask():
    app.run(host='0.0.0.0', port=WEB_PORT, debug=False, use_reloader=False)

if __name__ == '__main__':
    threading.Thread(target=run_flask, daemon=True).start()
    bot.run(USER_TOKEN)