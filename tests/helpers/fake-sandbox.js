/**
 * 可控沙箱替身：execute 立即受理，帧由测试手动回放，用来验状态机与并发时序。
 */
export function createControllableSandbox() {
  let emitFn = null;
  let executions = 0;

  return {
    get executions() {
      return executions;
    },
    execute({ emit }) {
      executions += 1;
      emitFn = emit;
      return { accepted: true, started_at: 0 };
    },
    chunk(text, chunk_seq = 1) {
      emitFn({ type: 'chunk', chunk_seq, stream: 'stdout', chunk: text });
    },
    end(status = 'OK', extra = {}) {
      emitFn({
        type: 'end',
        status,
        exit_code: status === 'OK' ? 0 : 1,
        elapsed_ms: 0,
        ...extra,
      });
    },
  };
}

/**
 * 即时沙箱替身：execute 内直接回结束帧，用来验阈值边界。
 */
export function createInstantSandbox({ status = 'OK', elapsed_ms = 0, chunk = '' } = {}) {
  return {
    async execute({ emit }) {
      if (chunk) {
        emit({ type: 'chunk', chunk_seq: 1, stream: 'stdout', chunk });
      }
      emit({ type: 'end', status, exit_code: status === 'OK' ? 0 : 1, elapsed_ms });
      return { accepted: true, started_at: 0 };
    },
  };
}

/**
 * 失败沙箱替身：受理失败，用于验 5001 降级。
 */
export function createFailingSandbox({ error_code = 5001 } = {}) {
  return {
    async execute() {
      return { accepted: false, error_code, message: '执行环境异常' };
    },
  };
}
