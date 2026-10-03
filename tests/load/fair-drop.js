import http from "k6/http";
import { SharedArray } from "k6/data";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";

const baseUrl = (__ENV.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const dropId = __ENV.DROP_ID;
const scenario = __ENV.SCENARIO || "baseline";
const users = Math.max(1, Math.min(2000, Number(__ENV.VUS || 24)));
const maxActiveVus = scenario === "burst" ? Math.min(2000, users * 2) : users;
const duration = __ENV.DURATION || "30s";
// k6 resolves open() paths relative to this script, not the working directory.
const accountsFile = __ENV.ACCOUNTS_FILE || "./accounts.local.json";
const accounts = new SharedArray("fair-drop-test-accounts", () => JSON.parse(open(accountsFile)));

const accepted = new Counter("entry_requests_accepted_or_replayed");
const throttled = new Counter("entry_requests_throttled");
const rejected = new Counter("entry_requests_rejected");
const entrySuccess = new Rate("entry_attempt_success_rate");
const apiLatency = new Trend("booking_api_latency", true);
const powSolveTime = new Trend("pow_solve_time", true);
const powHashes = new Counter("pow_hashes_computed");

// Protected drops require a proof-of-work answer on every entry request, so a script pays
// the same CPU cost per attempt as a browser. Baseline drops (limits off) need none.
let powRequired = null;
function leadingZeroBits(hex) {
  let bits = 0;
  for (const char of hex) {
    const nibble = parseInt(char, 16);
    if (nibble === 0) { bits += 4; continue; }
    return bits + Math.clz32(nibble) - 28;
  }
  return bits;
}
function solvePow() {
  if (powRequired === false) return undefined;
  const response = http.get(`${baseUrl}/api/pow/challenge?action=join&dropId=${dropId}`, { tags: { action: "pow-challenge" } });
  const challenge = response.json();
  powRequired = !!challenge.required;
  if (!challenge.required) return undefined;
  const id = challenge.token.split(".")[1];
  const started = Date.now();
  let nonce = 0;
  while (leadingZeroBits(crypto.sha256(`${id}:${nonce}`, "hex")) < challenge.difficulty) nonce++;
  powSolveTime.add(Date.now() - started);
  powHashes.add(nonce + 1);
  return { token: challenge.token, signature: challenge.signature, nonce: String(nonce) };
}

http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409, 429));

function rampingVus() {
  return {
    executor: "ramping-vus",
    startVUs: 1,
    stages: [{ duration: "5s", target: users }, { duration, target: users }, { duration: "2s", target: 0 }],
    gracefulRampDown: "2s",
  };
}

const definitions = {
  baseline: rampingVus(),
  repeat: rampingVus(),
  burst: {
    executor: "ramping-arrival-rate", startRate: 0, timeUnit: "1s",
    preAllocatedVUs: users, maxVUs: Math.min(2000, users * 2),
    stages: [{ duration: "2s", target: users }, { duration, target: users }, { duration: "2s", target: 0 }],
  },
  mixed: rampingVus(),
  recovery: rampingVus(),
};

export const options = {
  scenarios: { [Object.prototype.hasOwnProperty.call(definitions, scenario) ? scenario : "baseline"]: definitions[scenario] || definitions.baseline },
  thresholds: { entry_attempt_success_rate: ["rate>0"] },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

export function setup() {
  if (!dropId) throw new Error("Set DROP_ID to a drop in your test deployment.");
  const requiredAccounts = maxActiveVus;
  if (accounts.length < requiredAccounts) throw new Error(`The account file has ${accounts.length} accounts; this scenario needs at least ${requiredAccounts} to give active virtual users separate accounts.`);
}

function selectAccount() {
  const repeatsSameAccount = scenario === "repeat" || scenario === "recovery" || (scenario === "mixed" && __VU % 5 === 0);
  const index = repeatsSameAccount ? __VU - 1 : (__VU - 1 + __ITER * maxActiveVus) % accounts.length;
  return accounts[index % accounts.length];
}

function authenticate(account) {
  const jar = http.cookieJar();
  if (account.sessionToken) {
    jar.set(baseUrl, "fairdrop_session", account.sessionToken, { path: "/", http_only: true });
    return;
  }
  const response = http.post(`${baseUrl}/api/auth/login`, JSON.stringify({ email: account.email, password: account.password }), {
    headers: { "Content-Type": "application/json" }, tags: { action: "login" },
  });
  check(response, { "account signed in": (res) => res.status === 200 });
}

function request(path, action, method = "POST") {
  const response = method === "GET"
    ? http.get(`${baseUrl}${path}`, { tags: { action } })
    : http.post(`${baseUrl}${path}`, JSON.stringify({ pow: solvePow() }), { headers: { "Content-Type": "application/json" }, tags: { action } });
  apiLatency.add(response.timings.duration, { action });
  if (response.status === 200 || response.status === 201) accepted.add(1, { action });
  else if (response.status === 429) throttled.add(1, { action });
  else rejected.add(1, { action, status: String(response.status) });
  return response;
}

function enterAndObserve() {
  const response = request(`/api/drops/${dropId}/entries`, "join");
  const ok = response.status === 200 || response.status === 201;
  entrySuccess.add(ok);
  check(response, { "join was saved or safely replayed": (res) => res.status === 200 || res.status === 201 || res.status === 409 || res.status === 429 });
  request(`/api/drops/${dropId}/my-entry`, "status", "GET");
}

export default function () {
  const account = selectAccount();
  authenticate(account);
  if (scenario === "repeat") {
    if (__ITER === 0) enterAndObserve();
    for (let attempt = 0; attempt < 8; attempt++) request(`/api/drops/${dropId}/entries`, "repeat");
    request(`/api/drops/${dropId}/my-entry`, "status", "GET");
  } else if (scenario === "mixed" && __VU % 5 === 0) {
    for (let attempt = 0; attempt < 5; attempt++) request(`/api/drops/${dropId}/entries`, "repeat");
  } else if (scenario === "recovery") {
    enterAndObserve();
    request(`/api/drops/${dropId}/my-entry`, "reconnect", "GET");
    request(`/api/drops/${dropId}/entries`, "retry");
  } else {
    enterAndObserve();
  }
  sleep(scenario === "baseline" ? 0.8 + Math.random() : 0.25);
}

function textSummary(file, metrics) {
  const pct = (value) => `${(value * 100).toFixed(1)}%`;
  const rows = [
    ["Scenario", `${scenario} · ${users} VUs · ${duration}`],
    ["Drop", dropId],
    ["Total requests", metrics.requests.toLocaleString()],
    ["Throughput", `${metrics.throughputPerSecond.toFixed(1)} req/s`],
    ["Latency p95", `${metrics.latencyP95Ms.toFixed(1)} ms`],
    ["Request failure rate", pct(metrics.requestFailureRate)],
    ["Accepted or replayed", metrics.acceptedOrReplayed.toLocaleString()],
    ["Throttled (429)", metrics.throttled.toLocaleString()],
    ["Rejected", metrics.rejected.toLocaleString()],
    ["Entry success rate", pct(metrics.joinSuccessRate)],
    ["Proof-of-work solve p95", metrics.powSolveP95Ms ? `${metrics.powSolveP95Ms.toFixed(0)} ms` : "not required"],
    ["Hashes computed by bots", metrics.powHashes.toLocaleString()],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const line = "─".repeat(width + 40);
  return [
    "", "  FAIR DROP LOAD TEST", `  ${line}`,
    ...rows.map(([label, value]) => `  ${label.padEnd(width)}   ${value}`),
    `  ${line}`, `  Saved to ${file}`, "",
  ].join("\n");
}

export function handleSummary(data) {
  const file = `tests/load/results-${scenario}-${dropId}.json`;
  const metrics = {
    requests: data.metrics.http_reqs?.values?.count ?? 0,
    throughputPerSecond: data.metrics.http_reqs?.values?.rate ?? 0,
    latencyP95Ms: data.metrics.http_req_duration?.values?.["p(95)"] ?? 0,
    requestFailureRate: data.metrics.http_req_failed?.values?.rate ?? 0,
    acceptedOrReplayed: data.metrics.entry_requests_accepted_or_replayed?.values?.count ?? 0,
    throttled: data.metrics.entry_requests_throttled?.values?.count ?? 0,
    rejected: data.metrics.entry_requests_rejected?.values?.count ?? 0,
    joinSuccessRate: data.metrics.entry_attempt_success_rate?.values?.rate ?? 0,
    powSolveP95Ms: data.metrics.pow_solve_time?.values?.["p(95)"] ?? 0,
    powHashes: data.metrics.pow_hashes_computed?.values?.count ?? 0,
  };
  return {
    stdout: textSummary(file, metrics),
    [file]: JSON.stringify({ scenario, dropId, generatedAt: new Date().toISOString(), vus: users, duration, metrics }, null, 2),
  };
}
