// Answerly client: plain ES modules, no framework. Routes: / (ask), /login, /history,
// /t/:id (a thread), /s/:id (a shared, read-only thread).
const main = document.querySelector("main");
const nav = document.querySelector("#nav");
const menu = document.querySelector(".menu");
const toast = document.querySelector(".toast");
let FAULTS = new Set();
let me = null;
let active = null;           // { controller, stopped } for the stream in flight

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};

function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 1800);
}

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (res.status === 401 && !path.startsWith("/api/login") && !path.startsWith("/api/share")) {
    throw Object.assign(new Error("signed out"), { status: 401 });
  }
  return res;
}

// ---------------- rendering an answer ----------------

// Turn "text [1] more [2]" into text nodes and citation links. Never uses innerHTML for
// model output: the answer is untrusted text.
function renderAnswer(el, text, sources) {
  el.replaceChildren();
  for (const part of text.split(/(\[\d+\])/)) {
    const m = /^\[(\d+)\]$/.exec(part);
    const n = m && (FAULTS.has("citation_offbyone") ? (Number(m[1]) % sources.length) + 1 : Number(m[1]));
    const src = m && sources.find((s) => s.n === n);
    el.append(src ? h("a", { class: "cite", href: src.url, target: "_blank", rel: "noopener",
                             "aria-label": `Source ${m[1]}: ${src.title}`, "data-source": m[1] }, `[${m[1]}]`)
                  : document.createTextNode(part));
  }
}

function sourceList(sources) {
  return h("ol", { class: "sources", "aria-label": "Sources" },
    sources.map((s) => h("li", { id: `source-${s.n}` }, h("a", { href: s.url, target: "_blank", rel: "noopener" }, s.title))));
}

function turnView(question, { answer = "", sources = [], streaming = false } = {}) {
  const q = h("div", { class: "q" });
  if (FAULTS.has("xss_unescaped")) q.innerHTML = question; else q.textContent = question;
  const a = h("div", { class: `answer${streaming ? " streaming" : ""}`, "data-testid": "answer",
                       "aria-live": "polite", "aria-busy": String(streaming) });
  renderAnswer(a, answer, sources);
  const wrap = h("section", { class: "turn", "data-testid": "turn" }, q, a);
  if (sources.length) wrap.append(sourceList(sources));
  return wrap;
}

// ---------------- streaming ----------------

async function stream(question, { threadId, turns, retry = false } = {}) {
  const view = turnView(question, { streaming: true });
  const answerEl = view.querySelector(".answer");
  const actions = h("div", { class: "actions" });
  const status = h("span", { class: "status", "data-testid": "status" }, "Answering…");
  const stop = h("button", { class: "btn ghost", type: "button", "data-action": "stop" }, "Stop");
  actions.append(stop, status);
  view.append(actions);
  turns.append(view);

  const controller = new AbortController();
  active = { controller, stopped: false };
  stop.addEventListener("click", () => {
    active.stopped = true;
    if (!FAULTS.has("stop_ignored")) controller.abort();
    status.textContent = "Stopped";
  });

  let text = "", sources = [], tid = threadId, first = true;
  performance.mark("ask-submitted");
  try {
    const res = await api("/api/ask", { method: "POST", signal: controller.signal,
      body: JSON.stringify({ question, thread_id: threadId, retry }) });
    if (!res.ok) throw Object.assign(new Error((await res.json()).error || "Request failed"), { status: res.status });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const name = /^event: (.+)$/m.exec(block)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(block)?.[1] || "{}");
        if (name === "meta") { sources = data.sources; tid = data.thread_id; }
        if (name === "token") {
          if (first) { performance.mark("first-token"); performance.measure("ui-ttft", "ask-submitted", "first-token"); first = false; }
          text += data.text;
          renderAnswer(answerEl, text, sources);
        }
        if (name === "error") throw Object.assign(new Error(data.message), { midstream: true });
        if (name === "done") status.textContent = active.stopped ? "Stopped" : "Done";
      }
    }
    view.append(sourceList(sources));
    if (FAULTS.has("console_error")) sources.at(5).title.trim();
  } catch (err) {
    if (err.name === "AbortError") { status.textContent = "Stopped"; }
    else if (err.status === 401) { return signedOut(question); }
    else {
      status.textContent = "";
      const retryBtn = h("button", { class: "btn", type: "button", "data-action": "retry" }, "Try again");
      const box = h("div", { class: "error", role: "alert" }, err.message || "Something went wrong.", " ", retryBtn);
      view.append(box);
      retryBtn.addEventListener("click", () => {
        if (!FAULTS.has("retry_duplicates")) view.remove(); else box.remove();
        stream(question, { threadId: tid, turns, retry: true });
      });
      return;
    }
  } finally {
    answerEl.classList.remove("streaming");
    answerEl.setAttribute("aria-busy", "false");
    stop.remove();
  }
  const regen = h("button", { class: "btn ghost", type: "button", "data-action": "regenerate" }, "Regenerate");
  const share = h("button", { class: "btn ghost", type: "button", "data-action": "share" }, "Share");
  regen.addEventListener("click", () => { view.remove(); stream(question, { threadId: tid, turns }); });
  share.addEventListener("click", async () => {
    const r = await api(`/api/threads/${tid}/share`, { method: "POST" });
    const { url } = await r.json();
    view.dataset.shareUrl = url;
    notify("Share link ready");
    actions.append(h("a", { href: url, "data-testid": "share-link" }, location.origin + url));
  });
  actions.prepend(regen, share);
  if (tid && location.pathname !== `/t/${tid}`) history.replaceState({}, "", `/t/${tid}`);
  main.dataset.threadId = tid;
}

function signedOut(question) {
  if (!FAULTS.has("session_expiry_loses_question")) sessionStorage.setItem("draft", question);
  go(`/login?next=${encodeURIComponent(location.pathname)}`);
}

// ---------------- views ----------------

function askView(thread) {
  const turns = h("div", { "data-testid": "turns" });
  if (thread) for (let i = 0; i < thread.messages.length; i += 2) {
    const a = thread.messages[i + 1];
    turns.append(turnView(thread.messages[i].content, { answer: a?.content || "", sources: a?.sources || [] }));
  }
  const input = h("textarea", { id: "q", name: "q", rows: 2, maxlength: 2000, placeholder: "Ask anything",
                                "aria-label": "Ask anything" });
  input.value = sessionStorage.getItem("draft") || "";
  sessionStorage.removeItem("draft");
  const submit = h("button", { class: "btn", type: "submit" }, "Ask");
  let sending = false;
  const form = h("form", { class: "ask", role: "search" }, input, submit);
  const send = (e) => {
    e?.preventDefault();
    const question = input.value.trim();
    if (!question || (sending && !FAULTS.has("double_submit"))) return;
    sending = true; submit.disabled = !FAULTS.has("double_submit");
    if (!FAULTS.has("double_submit")) input.value = "";       // the bug: input cleared only after the answer
    stream(question, { threadId: main.dataset.threadId || thread?.id, turns })
      .finally(() => { sending = false; submit.disabled = false; if (FAULTS.has("double_submit")) input.value = ""; input.focus(); });
  };
  form.addEventListener("submit", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });
  main.dataset.threadId = thread?.id || "";
  const header = h("h1", {}, thread ? thread.title : "What do you want to know?");
  const extra = FAULTS.has("mobile_overflow") ? [h("div", { class: "wide-banner", "data-testid": "promo" }, "New: answers with sources")] : [];
  main.replaceChildren(header, ...extra, turns, form);
  input.focus();
}

function loginView(next) {
  const err = h("p", { class: "error", role: "alert", hidden: true });
  const email = h("input", { id: "email", type: "email", autocomplete: "username", required: true });
  const pw = h("input", { id: "password", type: "password", autocomplete: "current-password", required: true });
  const form = h("form", { class: "card", "aria-labelledby": "login-title" },
    h("h1", { id: "login-title" }, "Sign in"),
    h("label", { for: "email" }, "Email"), email,
    h("label", { for: "password" }, "Password"), pw,
    h("p", {}, h("button", { class: "btn", type: "submit" }, "Sign in")), err);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await api("/api/login", { method: "POST", body: JSON.stringify({ email: email.value, password: pw.value }) });
    if (!res.ok) { err.hidden = false; err.textContent = (await res.json()).error; pw.value = ""; pw.focus(); return; }
    me = await res.json();
    go(next || "/");
  });
  main.replaceChildren(form);
  email.focus();
}

async function historyView() {
  const { threads } = await (await api("/api/threads")).json();
  main.replaceChildren(h("h1", {}, "History"), threads.length
    ? h("ul", { class: "history" }, threads.map((t) => h("li", {}, h("a", { href: `/t/${t.id}`, "data-link": true }, t.title),
        " ", h("span", { class: "status" }, `${t.turns} question${t.turns === 1 ? "" : "s"}`))))
    : h("p", { class: "status" }, "No questions yet."));
}

async function sharedView(sid) {
  const res = await api(`/api/share/${sid}`);
  if (!res.ok) return main.replaceChildren(h("h1", {}, "This link doesn't exist"));
  const t = await res.json();
  const turns = h("div", { "data-testid": "turns" });
  for (let i = 0; i < t.messages.length; i += 2) {
    const a = t.messages[i + 1];
    turns.append(turnView(t.messages[i].content, { answer: a?.content || "", sources: a?.sources || [] }));
  }
  main.replaceChildren(h("p", { class: "status" }, "Shared answer · read only"), h("h1", {}, t.title), turns);
  if (!t.read_only) main.append(h("form", { class: "ask" }, h("textarea", { "aria-label": "Ask anything" }), h("button", { class: "btn" }, "Ask")));
}

// ---------------- routing ----------------

async function route() {
  nav.classList.remove("open"); menu.setAttribute("aria-expanded", "false");
  const { pathname, search } = location;
  const share = /^\/s\/([a-f0-9]+)$/.exec(pathname);
  if (share) { document.body.dataset.view = "shared"; return sharedView(share[1]); }
  if (pathname === "/login") { document.body.dataset.view = "login"; return loginView(new URLSearchParams(search).get("next")); }
  try {
    if (!me) me = await (await api("/api/me")).json();
    document.querySelector("[data-testid=who]").textContent = me.name;
    const th = /^\/t\/([a-f0-9]+)$/.exec(pathname);
    if (pathname === "/history") { document.body.dataset.view = "history"; return await historyView(); }
    document.body.dataset.view = "ask";
    if (th) {
      const res = await api(`/api/threads/${th[1]}`);
      if (!res.ok) return main.replaceChildren(h("h1", {}, "Thread not found"));
      return askView(await res.json());
    }
    return askView(null);
  } catch (err) {
    if (err.status === 401) { me = null; return go(`/login?next=${encodeURIComponent(pathname)}`); }
    // A fetch that fails because the network dropped, or because the user navigated away while it
    // was in flight (Firefox rejects those), must not become an unhandled rejection (BUG-0002).
    if (err instanceof TypeError) {
      return main.replaceChildren(h("h1", {}, "Can't reach Answerly"),
        h("p", { class: "status" }, "Check your connection and try again."));
    }
    throw err;
  }
}

function go(path) { history.pushState({}, "", path); route(); }

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (a && !e.metaKey && !e.ctrlKey) { e.preventDefault(); go(a.getAttribute("href")); }
});
menu.addEventListener("click", () => {
  const open = nav.classList.toggle("open");
  menu.setAttribute("aria-expanded", String(open));
});
document.querySelector("[data-action=logout]").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" });
  me = null; go("/login");
});
window.addEventListener("popstate", route);
// Firefox follows the #main fragment but leaves keyboard focus where it was, so the skip link
// would only scroll. Move focus explicitly (found by a11y.spec.ts on firefox-desktop).
document.querySelector(".skip").addEventListener("click", (e) => { e.preventDefault(); main.focus(); });

try {
  FAULTS = new Set((await (await fetch("/app-config.json")).json()).faults);
} catch { FAULTS = new Set(); }
if (FAULTS.has("a11y_low_contrast")) document.documentElement.style.setProperty("--muted", "#cfcbc3");
route();
