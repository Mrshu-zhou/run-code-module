/**
 * 可控沙箱替身：execute 立即受理，帧由测试手动回放，用来验状态机与并发时序。
 * 支持多会话：帧按 run_id 路由，避免两个会话互相串。
 */
export function createControllableSandbox() {
  const emitFns = new Map();
  let lastRunId = null;
  let executions = 0;

  return {
    get executions() {
      return executions;
    },
    execute({ run_id, emit }) {
      executions += 1;
      lastRunId = run_id;
      emitFns.set(run_id, emit);
      return { accepted: true, started_at: 0 };
    },
    chunk(text, chunk_seq = 1, run_id = lastRunId) {
      emitFns.get(run_id)({ type: 'chunk', chunk_seq, stream: 'stdout', chunk: text });
    },
    end(status = 'OK', extra = {}, run_id = lastRunId) {
      emitFns.get(run_id)({
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
export function createInstantSandbox({ status = 'OK', elapsed_ms = 0, chunk = '', extra = {} } = {}) {
  return {
    async execute({ emit }) {
      if (chunk) {
        emit({ type: 'chunk', chunk_seq: 1, stream: 'stdout', chunk });
      }
      emit({ type: 'end', status, exit_code: status === 'OK' ? 0 : 1, elapsed_ms, ...extra });
      return { accepted: true, started_at: 0 };
    },
  };
}

/**
 * 失败沙箱替身：受理失败，用于验 5001 / 5002 降级。
 */
export function createFailingSandbox({ error_code = 5001, message = '执行环境异常' } = {}) {
  return {
    async execute() {
      return { accepted: false, error_code, message };
    },
  };
}

/**
 * 手动计时器：把 30s 帧超时压成测试里的一次 fire()。
 */
export function createManualTimer() {
  let callback = null;
  return {
    setTimeoutFn: (fn) => {
      callback = fn;
      return 1;
    },
    clearTimeoutFn: () => {
      callback = null;
    },
    fire: () => {
      const fn = callback;
      callback = null;
      if (fn) fn();
    },
  };
}
