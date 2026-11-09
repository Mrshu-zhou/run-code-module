import { renderResult } from '../editor/presenter.js';

const encoder = new TextEncoder();

function byteLength(text) {
  return encoder.encode(text).length;
}

/**
 * M2 执行调度：受理、生成运行号、编排 M5 / M3 / M4 / M1，维护运行结果。
 * 只做编排与状态，不实际执行、不做截断计算、不做呈现（D-01 M2）。
 */
export function createScheduler({
  admission,
  sandbox,
  shaper,
  presenter = { renderResult },
  now = () => performance.now(),
  languageWhitelist = ['javascript'],
}) {
  let seq = 0;

  return {
    async submitRun({ session_id, trigger_seq, language, code }) {
      const submitted_at = now();

      if (!session_id || trigger_seq === undefined || !language || code === undefined) {
        return {
          run_id: '',
          accepted_at: submitted_at,
          error_code: 4001,
          message: '运行请求不完整',
          retryable: false,
          dialog: null,
          button_state: 'READY',
        };
      }

      if (!languageWhitelist.includes(language)) {
        return {
          run_id: '',
          accepted_at: submitted_at,
          error_code: 4002,
          message: '暂不支持该语言',
          retryable: false,
          dialog: null,
          button_state: 'READY',
        };
      }

      const run_id = `run-${++seq}`;
      const admit = admission.request({ session_id, run_id });

      if (!admit.admit) {
        if (admit.reason === 'DUPLICATE_IN_SESSION') {
          return {
            run_id,
            accepted_at: submitted_at,
            error_code: 4090,
            message: '',
            retryable: false,
            dialog: null,
            button_state: 'RUNNING_DISABLED',
            status: 'RUNNING',
          };
        }
        return {
          run_id,
          accepted_at: submitted_at,
          error_code: 5003,
          message:
            admit.reason === 'QUEUE_FULL'
              ? '当前排队已满，请稍后重试'
              : '排队中',
          retryable: true,
          dialog: null,
          button_state: 'RUNNING_DISABLED',
          status: 'QUEUED',
        };
      }

      const frames = [];
      let endFrame = null;
      let resolveEnd;
      const endPromise = new Promise((resolve) => {
        resolveEnd = resolve;
      });

      const emit = (frame) => {
        if (!frame) return;
        if (frame.type === 'chunk') {
          frames.push(frame);
          return;
        }
        endFrame = frame;
        resolveEnd();
      };

      let accepted;
      try {
        accepted = await sandbox.execute({
          run_id,
          language,
          code,
          limits: { timeout_ms: 10000, mem_mb: 256 },
          session_id,
          emit,
        });
      } catch (e) {
        accepted = { accepted: false, error_code: 5001, message: e.message };
      }

      if (!accepted || accepted.accepted === false) {
        admission.release({ slot_id: admit.slot_id });
        const result = presenter.renderResult({
          run_id,
          status: 'FAILED',
          display_text: '执行环境异常，请重试',
          truncated: false,
          elapsed_ms: now() - submitted_at,
          error: { kind: 'ENV_ERROR' },
        });
        return {
          ...result,
          accepted: false,
          error_code: accepted?.error_code ?? 5001,
          accepted_at: submitted_at,
        };
      }

      const accepted_at = now();
      await endPromise;

      const total_bytes = frames.reduce((n, f) => n + byteLength(f.chunk ?? ''), 0);
      const shaped = shaper.shapeOutput({
        run_id,
        raw_chunks: frames,
        total_bytes,
        limit_bytes: 51200,
      });

      const status =
        endFrame.status === 'OK' ? 'SUCCEEDED' : endFrame.status === 'TIMEOUT' ? 'TIMEOUT' : 'FAILED';

      const error =
        status === 'FAILED'
          ? {
              kind: endFrame.error_kind ?? 'RUNTIME',
              line_no: endFrame.line_no ?? 0,
              message: endFrame.message ?? '',
            }
          : null;

      const result = presenter.renderResult({
        run_id,
        status,
        display_text: shaped.display_text,
        truncated: shaped.truncated,
        elapsed_ms: endFrame.elapsed_ms ?? now() - submitted_at,
        error,
      });

      admission.release({ slot_id: admit.slot_id });

      return {
        ...result,
        accepted: true,
        accepted_at,
        total_bytes,
        truncated_at: shaped.truncated_at,
        escaped: shaped.escaped,
      };
    },
  };
}
