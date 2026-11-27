import assert from "assert/strict";
import {
  BackendUnavailableError,
  createBackendMonitor,
  RequestInFlightError,
  type BackendHealthStatus,
} from "../apiFetch";

const BASE_URL = "http://test-backend.local";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];

function it(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

it("marks backend awake on a fast 200 OK without entering waking or polling /health", async () => {
    const calls: string[] = [];
    const seenStatuses: BackendHealthStatus[] = [];

    const monitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      slowRequestMs: 40,
      pollIntervalMs: 25,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        return jsonResponse({ ok: true }, 200);
      },
    });

    const unsub = monitor.subscribe(() => {
      seenStatuses.push(monitor.getSnapshot().status);
    });

    try {
      const res = await monitor.apiFetch("/rooms");
      assert.equal(res.status, 200);
      assert.equal(monitor.getSnapshot().status, "awake");
      assert.equal(monitor.getSnapshot().overlayVisible, false);
      assert.deepEqual(calls, [`${BASE_URL}/rooms`]);
      assert.equal(seenStatuses.includes("waking"), false);
    } finally {
      unsub();
      monitor.dispose();
    }
  });

  it("detects waking on slow pending request, polls /health without duplicating original, and closes overlay when original resolves", async () => {
    let roomCalls = 0;
    let healthCalls = 0;
    let resolveRoom!: (res: Response) => void;

    const monitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      slowRequestMs: 30,
      pollIntervalMs: 25,
      estimatedWakeMs: 500,
      maxWakeMs: 1_500,
      readyFadeMs: 25,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          healthCalls += 1;
          return new Response(null, { status: 503 });
        }
        roomCalls += 1;
        return new Promise<Response>((resolve) => {
          resolveRoom = resolve;
        });
      },
    });

    try {
      const pending = monitor.apiFetch(
        "/rooms",
        { method: "POST", body: "{}" },
        { showOverlay: true, retryOnWake: true, actionKey: "create_room" }
      );

      // Wait past slowRequestMs so waking state and /health polling start
      await delay(75);
      const mid = monitor.getSnapshot();
      assert.equal(mid.status, "waking");
      assert.equal(mid.overlayVisible, true);
      assert.equal(mid.checkPhase, "responded");
      assert.equal(roomCalls, 1, "must not duplicate a still-pending request");
      assert.ok(healthCalls >= 1, "must poll /health while waiting");

      // Original request held by Render now succeeds
      resolveRoom(jsonResponse({ code: "ABC123" }, 201));
      const res = await pending;
      assert.equal(res.status, 201);
      assert.equal(roomCalls, 1);
      assert.equal(monitor.getSnapshot().status, "awake");
      assert.equal(monitor.getSnapshot().checkPhase, "ready");
      assert.equal(monitor.getSnapshot().overlayClosing, true);

      // After short fade-out, overlay closes cleanly
      await delay(45);
      assert.equal(monitor.getSnapshot().overlayVisible, false);
      assert.equal(monitor.getSnapshot().overlayClosing, false);
    } finally {
      monitor.dispose();
    }
  });

  it("enters waking on network error, polls /health, and retries once after /health succeeds", async () => {
    let apiCalls = 0;
    let healthCalls = 0;

    const monitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      slowRequestMs: 40,
      pollIntervalMs: 20,
      estimatedWakeMs: 500,
      maxWakeMs: 1_500,
      readyFadeMs: 15,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          healthCalls += 1;
          if (healthCalls < 2) {
            return new Response(null, { status: 503 });
          }
          return jsonResponse({ status: "ok" }, 200);
        }
        apiCalls += 1;
        if (apiCalls === 1) {
          throw new TypeError("Failed to fetch");
        }
        return jsonResponse({ code: "N7AJP2" }, 200);
      },
    });

    try {
      const res = await monitor.apiFetch("/rooms/N7AJP2");
      assert.equal(res.status, 200);
      assert.equal(apiCalls, 2, "must retry exactly once after /health succeeds");
      assert.equal(healthCalls, 2);
      assert.equal(monitor.getSnapshot().status, "awake");
    } finally {
      monitor.dispose();
    }
  });

  it("retries POST /rooms once on 503 after /health succeeds and guards against concurrent duplicates", async () => {
    let createCalls = 0;
    let healthCalls = 0;

    const monitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      slowRequestMs: 40,
      pollIntervalMs: 20,
      estimatedWakeMs: 500,
      maxWakeMs: 1_500,
      readyFadeMs: 15,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          healthCalls += 1;
          if (healthCalls === 1) {
            return new Response(null, { status: 502 });
          }
          return jsonResponse({ status: "ok" }, 200);
        }
        createCalls += 1;
        if (createCalls === 1) {
          return new Response(null, { status: 503 });
        }
        return jsonResponse({ code: "ROOM01" }, 201);
      },
    });

    try {
      const first = monitor.apiFetch(
        "/rooms",
        { method: "POST", body: "{}" },
        { showOverlay: true, retryOnWake: true, actionKey: "create_room" }
      );

      // Immediate second click while first create_room is in flight
      await assert.rejects(
        () =>
          monitor.apiFetch(
            "/rooms",
            { method: "POST", body: "{}" },
            { showOverlay: true, retryOnWake: true, actionKey: "create_room" }
          ),
        (err: unknown) => err instanceof RequestInFlightError
      );

      const res = await first;
      assert.equal(res.status, 201);
      assert.equal(createCalls, 2, "initial 503 + single retry after /health 200");
      assert.equal(healthCalls, 2);
    } finally {
      monitor.dispose();
    }
  });

  it("does not treat real 4xx or 500 responses as waking and does not retry them", async () => {
    const statuses = [400, 401, 404, 422, 500];

    for (const statusCode of statuses) {
      let apiCalls = 0;
      let healthCalls = 0;

      const monitor = createBackendMonitor({
        getBaseUrl: () => BASE_URL,
        simulateColdStart: false,
        slowRequestMs: 40,
        pollIntervalMs: 20,
        fetchImpl: async (input) => {
          const url = String(input);
          if (url.endsWith("/health")) {
            healthCalls += 1;
            return jsonResponse({ status: "ok" }, 200);
          }
          apiCalls += 1;
          return jsonResponse(
            { error: { code: "real_err", message: `Error ${statusCode}` } },
            statusCode
          );
        },
      });

      try {
        const res = await monitor.apiFetch(
          "/rooms/MISSING",
          { method: "GET" },
          { showOverlay: true, retryOnWake: true }
        );
        assert.equal(res.status, statusCode);
        assert.equal(apiCalls, 1, `status ${statusCode} must not be retried`);
        assert.equal(healthCalls, 0, `status ${statusCode} must not poll /health`);
        assert.equal(monitor.getSnapshot().status, "awake");
        assert.equal(monitor.getSnapshot().overlayVisible, false);
      } finally {
        monitor.dispose();
      }
    }
  });

  it("transitions waking -> slow -> failed after maxWakeMs and stops polling", async () => {
    let healthCalls = 0;
    const transitions: BackendHealthStatus[] = [];

    const monitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      slowRequestMs: 15,
      pollIntervalMs: 25,
      healthTimeoutMs: 50,
      estimatedWakeMs: 55,
      maxWakeMs: 120,
      readyFadeMs: 15,
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.endsWith("/health")) {
          healthCalls += 1;
          return new Response(null, { status: 503 });
        }
        throw new TypeError("Failed to fetch");
      },
    });

    const unsub = monitor.subscribe(() => {
      const s = monitor.getSnapshot().status;
      if (transitions[transitions.length - 1] !== s) {
        transitions.push(s);
      }
    });

    try {
      await assert.rejects(
        () => monitor.apiFetch("/rooms/FAIL01"),
        (err: unknown) => err instanceof BackendUnavailableError
      );

      assert.equal(monitor.getSnapshot().status, "failed");
      assert.deepEqual(transitions, ["waking", "slow", "failed"]);

      const callsAtFailure = healthCalls;
      await delay(70);
      assert.equal(
        healthCalls,
        callsAtFailure,
        "polling must stop once failed"
      );
    } finally {
      unsub();
      monitor.dispose();
    }
  });

  it("does not show warm-up banner if /health answers quickly, and shows it if delayed", async () => {
    // Fast health check
    const fastMonitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      bannerDelayMs: 40,
      fetchImpl: async () => jsonResponse({ status: "ok" }, 200),
    });
    let sawBannerFast = false;
    const unsubFast = fastMonitor.subscribe(() => {
      if (fastMonitor.getSnapshot().warmingInBackground) {
        sawBannerFast = true;
      }
    });

    try {
      await fastMonitor.warmUpBackend();
      assert.equal(sawBannerFast, false);
      assert.equal(fastMonitor.getSnapshot().status, "awake");
    } finally {
      unsubFast();
      fastMonitor.dispose();
    }

    // Slow health check
    let resolveHealth!: (res: Response) => void;
    const slowMonitor = createBackendMonitor({
      getBaseUrl: () => BASE_URL,
      simulateColdStart: false,
      bannerDelayMs: 20,
      slowRequestMs: 200,
      fetchImpl: async () =>
        new Promise<Response>((resolve) => {
          resolveHealth = resolve;
        }),
    });

    try {
      const warmupPromise = slowMonitor.warmUpBackend();
      await delay(35);
      assert.equal(slowMonitor.getSnapshot().warmingInBackground, true);
      assert.equal(slowMonitor.getSnapshot().overlayVisible, false);

      resolveHealth(jsonResponse({ status: "ok" }, 200));
      await warmupPromise;
      assert.equal(slowMonitor.getSnapshot().warmingInBackground, false);
      assert.equal(slowMonitor.getSnapshot().status, "awake");
    } finally {
      slowMonitor.dispose();
    }
  });

async function runAll() {
  let passed = 0;
  let failed = 0;

  for (const tc of tests) {
    try {
      await tc.fn();
      passed += 1;
      console.log(`PASS  ${tc.name}`);
    } catch (err) {
      failed += 1;
      console.error(`FAIL  ${tc.name}`);
      console.error(err);
    }
  }

  console.log(`\napiFetch tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

void runAll();
