// Runs the suite once per injected fault (chromium-desktop + mobile-chrome) and checks that
// exactly the expected tests fail. A healthy app must fail nothing.
//
//   node scripts/fault-matrix.mjs            # verify against tests/faults.json, exit 1 on mismatch
//   node scripts/fault-matrix.mjs --record   # print what each fault actually breaks
//   node scripts/fault-matrix.mjs --only no_stream,citation_offbyone
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const record = args.includes("--record");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const expected = JSON.parse(readFileSync("tests/faults.json", "utf8"));
const faults = ["", ...Object.keys(expected.faults)].filter((f) => !only || f === "" || only.includes(f));

function failingTests(fault, port) {
  const run = spawnSync("npx", ["playwright", "test", "--project=chromium-desktop", "--project=mobile-chrome",
    "--reporter=json", "--retries=0", "--workers=4"], {
    env: { ...process.env, APP_FAULTS: fault, PORT: String(port), CI: "" }, encoding: "utf8", maxBuffer: 64 << 20,
  });
  const report = JSON.parse(run.stdout);
  const failed = new Set();
  const walk = (suite) => {
    for (const s of suite.suites || []) walk(s);
    for (const spec of suite.specs || []) {
      for (const t of spec.tests) {
        if (t.status === "unexpected" || t.status === "flaky") failed.add(`${spec.file.replace(/^.*\//, "")}: ${spec.title}`);
      }
    }
  };
  for (const s of report.suites) walk(s);
  return [...failed].sort();
}

const rows = [];
let mismatches = 0;
faults.forEach((fault, i) => {
  const got = failingTests(fault, 4300 + i);
  const want = fault ? [...expected.faults[fault].caught_by].sort() : [];
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) mismatches += 1;
  rows.push({ fault: fault || "(healthy)", what: fault ? expected.faults[fault].what : "no fault", got, ok });
  console.log(`${ok ? "OK  " : "DIFF"} ${fault || "(healthy)"}: ${got.length} failing`);
  if (!ok || record) for (const g of got) console.log(`       ${want.includes(g) ? " " : "+"} ${g}`);
  if (!ok) for (const w of want.filter((w) => !got.includes(w))) console.log(`       - ${w}`);
});

mkdirSync("test-results", { recursive: true });
const md = ["| Fault | What breaks | Caught by | |", "|---|---|---|---|",
  ...rows.map((r) => `| \`${r.fault}\` | ${r.what} | ${r.got.length ? r.got.join("<br>") : "nothing (as expected)"} | ${r.ok ? "✅" : "❌"} |`)].join("\n");
writeFileSync("test-results/fault-matrix.md", md + "\n");
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, `## Fault matrix\n\n${md}\n`, { flag: "a" });
process.exit(record ? 0 : mismatches ? 1 : 0);
