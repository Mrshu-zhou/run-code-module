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
  frame_timeout_ms = 30000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  editor_line_count = Infinity,
}) {
  let seq = 0;

  const buildDisplay = (shaped, error) => {
    if (!error) return shaped.display_text;
    const head = error.line_no ? `第 ${error.line_no} 行：` : '';
    const body = `${head}${error.message ?? ''}`.trim();
    return shaped.display_text ? `${shaped.display_text}\n${body}` : body;
  };

  const safeRender = (payload) => {
    try {
      return { ok: true, value: presenter.renderResult({ ...payload, editor_line_count }) };
    } catch (e) {
      return {
        ok: false,
        value: {
          rendered: false,
          fallback_mode: 'PLAIN_TEXT',
          run_id: payload.run_id,
          status: payload.status,
          display_text: payload.display_text,
          truncated: payload.truncated,
          elapsed_ms: payload.elapsed_ms,
          error: payload.error,
          highlighted_line: payload.error?.line_no ?? null,
          button_state: 'READY',
          dialog: null,
        },
      };
    }
  };

  return {
    async submitRun({ session_id, trigger_seq, language, code }) {
      const submitted_at = now();

      if (!session_id || trigger_seq === undefined || !language || code === undefined) {
        return {
          run_id: '',
          accepted_at: submitted_at,
          error_code: 4001,
          message: '运行请求不完整',
          display_text: '运行请求不完整',
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
          display_text: '暂不支持该语言',
          retryable: false,
          dialog: null,
          button_state: 'READY',
        };
      }

      const run_id = `run-${++seq}`;
      let admit;
      try {
        admit = admission.request({ session_id, run_id });
      } catch (e) {
        return {
          run_id,
          accepted_at: submitted_at,
          error_code: 5000,
          reason: 'SERVICE_UNAVAILABLE',
          message: '系统繁忙，请稍后重试',
          display_text: '系统繁忙，请稍后重试',
          retryable: true,
          dialog: null,
          button_state: 'READY',
        };
      }

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
        if (admit.reason === 'QUEUE_FULL') {
          return {
            run_id,
            accepted_at: submitted_at,
            error_code: 5003,
            reason: 'QUEUE_FULL',
            queue_position: admit.queue_position,
            message: '当前排队已满，请稍后重试',
            display_text: '当前排队已满，请稍后重试',
            retryable: true,
            dialog: null,
            button_state: 'RUNNING_DISABLED',
            status: 'QUEUED',
          };
        }
        return {
          run_id,
          accepted_at: submitted_at,
          error_code: 5003,
          reason: 'QUEUED',
          queue_position: admit.queue_position,
          message: '排队中',
          display_text: '排队中',
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

      let timedOut = false;
      let timer;
      const timeoutPromise = new Promise((resolve) => {
        timer = setTimeoutFn(() => {
          timedOut = true;
          resolve();
        }, frame_timeout_ms);
      });

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
        clearTimeoutFn(timer);
        admission.release({ slot_id: admit.slot_id });
        const result = safeRender({
          run_id,
          status: 'FAILED',
          display_text: '执行环境异常，请重试',
          truncated: false,
          elapsed_ms: now() - submitted_at,
          error: { kind: 'ENV_ERROR' },
        });
        return {
          ...result.value,
          accepted: false,
          error_code: accepted?.error_code ?? 5001,
          accepted_at: submitted_at,
        };
      }

      const accepted_at = now();
      await Promise.race([endPromise, timeoutPromise]);
      if (!timedOut) clearTimeoutFn(timer);

      const total_bytes = frames.reduce((n, f) => n + byteLength(f.chunk ?? ''), 0);

      let shaped;
      try {
        shaped = shaper.shapeOutput({
          run_id,
          raw_chunks: frames,
          total_bytes,
          limit_bytes: 51200,
        });
      } catch (e) {
        shaped = {
          display_text: frames.map((f) => f.chunk ?? '').join(''),
          truncated: false,
          truncated_at: 0,
          escaped: false,
        };
      }

      const status = timedOut
        ? 'FAILED'
        : endFrame?.status === 'OK'
          ? 'SUCCEEDED'
          : endFrame?.status === 'TIMEOUT'
            ? 'TIMEOUT'
            : 'FAILED';

      const error = timedOut
        ? { kind: 'ENV_ERROR', message: '执行环境异常，请重试' }
        : status === 'FAILED'
          ? {
              kind: endFrame?.error_kind ?? 'RUNTIME',
              line_no: endFrame?.line_no ?? 0,
              message: endFrame?.message ?? '',
            }
          : null;

      const rendered = safeRender({
        run_id,
        status,
        display_text: buildDisplay(shaped, error),
        truncated: shaped.truncated,
        elapsed_ms: timedOut ? now() - submitted_at : (endFrame?.elapsed_ms ?? now() - submitted_at),
        error,
      });

      admission.release({ slot_id: admit.slot_id });

      return {
        ...rendered.value,
        accepted: true,
        accepted_at,
        total_bytes,
        truncated_at: shaped.truncated_at,
        escaped: shaped.escaped,
      };
    },
  };
}
