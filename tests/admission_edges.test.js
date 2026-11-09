import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createControllableSandbox } from './helpers/fake-sandbox.js';

function build({ admission = createAdmission(), sandbox = createControllableSandbox() } = {}) {
  const scheduler = createScheduler({
    admission,
    sandbox,
    shaper: { shapeOutput },
    now: () => 0,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
  });
  return { scheduler, admission, sandbox };
}

describe('R-RUN-05 准入边界', () => {
  it('TC-18 队列满提示且不丢弃请求', async () => {
    const admission = createAdmission({ max_concurrency: 1, queue_limit: 1 });
    admission.request({ session_id: 'sess-a', run_id: 'r-a' });
    admission.request({ session_id: 'sess-b', run_id: 'r-b' });

    const { scheduler, sandbox } = build({ admission });
    const result = await scheduler.submitRun({
      session_id: 'sess-c',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    expect(result.reason).toBe('QUEUE_FULL');
    expect(result.queue_position).toBeGreaterThan(0);
    expect(result.display_text).toContain('当前排队已满');
    expect(result.error_code).toBe(5003);
    expect(sandbox.executions).toBe(0);
  });

  it('TC-19 两会话并发互不干扰', async () => {
    const { scheduler, sandbox } = build();

    const runA = scheduler.submitRun({
      session_id: 'sess-A',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log("A-OK")',
    });
    const runB = scheduler.submitRun({
      session_id: 'sess-B',
      trigger_seq: 1,
      language: 'javascript',
      code: 'throw new Error("B")',
    });

    sandbox.chunk('A-OK\n', 1, 'run-1');
    sandbox.end('OK', { elapsed_ms: 0 }, 'run-1');
    sandbox.end('ERROR', { error_kind: 'RUNTIME', line_no: 0, message: 'B' }, 'run-2');

    const [a, b] = await Promise.all([runA, runB]);

    expect(a.run_id).not.toBe(b.run_id);
    expect(a.display_text).toContain('A-OK');
    expect(a.status).toBe('SUCCEEDED');
    expect(b.status).toBe('FAILED');
    expect(a.display_text.includes('B')).toBe(false);
  });

  it('TC-20 准入不可用时保守拒绝', async () => {
    const admission = {
      request() {
        throw new Error('admission down');
      },
      release() {
        return { released: false };
      },
    };
    const { scheduler, sandbox } = build({ admission });
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    expect(result.error_code).toBe(5000);
    expect(result.reason).toBe('SERVICE_UNAVAILABLE');
    expect(result.display_text).toContain('系统繁忙');
    expect(result.retryable).toBe(true);
    expect(sandbox.executions).toBe(0);
  });
});
