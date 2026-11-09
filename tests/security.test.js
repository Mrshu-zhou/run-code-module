import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { createSandbox } from '../src/sandbox/runner.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';

function build() {
  const sandbox = createSandbox({ now: () => 0 });
  const admission = createAdmission();
  const scheduler = createScheduler({ admission, sandbox, shaper: { shapeOutput }, now: () => 0 });
  return { sandbox, scheduler };
}

describe('C-RUN-02 执行环境安全（可计数）', () => {
  it('TC-21 沙箱外联成功次数 = 0', async () => {
    const { sandbox, scheduler } = build();
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'fetch("https://example.com")',
    });

    expect(sandbox.stats.outbound_attempts).toBeGreaterThanOrEqual(1);
    expect(sandbox.stats.outbound_success).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('SECURITY');
    expect(result.accepted).toBe(true);
  });

  it('TC-22 读取宿主文件成功次数 = 0', async () => {
    const { sandbox, scheduler } = build();
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: '__host.readFile("/etc/passwd")',
    });

    expect(sandbox.stats.host_file_read_attempts).toBeGreaterThanOrEqual(1);
    expect(sandbox.stats.host_file_read_success).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('SECURITY');
  });

  it('TC-23 输出区可执行脚本数量 = 0', async () => {
    const { scheduler } = build();
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'console.log("<script>alert(1)</script>")',
    });

    expect(result.status).toBe('SUCCEEDED');
    expect(result.escaped).toBe(true);
    expect(result.display_text).toContain('&lt;script&gt;');
    expect(result.display_text.includes('<script')).toBe(false);
  });
});
