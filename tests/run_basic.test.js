import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { createSandbox } from '../src/sandbox/runner.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createFailingSandbox, createInstantSandbox } from './helpers/fake-sandbox.js';

function buildScheduler({ sandbox = createSandbox(), admission = createAdmission(), now = () => 0 } = {}) {
  return {
    scheduler: createScheduler({ admission, sandbox, shaper: { shapeOutput }, now }),
    admission,
    sandbox,
  };
}

describe('R-RUN-01 点击运行返回结果', () => {
  it('TC-01 正常执行返回结果', async () => {
    const { scheduler } = buildScheduler();
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1+1)',
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.display_text).toContain('2');
    expect(result.error).toBeNull();
    expect(result.elapsed_ms).toBeLessThanOrEqual(3000);
  });

  it('TC-02 沙箱不可用提示且不白屏', async () => {
    const { scheduler } = buildScheduler({ sandbox: createFailingSandbox({ error_code: 5001 }) });
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    expect(result.accepted).toBe(false);
    expect(result.error_code).toBe(5001);
    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('ENV_ERROR');
    expect(result.display_text).toContain('执行环境异常');
    expect(result.rendered).toBe(true);
  });

  it('TC-03 提交应答在 1s 内返回', async () => {
    let t = 0;
    const clock = {
      now: () => t,
      advance: (ms) => {
        t += ms;
      },
    };
    const sandbox = {
      async execute({ emit }) {
        clock.advance(800);
        emit({ type: 'end', status: 'OK', exit_code: 0, elapsed_ms: 800 });
        return { accepted: true, started_at: 0 };
      },
    };
    const { scheduler } = buildScheduler({ sandbox, now: clock.now });
    const t0 = clock.now();
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log(1)',
    });

    expect(result.run_id).not.toBe('');
    expect(result.accepted_at - t0).toBeLessThanOrEqual(1000);
    expect(result.accepted_at - t0).toBe(800);
  });
});
