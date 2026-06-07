](async function () {
  const currentScript = document.currentScript ||
    document.querySelector('script[data-bot-id]');
  const BOT_ID = currentScript ? currentScript.getAttribute("data-bot-id") : null;

  if (!BOT_ID) {
    console.error("Manafith Widget: أضف data-bot-id في الـ script tag");
    return;
  }

  const SUPABASE_URL = "https://ogbvovjzfjbdzutingqi.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nYnZvdmp6ZmpiZHp1dGluZ3FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzk1ODYsImV4cCI6MjA5NTkxNTU4Nn0.Ac5qLMfMO_83aIXdwXw-smy0S1oevV28olhGcUQPXiM";

  const visitorKey = "v_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  let convId = null, visitorId = null, botEnabled = true, botData = null, isTechBot = false;
  let transferTimer = null, transferCountdown = 0, inTransfer = false;
  let displayedMessageIds = new Set(), wsConnected = false;

  async function api(path, method = "GET", body = null) {
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Prefer": method === "POST" ? "return=representation" : "",
      }
    };
    if (body) opts.body = JSON.stringify(body);
    try {
      const r = await fetch(SUPABASE_URL + "/rest/v1" + path, opts);
      if (!r.ok) return null;
      const text = await r.text();
      return text ? JSON.parse(text) : null;
    } catch (_) { return null; }
  }

  async function init() {
    const bots = await api(`/bots?id=eq.${BOT_ID}&select=*`);
    if (!bots || !bots.length) return;
    botData = bots[0];
    botEnabled = botData.active;
    isTechBot = botData.name && botData.name.includes("التقني");

    const nameEl = document.querySelector(".mnf-hname");
    const avEl = document.querySelector(".mnf-av");
    if (nameEl && botData.bot_name) nameEl.textContent = botData.bot_name;
    if (avEl && botData.bot_avatar) avEl.textContent = botData.bot_avatar;
    if (isTechBot) document.getElementById("mnf-img-btn").style.display = "flex";

    const vis = await api(`/visitors?bot_id=eq.${BOT_ID}&visitor_key=eq.${visitorKey}&select=id`);
    if (vis && vis.length) {
      visitorId = vis[0].id;
    } else {
      const newVis = await api("/visitors", "POST", {
        bot_id: BOT_ID, visitor_key: visitorKey,
        name: "زائر " + visitorKey.slice(-4),
        browser: navigator.userAgent.slice(0, 60),
      });
      if (newVis && newVis.length) visitorId = newVis[0].id;
    }

    const convs = await api(`/conversations?visitor_id=eq.${visitorId}&status=eq.open&order=created_at.desc&limit=1&select=id,bot_enabled`);
    if (convs && convs.length) {
      convId = convs[0].id; botEnabled = convs[0].bot_enabled;
    } else {
      const newConv = await api("/conversations", "POST", {
        bot_id: BOT_ID, visitor_id: visitorId, bot_enabled: botEnabled, status: "open",
      });
      if (newConv && newConv.length) convId = newConv[0].id;
    }

    if (convId) {
      const prevMsgs = await api(`/messages?conversation_id=eq.${convId}&order=created_at.asc&select=*`);
      if (prevMsgs && prevMsgs.length) {
        const welcomeEl = document.querySelector("#mnf-msgs .mnf-msg.bot:first-child");
        if (welcomeEl) welcomeEl.remove();
        prevMsgs.forEach(m => {
          if (m.message && m.message.includes("[TRANSFER]")) return;
          displayedMessageIds.add(m.id);
          appendMsg(m.sender_type !== "visitor" ? "bot" : "user", m.message, fmtTime(m.created_at), false);
        });
      }
      subscribeRealtime();
    }
  }

  function subscribeRealtime() {
    try {
      const ws = new WebSocket(`${SUPABASE_URL.replace("https", "wss")}/realtime/v1/websocket?apikey=${SUPABASE_KEY}&vsn=1.0.0`);
      ws.onopen = () => {
        wsConnected = true;
        ws.send(JSON.stringify({ topic: "realtime:public:messages:conversation_id=eq." + convId, event: "phx_join", payload: {}, ref: "1" }));
        const hb = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ topic: "phoenix", event: "heartbeat", payload: {}, ref: "hb" }));
          else clearInterval(hb);
        }, 25000);
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event === "INSERT" && data.payload && data.payload.record) {
            const msg = data.payload.record;
            if (msg.sender_type !== "visitor") {
              setTyping(false);
              if (displayedMessageIds.has(msg.id)) return;
              displayedMessageIds.add(msg.id);
              if (msg.message && msg.message.includes("[TRANSFER]")) { startTransferTimer(); return; }
              if (inTransfer && msg.sender_type === "agent") cancelTransferTimer(false);
              appendMsg("bot", msg.message, fmtTime(msg.created_at));
            }
          }
        } catch (_) {}
      };
      ws.onerror = () => { wsConnected = false; };
      ws.onclose = () => { wsConnected = false; setTimeout(subscribeRealtime, 3000); };
    } catch (_) { wsConnected = false; }
  }

  async function pollForReply(afterTimestamp, attempts = 0) {
    if (attempts > 20) { setTyping(false); return; }
    await new Promise(r => setTimeout(r, 500));
    const msgs = await api(`/messages?conversation_id=eq.${convId}&sender_type=neq.visitor&created_at=gt.${afterTimestamp}&order=created_at.asc&select=*`);
    if (msgs && msgs.length) {
      setTyping(false);
      msgs.forEach(msg => {
        if (displayedMessageIds.has(msg.id)) return;
        displayedMessageIds.add(msg.id);
        if (msg.message && msg.message.includes("[TRANSFER]")) { startTransferTimer(); return; }
        if (inTransfer && msg.sender_type === "agent") cancelTransferTimer(false);
        appendMsg("bot", msg.message, fmtTime(msg.created_at));
      });
    } else { pollForReply(afterTimestamp, attempts + 1); }
  }

  function startTransferTimer() {
    if (inTransfer) return;
    inTransfer = true; transferCountdown = 30;
    renderTransferBar(30);
    transferTimer = setInterval(() => {
      transferCountdown--;
      renderTransferBar(transferCountdown);
      if (transferCountdown <= 0) cancelTransferTimer(true);
    }, 1000);
  }

  function cancelTransferTimer(returnToBot) {
    if (transferTimer) { clearInterval(transferTimer); transferTimer = null; }
    inTransfer = false;
    const bar = document.getElementById("mnf-tbar");
    if (bar) bar.remove();
    if (returnToBot) {
      api(`/conversations?id=eq.${convId}`, "PATCH", { bot_enabled: true, updated_at: new Date().toISOString() });
      botEnabled = true;
      appendMsg("bot", "سيتم الرد عليك من مساعدنا الذكي الآن. 🤖", fmtTime(new Date().toISOString()));
    }
  }

  function renderTransferBar(sec) {
    let bar = document.getElementById("mnf-tbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "mnf-tbar";
      bar.style.cssText = "padding:0 13px 8px;flex-shrink:0;";
      const foot = document.querySelector(".mnf-foot");
      foot.parentNode.insertBefore(bar, foot);
    }
    const pct = Math.round((sec / 30) * 100);
    const color = sec > 20 ? "#4ade80" : sec > 10 ? "#fbbf24" : "#f87171";
    bar.innerHTML = `
      <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:12px;padding:10px 14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="font-size:14px;">👤</span>
            <span style="font-size:12px;color:#cbd5e1;">جاري تحويلك لموظف بشري</span>
          </div>
          <span style="font-size:15px;font-weight:700;color:${color};min-width:28px;text-align:center;">${sec}s</span>
        </div>
        <div style="width:100%;height:5px;background:rgba(255,255,255,0.07);border-radius:99px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width 0.85s linear,background 0.5s;"></div>
        </div>
      </div>`;
  }

  async function sendImage(file) {
    if (!file || !convId) return;
    setTyping(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const base64 = e.target.result.split(",")[1];
        const previewUrl = e.target.result;
        appendMsg("user", "[IMG]" + previewUrl, fmtTime(new Date().toISOString()));
        await api("/messages", "POST", {
          conversation_id: convId, sender_type: "visitor",
          sender_id: visitorId, message: "أرسل صورة عطل تقني", source: "widget",
        });
        await api(`/conversations?id=eq.${convId}`, "PATCH", { updated_at: new Date().toISOString() });
        const beforeCall = new Date().toISOString();
        await fetch(`${SUPABASE_URL}/functions/v1/tech-support`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({ message: "حلل هذا الخطأ وقدم الحل", image_base64: base64, conversation_id: convId, bot_id: BOT_ID }),
        });
        setTimeout(() => pollForReply(beforeCall, 0), 2000);
      } catch (_) {
        setTyping(false);
        appendMsg("bot", "عذراً، حدث خطأ في تحليل الصورة.", fmtTime(new Date().toISOString()));
      }
    };
    reader.readAsDataURL(file);
  }

  async function sendMsg(text) {
    if (!convId || !text.trim()) return;
    const sendTime = new Date().toISOString();
    appendMsg("user", text, fmtTime(sendTime));
    const sentMsg = await api("/messages", "POST", {
      conversation_id: convId, sender_type: "visitor", sender_id: visitorId, message: text, source: "widget",
    });
    if (sentMsg && sentMsg.length && sentMsg[0].id) displayedMessageIds.add(sentMsg[0].id);
    await api(`/conversations?id=eq.${convId}`, "PATCH", { updated_at: new Date().toISOString() });
    if (inTransfer) return;
    const convData = await api(`/conversations?id=eq.${convId}&select=bot_enabled`);
    const isBotOn = convData && convData.length ? convData[0].bot_enabled : botEnabled;
    if (isBotOn) {
      setTyping(true);
      const beforeCall = new Date().toISOString();
      const endpoint = isTechBot ? "tech-support" : "CHAT_AI";
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SUPABASE_KEY },
          body: JSON.stringify({ message: text, conversation_id: convId, bot_id: BOT_ID }),
        });
        if (!wsConnected) pollForReply(beforeCall);
        else setTimeout(() => pollForReply(beforeCall, 0), 3000);
      } catch (_) {
        setTyping(false);
        appendMsg("bot", "عذراً، حدث خطأ في الاتصال.", fmtTime(new Date().toISOString()));
      }
    }
  }

  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap');
    #mnf-w *{box-sizing:border-box;font-family:'IBM Plex Sans Arabic',sans-serif;direction:rtl;}
    #mnf-fab{position:fixed;bottom:28px;left:28px;z-index:99999;width:58px;height:58px;border-radius:50%;background:linear-gradient(135deg,#1a1a2e,#0f3460);border:2px solid rgba(255,255,255,0.15);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 28px rgba(15,52,96,0.55);transition:all .3s cubic-bezier(.34,1.56,.64,1);animation:mnf-pulse 3s infinite;}
    #mnf-fab:hover{transform:scale(1.1);}
    #mnf-fab .ic-chat{display:block;}#mnf-fab .ic-close{display:none;}
    #mnf-fab.open .ic-chat{display:none;}#mnf-fab.open .ic-close{display:block;}
    @keyframes mnf-pulse{0%,100%{box-shadow:0 8px 28px rgba(15,52,96,.55),0 0 0 0 rgba(15,52,96,.35);}50%{box-shadow:0 8px 28px rgba(15,52,96,.55),0 0 0 10px rgba(15,52,96,0);}}
    #mnf-panel{position:fixed;bottom:98px;left:28px;z-index:99998;width:360px;height:540px;background:#0d0d1a;border:1px solid rgba(255,255,255,0.08);border-radius:20px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 70px rgba(0,0,0,.65);transform:scale(.88) translateY(18px);opacity:0;pointer-events:none;transition:all .32s cubic-bezier(.34,1.56,.64,1);}
    #mnf-panel.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all;}
    .mnf-head{padding:16px 18px;display:flex;align-items:center;gap:11px;flex-shrink:0;background:linear-gradient(135deg,#1a1a2e,#16213e);border-bottom:1px solid rgba(255,255,255,0.06);}
    .mnf-av{width:38px;height:38px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,#0f3460,#533483);display:flex;align-items:center;justify-content:center;font-size:17px;border:2px solid rgba(255,255,255,0.1);}
    .mnf-hname{color:#fff;font-weight:600;font-size:14px;}
    .mnf-hstatus{color:#4ade80;font-size:11px;display:flex;align-items:center;gap:4px;margin-top:2px;}
    .mnf-hstatus::before{content:'';width:6px;height:6px;border-radius:50%;background:#4ade80;display:inline-block;animation:mnf-blink 2s infinite;}
    @keyframes mnf-blink{0%,100%{opacity:1}50%{opacity:.3}}
    .mnf-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.08) transparent;}
    .mnf-msgs::-webkit-scrollbar{width:3px;}.mnf-msgs::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px;}
    .mnf-msg{display:flex;flex-direction:column;max-width:82%;animation:mnf-in .25s ease;}
    @keyframes mnf-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .mnf-msg.user{align-self:flex-start;}.mnf-msg.bot{align-self:flex-end;}
    .mnf-bubble{padding:9px 13px;border-radius:15px;font-size:13.5px;line-height:1.6;word-break:break-word;}
    .mnf-msg.user .mnf-bubble{background:linear-gradient(135deg,#0f3460,#533483);color:#fff;border-bottom-right-radius:3px;}
    .mnf-msg.bot .mnf-bubble{background:rgba(255,255,255,.07);color:#dde5f0;border:1px solid rgba(255,255,255,.07);border-bottom-left-radius:3px;}
    .mnf-time{font-size:10px;color:rgba(255,255,255,.25);margin-top:3px;padding:0 3px;}
    .mnf-msg.user .mnf-time{text-align:right;}
    #mnf-typing{display:none;align-self:flex-end;}#mnf-typing.show{display:flex;}
    .mnf-dots{display:flex;gap:4px;align-items:center;padding:2px 0;}
    .mnf-dots span{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.35);animation:mnf-dot 1.3s infinite;}
    .mnf-dots span:nth-child(2){animation-delay:.2s;}.mnf-dots span:nth-child(3){animation-delay:.4s;}
    @keyframes mnf-dot{0%,80%,100%{transform:scale(.65);opacity:.35}40%{transform:scale(1);opacity:1}}
    .mnf-foot{padding:11px 13px;border-top:1px solid rgba(255,255,255,.06);flex-shrink:0;}
    .mnf-row{display:flex;gap:7px;align-items:flex-end;}
    #mnf-inp{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:11px;padding:9px 13px;color:#fff;font-size:13.5px;resize:none;outline:none;max-height:90px;min-height:40px;transition:border .2s;font-family:'IBM Plex Sans Arabic',sans-serif;}
    #mnf-inp::placeholder{color:rgba(255,255,255,.25);}#mnf-inp:focus{border-color:rgba(83,52,131,.55);}
    #mnf-img-btn{display:none;width:40px;height:40px;border-radius:11px;flex-shrink:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);cursor:pointer;align-items:center;justify-content:center;color:rgba(255,255,255,.5);transition:all .2s;}
    #mnf-img-btn:hover{background:rgba(83,52,131,.3);color:#fff;border-color:rgba(83,52,131,.5);}
    #mnf-img-btn svg{width:17px;height:17px;}
    #mnf-sbtn{width:40px;height:40px;border-radius:11px;flex-shrink:0;background:linear-gradient(135deg,#0f3460,#533483);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;transition:all .2s;}
    #mnf-sbtn:hover{filter:brightness(1.2);}#mnf-sbtn svg{width:17px;height:17px;}
    .mnf-powered{text-align:center;font-size:10px;color:rgba(255,255,255,.15);margin-top:7px;}
    @media(max-width:420px){#mnf-panel{width:calc(100vw - 20px);left:10px;}}
  `;
  document.head.appendChild(style);

  const wrap = document.createElement("div");
  wrap.id = "mnf-w";
  wrap.innerHTML = `
    <div id="mnf-panel">
      <div class="mnf-head">
        <div class="mnf-av">🤖</div>
        <div>
          <div class="mnf-hname">جاري التحميل...</div>
          <div class="mnf-hstatus">متصل الآن</div>
        </div>
      </div>
      <div class="mnf-msgs" id="mnf-msgs">
        <div class="mnf-msg bot">
          <div class="mnf-bubble">مرحباً! كيف أقدر أساعدك اليوم؟ 👋</div>
          <div class="mnf-time">الآن</div>
        </div>
        <div id="mnf-typing" class="mnf-msg bot">
          <div class="mnf-bubble"><div class="mnf-dots"><span></span><span></span><span></span></div></div>
        </div>
      </div>
      <div class="mnf-foot">
        <div class="mnf-row">
          <textarea id="mnf-inp" placeholder="اكتب رسالتك..." rows="1"></textarea>
          <input type="file" id="mnf-img-input" accept="image/*" style="display:none"/>
          <button id="mnf-img-btn" title="أرسل صورة العطل">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </button>
          <button id="mnf-sbtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/>
              <polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
        <div class="mnf-powered">Powered by Manafith AI</div>
      </div>
    </div>
    <button id="mnf-fab">
      <svg class="ic-chat" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <svg class="ic-close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  `;
  document.body.appendChild(wrap);

  const fab = document.getElementById("mnf-fab");
  const panel = document.getElementById("mnf-panel");
  const msgsEl = document.getElementById("mnf-msgs");
  const inp = document.getElementById("mnf-inp");
  const sbtn = document.getElementById("mnf-sbtn");
  const typing = document.getElementById("mnf-typing");
  const imgBtn = document.getElementById("mnf-img-btn");
  const imgInput = document.getElementById("mnf-img-input");

  fab.addEventListener("click", () => {
    panel.classList.toggle("open");
    fab.classList.toggle("open");
    if (panel.classList.contains("open")) { scrollEnd(); inp.focus(); }
  });
  sbtn.addEventListener("click", () => {
    const t = inp.value.trim();
    if (t) { inp.value = ""; inp.style.height = "auto"; sendMsg(t); }
  });
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sbtn.click(); }
  });
  inp.addEventListener("input", () => {
    inp.style.height = "auto";
    inp.style.height = Math.min(inp.scrollHeight, 90) + "px";
  });
  imgBtn.addEventListener("click", () => imgInput.click());
  imgInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) sendImage(file);
    imgInput.value = "";
  });

  function appendMsg(role, text, time, anim = true) {
    const div = document.createElement("div");
    div.className = "mnf-msg " + role;
    if (!anim) div.style.animation = "none";
    if (text && text.startsWith("[IMG]")) {
      const imgUrl = text.replace("[IMG]", "");
      div.innerHTML = `
        <div class="mnf-bubble" style="padding:6px;">
          <img src="${imgUrl}" style="max-width:100%;max-height:220px;border-radius:10px;display:block;cursor:pointer;"
            onclick="window.open('${imgUrl}','_blank')" loading="lazy" onerror="this.style.display='none'"/>
        </div>
        <div class="mnf-time">${time}</div>`;
    } else {
      div.innerHTML = `<div class="mnf-bubble">${esc(text)}</div><div class="mnf-time">${time}</div>`;
    }
    msgsEl.insertBefore(div, typing);
    scrollEnd();
  }

  function setTyping(on) { typing.classList.toggle("show", on); scrollEnd(); }
  function scrollEnd() { setTimeout(() => { msgsEl.scrollTop = msgsEl.scrollHeight; }, 50); }
  function fmtTime(iso) { return new Date(iso).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" }); }
  function esc(t) { return String(t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>"); }

  await init();
})();
