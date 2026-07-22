import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

/**
 * All five load scenarios in one script, selected with -e SCENARIO=...
 *
 *   k6 run -e SCENARIO=login            load-tests/scenarios.js
 *   k6 run -e SCENARIO=assignment_load  load-tests/scenarios.js
 *   k6 run -e SCENARIO=autosave         load-tests/scenarios.js
 *   k6 run -e SCENARIO=submission_spike load-tests/scenarios.js
 *   k6 run -e SCENARIO=analytics        load-tests/scenarios.js
 *
 * Targets the LOCAL Supabase stack via load-tests/.users.json, written by
 * `npx tsx load-tests/provision.ts`. Requests go straight at Supabase
 * (PostgREST/GoTrue) because that is the shared resource 300 concurrent
 * students actually contend for; the Next.js layer is stateless and scales
 * horizontally on Vercel.
 */

const cfg = JSON.parse(open("./.users.json"));
const SCENARIO = __ENV.SCENARIO || "login";
const VUS = Number(__ENV.VUS || 400);

const latency = new Trend("op_latency", true);
const failures = new Rate("op_failures");

export const options = {
  scenarios: {
    [SCENARIO]:
      SCENARIO === "submission_spike"
        ? {
            // The highest-risk moment: everyone submits at once.
            executor: "shared-iterations",
            vus: VUS,
            iterations: VUS,
            maxDuration: "2m",
            exec: SCENARIO,
          }
        : {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
              { duration: "20s", target: VUS },
              { duration: "40s", target: VUS },
              { duration: "10s", target: 0 },
            ],
            exec: SCENARIO,
          },
  },
  thresholds: {
    op_failures: ["rate<0.01"],
    "op_latency{op:login}": ["p(95)<3000"],
    "op_latency{op:questions}": ["p(95)<3000"],
    "op_latency{op:autosave}": ["p(95)<3000"],
    "op_latency{op:submit}": ["p(95)<5000"],
    "op_latency{op:analytics}": ["p(95)<5000"],
  },
};

function user() {
  return cfg.users[(__VU - 1) % cfg.users.length];
}

function authHeaders(token) {
  return {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function record(op, res, expected) {
  latency.add(res.timings.duration, { op });
  const ok = check(res, { [`${op} ok`]: (r) => expected.includes(r.status) });
  failures.add(!ok, { op });
  return ok;
}

// ---------------------------------------------------------------- login --
export function login() {
  const u = user();
  const res = http.post(
    `${cfg.supabaseUrl}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: u.email, password: cfg.password }),
    { headers: { apikey: cfg.anonKey, "Content-Type": "application/json" } }
  );
  record("login", res, [200]);
  sleep(1);
}

// ------------------------------------------------------- assignment load --
// Mirrors what the student attempt page issues: the question list, the
// get_or_create_attempt RPC, and the saved answers for that attempt.
export function assignment_load() {
  const u = user();
  const h = authHeaders(u.token);

  const questions = http.get(
    `${cfg.supabaseUrl}/rest/v1/questions?assignment_id=eq.${cfg.assignment1Id}&is_active=eq.true&select=id,question_text,display_order&order=display_order`,
    { headers: h }
  );
  record("questions", questions, [200]);

  const attempt = http.post(
    `${cfg.supabaseUrl}/rest/v1/rpc/get_or_create_attempt`,
    JSON.stringify({ p_assignment_id: cfg.assignment1Id }),
    { headers: h }
  );
  const attemptOk = record("attempt", attempt, [200]);

  if (attemptOk) {
    const id = (attempt.json() || {}).id;
    if (id) {
      const saved = http.get(
        `${cfg.supabaseUrl}/rest/v1/responses?attempt_id=eq.${id}&select=question_id,response_value`,
        { headers: h }
      );
      record("saved_answers", saved, [200]);
    }
  }
  sleep(1);
}

// ------------------------------------------------------------- autosave --
export function autosave() {
  const u = user();
  const h = authHeaders(u.token);

  const attempt = http.post(
    `${cfg.supabaseUrl}/rest/v1/rpc/get_or_create_attempt`,
    JSON.stringify({ p_assignment_id: cfg.assignment1Id }),
    { headers: h }
  );
  if (!record("attempt", attempt, [200])) return;
  const attemptId = (attempt.json() || {}).id;
  if (!attemptId) return;

  // A realistic debounce batch: a few answers at a time, repeatedly.
  for (let batch = 0; batch < 3; batch++) {
    const answers = [];
    for (let k = 0; k < 4; k++) {
      const qi = (batch * 4 + k) % cfg.questionIds.length;
      answers.push({ questionId: cfg.questionIds[qi], value: (__VU + qi) % 2 });
    }
    const res = http.post(
      `${cfg.supabaseUrl}/rest/v1/rpc/save_attempt_responses`,
      JSON.stringify({ p_attempt_id: attemptId, p_answers: answers }),
      { headers: h }
    );
    record("autosave", res, [200]);
    sleep(0.8);
  }
}

// ----------------------------------------------------- submission spike --
export function submission_spike() {
  const u = user();
  const h = authHeaders(u.token);

  const attempt = http.post(
    `${cfg.supabaseUrl}/rest/v1/rpc/get_or_create_attempt`,
    JSON.stringify({ p_assignment_id: cfg.assignment1Id }),
    { headers: h }
  );
  if (!record("attempt", attempt, [200])) return;
  const attemptId = (attempt.json() || {}).id;
  if (!attemptId) return;

  const answers = cfg.questionIds.slice(0, 10).map((q, i) => ({
    questionId: q,
    value: (__VU + i) % 2,
  }));
  const saved = http.post(
    `${cfg.supabaseUrl}/rest/v1/rpc/save_attempt_responses`,
    JSON.stringify({ p_attempt_id: attemptId, p_answers: answers }),
    { headers: h }
  );
  record("autosave", saved, [200]);

  // Everyone submits with no think-time — the spike being measured.
  const submit = http.post(
    `${cfg.supabaseUrl}/rest/v1/rpc/submit_attempt`,
    JSON.stringify({ p_attempt_id: attemptId }),
    { headers: h }
  );
  // 200 = submitted. A 4xx carrying ALREADY_SUBMITTED is a correct,
  // expected outcome under a double-submit race, not a failure.
  const body = submit.body || "";
  const ok = submit.status === 200 || body.indexOf("ALREADY_SUBMITTED") >= 0;
  latency.add(submit.timings.duration, { op: "submit" });
  check(submit, { "submit resolved": () => ok });
  failures.add(!ok, { op: "submit" });
}

// ------------------------------------------------------------ analytics --
// The professor dashboard: several aggregate views per page load.
export function analytics() {
  const u = user();
  const h = authHeaders(u.token);
  const views = [
    `class_transition_summary?class_id=eq.${cfg.classId}&select=*`,
    `mapping_transition_summary?class_id=eq.${cfg.classId}&select=*`,
    `student_transition_summary?class_id=eq.${cfg.classId}&select=*`,
    `question_response_summary?assignment_id=eq.${cfg.assignment2Id}&select=*`,
  ];
  for (const v of views) {
    const res = http.get(`${cfg.supabaseUrl}/rest/v1/${v}`, { headers: h });
    record("analytics", res, [200]);
  }
  sleep(1);
}
