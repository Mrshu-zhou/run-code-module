/**
 * M3 沙箱执行：负责执行、采集 stdout/stderr、回传增量帧与结束帧。
 * 本周为最小可跑实现：用受限参数遮蔽外联与宿主文件读取；
 * 真正的 Worker 隔离与 10s 强杀留到下周（见 W10 测试用例卡 TC-06/TC-25）。
 */
export function createSandbox({ now = () => performance.now() } = {}) {
  const stats = {
    outbound_attempts: 0,
    outbound_success: 0,
    host_file_read_attempts: 0,
    host_file_read_success: 0,
  };

  return {
    stats,
    async execute({ run_id, language, code, limits, session_id, emit }) {
      if (language !== 'javascript') {
        return { accepted: false, error_code: 4002, message: '暂不支持该语言' };
      }

      const started_at = now();
      const logs = [];
      const fakeConsole = { log: (...args) => logs.push(args.map(String).join(' ')) };
      const blockedOutbound = () => {
        stats.outbound_attempts += 1;
        throw new Error('SECURITY: outbound blocked');
      };
      const fakeHost = {
        readFile: () => {
          stats.host_file_read_attempts += 1;
          throw new Error('SECURITY: host file blocked');
        },
      };

      const pushLogs = () => {
        if (logs.length > 0) {
          emit({ type: 'chunk', chunk_seq: 1, stream: 'stdout', chunk: `${logs.join('\n')}\n` });
        }
      };

      try {
        const fn = new Function(
          'console',
          'fetch',
          'WebSocket',
          'XMLHttpRequest',
          '__host',
          'require',
          'process',
          `"use strict";\n${code}`,
        );
        fn(
          fakeConsole,
          blockedOutbound,
          blockedOutbound,
          blockedOutbound,
          fakeHost,
          () => {
            throw new Error('SECURITY: require blocked');
          },
          undefined,
        );
        pushLogs();
        emit({
          type: 'end',
          status: 'OK',
          exit_code: 0,
          elapsed_ms: now() - started_at,
          total_bytes: 0,
        });
      } catch (e) {
        pushLogs();
        const security = String(e.message).startsWith('SECURITY');
        emit({
          type: 'end',
          status: 'ERROR',
          exit_code: 1,
          error_kind: e instanceof SyntaxError ? 'SYNTAX' : security ? 'SECURITY' : 'RUNTIME',
          line_no: 0,
          message: e.message,
          elapsed_ms: now() - started_at,
        });
      }

      return { accepted: true, started_at };
    },
  };
}
