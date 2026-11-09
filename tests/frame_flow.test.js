import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createControllableSandbox, createManualTimer } from './helpers/fake-sandbox.js';

function build({ timer } = {}) {
  const sandbox = createControllableSandbox();
  const admission = createAdmission();
  const scheduler = createScheduler({
    admission,
    sandbox,
    shaper: { shapeOutput },
    now: () => 0,
    frame_timeout_ms: 30000,
    setTimeoutFn: timer ? timer.setTimeoutFn : () => 1,
    clearTimeoutFn: timer ? timer.clearTimeoutFn : () => {},
  });
  return { sandbox, admission, scheduler };
}

describe('R-RUN-01 回调帧流', () => {
  it('TC-04 结束帧缺失 30s 后置失败并释放额度', async () => {
    const timer = createManualTimer();
    const { sandbox, admission, scheduler } = build({ timer });

    const pending = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log("line1")',
    });

    sandbox.chunk('line1\n');
    timer.fire();
    const result = await pending;

    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('ENV_ERROR');
    expect(result.display_text).toContain('line1');
    expect(admission.active_slots).toBe(0);
  });

  it('TC-05 增量帧乱序时按 chunk_seq 重排', async () => {
    const { sandbox, scheduler } = build();

    const pending = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log("a");console.log("b");console.log("c")',
    });

    sandbox.chunk('c\n', 3);
    sandbox.chunk('a\n', 1);
    sandbox.chunk('b\n', 2);
    sandbox.end('OK', { elapsed_ms: 0 });
    const result = await pending;

    expect(result.display_text).toBe('a\nb\nc\n');
    expect(result.status).toBe('SUCCEEDED');
  });
});
