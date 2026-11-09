import { describe, it, expect } from 'vitest';
import { shapeOutput } from '../src/output/shaper.js';
import { renderResult } from '../src/editor/presenter.js';

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).length;

describe('R-RUN-03 输出量上限与截断', () => {
  it('TC-09 输出恰好 51200 字节时不截断', () => {
    const text = 'a'.repeat(51200);
    const display = shapeOutput({
      run_id: 'run-1',
      raw_chunks: [{ chunk_seq: 1, chunk: text }],
      total_bytes: 51200,
      limit_bytes: 51200,
    });

    expect(display.truncated).toBe(false);
    expect(display.truncated_at).toBe(0);
    expect(bytes(display.display_text)).toBe(51200);
    expect(display.escaped).toBe(false);
  });

  it('TC-10 200KB 输出被截断并提示', () => {
    const text = 'a'.repeat(204800);
    const display = shapeOutput({
      run_id: 'run-1',
      raw_chunks: [{ chunk_seq: 1, chunk: text }],
      total_bytes: 204800,
      limit_bytes: 51200,
    });
    const result = renderResult({
      run_id: 'run-1',
      status: 'SUCCEEDED',
      display_text: display.display_text,
      truncated: display.truncated,
      elapsed_ms: 0,
      error: null,
    });

    expect(display.truncated).toBe(true);
    expect(display.truncated_at).toBe(51200);
    expect(bytes(display.display_text)).toBe(51200);
    expect(result.display_text).toContain('输出已截断');
  });

  it('TC-11 截断点落在多字节字符中间时回退', () => {
    const text = '中'.repeat(20000); // 60000 字节
    const display = shapeOutput({
      run_id: 'run-1',
      raw_chunks: [{ chunk_seq: 1, chunk: text }],
      total_bytes: 60000,
      limit_bytes: 51200,
    });

    expect(display.truncated).toBe(true);
    expect(bytes(display.display_text)).toBe(51198);
    expect(display.display_text.endsWith('中')).toBe(true);
    expect(display.display_text.includes('\uFFFD')).toBe(false);
  });
});
