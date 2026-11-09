import { describe, it, expect } from 'vitest';
import { createScheduler } from '../src/scheduler/orchestrator.js';
import { createSandbox } from '../src/sandbox/runner.js';
import { shapeOutput } from '../src/output/shaper.js';
import { createAdmission } from '../src/session/admission.js';
import { createControllableSandbox, createInstantSandbox } from './helpers/fake-sandbox.js';

const SEVEN_LINES = Array.from({ length: 7 }, (_, i) => `let a${i + 1} = ${i + 1};`).join('\n');

function build({ sandbox = createSandbox({ now: () => 0 }), presenter, editor_line_count } = {}) {
  const admission = createAdmission();
  const scheduler = createScheduler({
    admission,
    sandbox,
    shaper: { shapeOutput },
    now: () => 0,
    setTimeoutFn: () => 1,
    clearTimeoutFn: () => {},
    presenter,
    editor_line_count,
  });
  return { scheduler, admission, sandbox };
}

describe('R-RUN-04 错误反馈与定位', () => {
  it('TC-12 语法错误不执行、高亮第 8 行', async () => {
    const { scheduler } = build();
    const code = `${SEVEN_LINES}\nconsole.log((1+1;`;
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('SYNTAX');
    expect(result.error.line_no).toBe(8);
    expect(result.display_text).toContain('第 8 行');
    expect(result.highlighted_line).toBe(8);
  });

  it('TC-13 运行时异常给行号、不回显堆栈', async () => {
    const { scheduler } = build();
    const code = `${SEVEN_LINES}\nconsole.log(a);`;
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code,
    });

    expect(result.status).toBe('FAILED');
    expect(result.error.kind).toBe('RUNTIME');
    expect(result.error.line_no).toBe(8);
    expect(result.display_text).toContain('第 8 行');
    expect(result.display_text.includes('at Object')).toBe(false);
    expect(result.highlighted_line).toBe(8);
  });

  it('TC-14 未知语言提示且不下发执行', async () => {
    const sandbox = createControllableSandbox();
    const { scheduler } = build({ sandbox });
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'python',
      code: 'print(1)',
    });

    expect(result.error_code).toBe(4002);
    expect(result.display_text).toContain('暂不支持该语言');
    expect(result.button_state).toBe('READY');
    expect(sandbox.executions).toBe(0);
  });

  it('TC-15 错误行号超出编辑器行数时只展示不高亮', async () => {
    const sandbox = createInstantSandbox({
      status: 'ERROR',
      extra: { error_kind: 'SYNTAX', line_no: 99, message: 'bad' },
    });
    const { scheduler } = build({ sandbox, editor_line_count: 20 });
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'x',
    });

    expect(result.display_text).toContain('第 99 行');
    expect(result.highlighted_line).toBeNull();
    expect(result.rendered).toBe(true);
  });

  it('TC-16 呈现失败时降级为纯文本', async () => {
    const sandbox = createInstantSandbox({
      status: 'ERROR',
      extra: { error_kind: 'RUNTIME', line_no: 8, message: 'boom' },
    });
    const presenter = {
      renderResult() {
        throw new Error('render failed');
      },
    };
    const { scheduler } = build({ sandbox, presenter });
    const result = await scheduler.submitRun({
      session_id: 'sess-1',
      trigger_seq: 1,
      language: 'javascript',
      code: 'x',
    });

    expect(result.rendered).toBe(false);
    expect(result.fallback_mode).toBe('PLAIN_TEXT');
    expect(result.display_text).toContain('第 8 行');
    expect(result.status).toBe('FAILED');
    expect(result.error.line_no).toBe(8);
  });
});
