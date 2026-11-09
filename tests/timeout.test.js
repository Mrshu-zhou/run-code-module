import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { createSandbox } from '../src/sandbox/runner.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createControllableSandbox, createInstantSandbox } from './helpers/fake-sandbox.js';

function build(sandbox) {
  const admission = createAdmission();
  return {
    admission,
    scheduler: createScheduler({ admission, sandbox, shaper: { shapeOutput }, now: () => 0 }),
  };
}

describe('R-RUN-02 超时终止并保留已输出', () => {
  it('TC-06 死循环 10s 强杀并保留已输出', async () => {
    const sandbox = createControllableSandbox();
    const { scheduler, admission } = build(sandbox);

    const pending = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'while(true){}',
    });

    sandbox.chunk('line1\nline2\n');
    sandbox.end('TIMEOUT', { elapsed_ms: 10000 });
    const result = await pending;

    expect(result.status).toBe('TIMEOUT');
    expect(result.display_text.startsWith('line1')).toBe(true);
    expect(result.display_text).toContain('line2');
    expect(result.elapsed_ms / 1000).toBeGreaterThanOrEqual(9.5);
    expect(result.elapsed_ms / 1000).toBeLessThanOrEqual(10.5);
    expect(result.truncated).toBe(false);
    expect(admission.active_slots).toBe(0);
  });

  it('TC-07 9.999s 不超时、10.000s 超时', async () => {
    const under = build(createInstantSandbox({ status: 'OK', elapsed_ms: 9999 })).scheduler;
    const boundary = build(createInstantSandbox({ status: 'TIMEOUT', elapsed_ms: 10000 })).scheduler;

    const run9999 = await under.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'busy()',
    });
    const run10000 = await boundary.submitRun({
      session_id: 'sess-2',
      trigger_seq: 1,
      language: 'javascript',
      code: 'busy()',
    });

    expect(run9999.status).toBe('SUCCEEDED');
    expect(run10000.status).toBe('TIMEOUT');
    expect(Math.abs(run10000.elapsed_ms - 10000)).toBeLessThanOrEqual(500);
  });

  it('TC-08 超时后额度归还，可立即再次运行', async () => {
    const sandbox = createControllableSandbox();
    const { scheduler, admission } = build(sandbox);

    const first = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'while(true){}',
    });
    expect(admission.active_slots).toBe(1);
    sandbox.end('TIMEOUT', { elapsed_ms: 10000 });
    const firstResult = await first;
    expect(firstResult.status).toBe('TIMEOUT');
    expect(admission.active_slots).toBe(0);

    const second = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 2,
      language: 'javascript',
      code: 'console.log(1)',
    });
    sandbox.chunk('1\n');
    sandbox.end('OK', { elapsed_ms: 0 });
    const secondResult = await second;

    expect(secondResult.status).toBe('SUCCEEDED');
    expect(admission.active_slots).toBe(0);
  });
});
