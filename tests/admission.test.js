import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createControllableSandbox } from './helpers/fake-sandbox.js';

function build() {
  const sandbox = createControllableSandbox();
  const admission = createAdmission();
  const scheduler = createScheduler({ admission, sandbox, shaper: { shapeOutput }, now: () => 0 });
  return { sandbox, admission, scheduler };
}

describe('R-RUN-05 会话隔离与并发防重', () => {
  it('TC-17 同会话重复提交：置灰、不弹框、不产生第二次执行', async () => {
    const { sandbox, scheduler } = build();

    const first = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    const second = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 2,
      language: 'javascript',
      code: 'console.log(2)',
    });

    expect(second.error_code).toBe(4090);
    expect(second.dialog).toBeNull();
    expect(second.button_state).toBe('RUNNING_DISABLED');
    expect(sandbox.executions).toBe(1);

    sandbox.end('OK', { elapsed_ms: 0 });
    await first;
  });

  it('TC-24 单会话同时运行任务数 = 1', async () => {
    const { sandbox, scheduler } = build();

    const first = scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    const second = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 2,
      language: 'javascript',
      code: 'console.log(2)',
    });
    const third = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 3,
      language: 'javascript',
      code: 'console.log(3)',
    });

    expect(second.reason ?? second.error_code).toBe(4090);
    expect(third.error_code).toBe(4090);
    expect(sandbox.executions).toBe(1);

    sandbox.end('OK', { elapsed_ms: 0 });
    await first;
  });
});
