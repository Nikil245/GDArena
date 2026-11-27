import assert from "assert/strict";
import {
  formatEstimatedResume,
  formatSttRateLimitMessage,
  INITIAL_ROOM_SERVICE_BANNER,
  reduceRoomServiceBanner,
} from "../serviceStatus";

interface TestCase {
  name: string;
  fn: () => void;
}

const tests: TestCase[] = [];

function it(name: string, fn: () => void) {
  tests.push({ name, fn });
}

it("transitions ok -> exhausted -> continue_without_ai -> ok (back notice) -> dismissed", () => {
  const retryAt = "2026-11-27T14:15:00.000Z";

  const exhausted = reduceRoomServiceBanner(INITIAL_ROOM_SERVICE_BANNER, {
    type: "service_status",
    payload: {
      service: "llm",
      state: "exhausted",
      retry_at: retryAt,
      message: "AI services have reached their usage limit.",
    },
  });
  assert.equal(exhausted.llmState, "exhausted");
  assert.equal(exhausted.retryAt, retryAt);
  assert.equal(exhausted.continueWithoutAi, false);
  assert.equal(exhausted.showBackNotice, false);

  const collapsed = reduceRoomServiceBanner(exhausted, {
    type: "continue_without_ai",
  });
  assert.equal(collapsed.llmState, "exhausted");
  assert.equal(collapsed.continueWithoutAi, true);

  const recovered = reduceRoomServiceBanner(collapsed, {
    type: "service_status",
    payload: {
      service: "llm",
      state: "ok",
      retry_at: null,
      message: "AI participants are back.",
    },
  });
  assert.equal(recovered.llmState, "ok");
  assert.equal(recovered.retryAt, null);
  assert.equal(recovered.continueWithoutAi, false);
  assert.equal(recovered.showBackNotice, true);

  const dismissed = reduceRoomServiceBanner(recovered, {
    type: "dismiss_back_notice",
  });
  assert.equal(dismissed.showBackNotice, false);
});

it("does not show back notice when receiving ok without prior exhaustion", () => {
  const stillOk = reduceRoomServiceBanner(INITIAL_ROOM_SERVICE_BANNER, {
    type: "service_status",
    payload: {
      service: "llm",
      state: "ok",
      retry_at: null,
      message: "AI participants are back.",
    },
  });
  assert.equal(stillOk.llmState, "ok");
  assert.equal(stillOk.showBackNotice, false);
});

it("hydrates exhausted state and continue_without_ai from RoomSnapshot on reconnect", () => {
  const hydrated = reduceRoomServiceBanner(INITIAL_ROOM_SERVICE_BANNER, {
    type: "sync_snapshot",
    payload: {
      service: "llm",
      state: "exhausted",
      retry_at: "2026-11-27T14:30:00.000Z",
      message: "Paused.",
      continue_without_ai: true,
    },
  });
  assert.equal(hydrated.llmState, "exhausted");
  assert.equal(hydrated.continueWithoutAi, true);
  assert.equal(hydrated.showBackNotice, false);

  // Reconnecting after server recovered shows the back notice cleanly
  const reconnectedOk = reduceRoomServiceBanner(hydrated, {
    type: "sync_snapshot",
    payload: {
      service: "llm",
      state: "ok",
      retry_at: null,
      message: "AI participants are back.",
      continue_without_ai: false,
    },
  });
  assert.equal(reconnectedOk.llmState, "ok");
  assert.equal(reconnectedOk.continueWithoutAi, false);
  assert.equal(reconnectedOk.showBackNotice, true);
});

it("formats estimated resume countdowns accurately", () => {
  const baseMs = Date.parse("2026-11-27T14:00:00.000Z");

  assert.equal(formatEstimatedResume(null, baseMs), null);
  assert.equal(formatEstimatedResume("not-a-date", baseMs), null);
  assert.equal(
    formatEstimatedResume("2026-11-27T13:59:00.000Z", baseMs),
    "Estimated to resume shortly"
  );
  assert.equal(
    formatEstimatedResume("2026-11-27T14:00:40.000Z", baseMs),
    "Estimated to resume in about 1 minute"
  );
  assert.equal(
    formatEstimatedResume("2026-11-27T14:05:00.000Z", baseMs),
    "Estimated to resume in about 5 minutes"
  );
  assert.equal(
    formatEstimatedResume("2026-11-27T15:03:00.000Z", baseMs),
    "Estimated to resume in about 1 hour 3 minutes"
  );
  assert.equal(
    formatEstimatedResume("2026-11-27T16:00:00.000Z", baseMs),
    "Estimated to resume in about 2 hours"
  );
});

it("formats STT rate-limit messages with and without wait times", () => {
  assert.equal(
    formatSttRateLimitMessage(null),
    "Speech recognition is busy right now. Please try again in a moment."
  );
  assert.equal(
    formatSttRateLimitMessage(15),
    "Speech recognition is busy right now. Please try again in about 15 seconds."
  );
  assert.equal(
    formatSttRateLimitMessage(1),
    "Speech recognition is busy right now. Please try again in about 1 second."
  );
  assert.equal(
    formatSttRateLimitMessage(120),
    "Speech recognition is busy right now. Please try again in about 2 minutes."
  );
});

let passed = 0;
let failed = 0;
for (const tc of tests) {
  try {
    tc.fn();
    passed += 1;
    console.log(`PASS  ${tc.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${tc.name}`);
    console.error(err);
  }
}

console.log(`\nserviceStatus tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}

