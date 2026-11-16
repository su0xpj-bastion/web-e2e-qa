// Answerly: a small streaming-answer web app used as the system under test.
// No dependencies: Node's http module, an in-memory store, and Server-Sent Events.
//
// APP_FAULTS (comma-separated) turns on a deliberate bug; tests/faults.json lists which
// spec must catch each one. Test-only routes under /__test/ exist only when APP_TEST=1.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const TOKEN_MS = Number(process.env.TOKEN_MS || 12);
const SESSION_TTL_MS = 30 * 60 * 1000;
let FAULTS = new Set((process.env.APP_FAULTS || "").split(",").filter(Boolean));

// Demo accounts for local testing only; the same values live in tests/fixtures/users.json.
const USERS = { "ada@example.test": { name: "Ada", password: "correct-horse-test" },
                "lin@example.test": { name: "Lin", password: "battery-staple-test" } };

const SOURCES = [
  { title: "How streaming responses work", url: "https://docs.example.test/streaming" },
  { title: "Measuring time to first token", url: "https://docs.example.test/ttft" },
  { title: "Caching prompts for faster answers", url: "https://docs.example.test/caching" },
  { title: "Rate limits and retries", url: "https://docs.example.test/rate-limits" },
  { title: "Choosing a model size", url: "https://docs.example.test/models" },
];

const sessions = new Map();   // sid -> { email, expires }
const threads = new Map();    // id -> { id, owner, title, messages: [{role, content, sources}] }
const shares = new Map();     // shareId -> threadId
const id = (n = 8) => randomBytes(n).toString("hex");

function pickSources(question) {
  let h = 0;
  for (const c of question) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = h % SOURCES.length, b = (a + 2) % SOURCES.length;
  return [a, b].map((i, k) => ({ n: k + 1, ...SOURCES[i] }));
}

function compose(question, sources, previous) {
  const topic = question.replace(/[?.!]+$/, "").trim();
  const follow = previous ? `Building on your earlier question about "${previous}", ` : "";
  return `${follow}Here is a short answer to "${topic}". Streaming sends the reply as it is generated, ` +
    `so the first words arrive quickly [1]. The wait before that first word is what users notice most, ` +
    `and it is worth measuring on every release [2]. Keep prompts stable so repeated questions are cheaper, ` +
    `and retry only when the service asks you to slow down.`;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/plain" : "application/json",
                          "Content-Length": Buffer.byteLength(data), ...headers });
  res.end(data);
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { return raw ? JSON.parse(raw) : {}; } catch { return null; }
}

function session(req) {
  const sid = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || "")?.[1];
  const s = sid && sessions.get(sid);
  if (!s || s.expires < Date.now()) return null;
  return { sid, ...s };
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
               ".svg": "image/svg+xml", ".ico": "image/x-icon" };

async function serveStatic(req, res, path) {
  const file = path === "/" || !extname(path) ? "index.html" : path.slice(1);
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream",
                         "Cache-Control": "no-store",
                         "Content-Security-Policy": "default-src 'self'; img-src 'self' data:" });
    res.end(body);
  } catch {
    send(res, 404, "not found");
  }
}

async function ask(req, res, user) {
  const body = await readJson(req);
  const question = (body?.question || "").trim();
  if (!question) return send(res, 400, { error: "question is required" });
  if (question.length > 2000) return send(res, 413, { error: "question is too long" });

  let thread = body.thread_id && threads.get(body.thread_id);
  if (thread && thread.owner !== user.email) return send(res, 404, { error: "thread not found" });
  if (!thread) {
    thread = { id: id(6), owner: user.email, title: question.slice(0, 60), messages: [] };
    threads.set(thread.id, thread);
  }
  const previous = thread.messages.filter((m) => m.role === "user").at(-1)?.content;
  const sources = pickSources(question);
  const answer = compose(question, sources, previous);
  thread.messages.push({ role: "user", content: question });

  res.writeHead(200, { "Content-Type": FAULTS.has("wrong_content_type") ? "text/plain" : "text/event-stream",
                       "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let closed = false;
  req.on("close", () => { closed = true; });
  const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);

  event("meta", { thread_id: thread.id, sources });

  const words = answer.split(/(?<= )/);
  if (FAULTS.has("slow_first_token")) await sleep(2500);
  const buffered = FAULTS.has("no_stream");
  let out = "";
  for (let i = 0; i < words.length; i++) {
    if (closed && !FAULTS.has("stop_ignored")) break;
    if (FAULTS.has("midstream_error") && i === 30 && !body.retry) {
      event("error", { message: "The answer was interrupted. Please try again." });
      thread.messages.pop();
      return res.end();
    }
    out += words[i];
    if (!buffered) { event("token", { text: words[i] }); await sleep(TOKEN_MS); }
  }
  if (buffered) { await sleep(TOKEN_MS * words.length); event("token", { text: out }); }
  thread.messages.push({ role: "assistant", content: out, sources });
  event("done", { thread_id: thread.id, tokens: words.length, stopped: closed });
  res.end();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  try {
    // ---- test-only controls ----
    if (process.env.APP_TEST === "1" && path.startsWith("/__test/")) {
      if (path === "/__test/reset") { sessions.clear(); threads.clear(); shares.clear(); return send(res, 204, ""); }
      if (path === "/__test/expire") {       // expires only the caller's session, so parallel tests are unaffected
        const s = session(req);
        if (s) sessions.get(s.sid).expires = 0;
        return send(res, 204, "");
      }
      if (path === "/__test/faults") { return send(res, 200, { faults: [...FAULTS] }); }
    }
    // ---- client config: which client-side faults are on (a test fixture, not a product feature) ----
    if (path === "/app-config.json") return send(res, 200, { faults: [...FAULTS] });
    // ---- auth ----
    if (path === "/api/login" && req.method === "POST") {
      const body = await readJson(req);
      const u = USERS[body?.email];
      if (!u || u.password !== body?.password) return send(res, 401, { error: "Email or password is incorrect." });
      const sid = id(16);
      sessions.set(sid, { email: body.email, expires: Date.now() + SESSION_TTL_MS });
      return send(res, 200, { name: u.name, email: body.email },
                  { "Set-Cookie": `sid=${sid}; HttpOnly; SameSite=Lax; Path=/` });
    }
    if (path === "/api/logout" && req.method === "POST") {
      const s = session(req);
      if (s) sessions.delete(s.sid);
      return send(res, 204, "", { "Set-Cookie": "sid=; Max-Age=0; Path=/" });
    }
    if (path === "/api/me") {
      const s = session(req);
      return s ? send(res, 200, { email: s.email, name: USERS[s.email].name }) : send(res, 401, { error: "signed out" });
    }
    // ---- shared threads (no auth) ----
    const shared = /^\/api\/share\/([a-f0-9]+)$/.exec(path);
    if (shared && req.method === "GET") {
      const t = threads.get(shares.get(shared[1]));
      return t ? send(res, 200, { title: t.title, messages: t.messages, read_only: !FAULTS.has("share_leaks_controls") })
               : send(res, 404, { error: "not found" });
    }
    // ---- everything else needs a session ----
    if (path.startsWith("/api/")) {
      const user = session(req);
      if (!user) return send(res, 401, { error: "Your session has expired. Please sign in again." });
      if (path === "/api/ask" && req.method === "POST") return ask(req, res, user);
      if (path === "/api/threads" && req.method === "GET") {
        const mine = [...threads.values()].filter((t) => t.owner === user.email).reverse()
          .map((t) => ({ id: t.id, title: t.title, turns: t.messages.length / 2 }));
        return send(res, 200, { threads: mine });
      }
      const th = /^\/api\/threads\/([a-f0-9]+)(\/share)?$/.exec(path);
      if (th) {
        const t = threads.get(th[1]);
        if (!t || t.owner !== user.email) return send(res, 404, { error: "thread not found" });
        if (th[2] && req.method === "POST") {
          const sid = id(6);
          shares.set(sid, t.id);
          return send(res, 200, { url: `/s/${sid}` });
        }
        return send(res, 200, t);
      }
      return send(res, 404, { error: "not found" });
    }
    return serveStatic(req, res, path);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Answerly on http://127.0.0.1:${PORT}  faults=${[...FAULTS].join(",") || "none"}`);
});
