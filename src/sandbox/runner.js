const PARAMS = ['console', 'fetch', 'WebSocket', 'XMLHttpRequest', '__host', 'require', 'process'];

function detectSyntaxLine(code) {
  const lines = code.split('\n');
  for (let i = 1; i <= lines.length; i += 1) {
    try {
      // eslint-disable-next-line no-new-func
      new Function(...PARAMS, lines.slice(0, i).join('\n'));
    } catch (e) {
      if (e instanceof SyntaxError) return i;
    }
  }
  return 0;
}

function parseRuntimeLine(stack) {
  const match = String(stack ?? '').match(/<anonymous>:(\d+):(\d+)/);
  if (!match) return 0;
  // new Function 的函数头占 2 行，源码第 1 行对应 anonymous 第 3 行
  return Math.max(1, Number(match[1]) - 2);
}

/**
 * M3 沙箱执行：负责执行、采集 stdout/stderr、回传增量帧与结束帧。
 * 本周为最小可跑实现：用受限参数遮蔽外联与宿主文件读取；
 * 真正的 Worker 隔离与 10s 强杀留到下一批（见 W10 测试用例卡 TC-06/TC-25）。
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
        // 不前置 "use strict"，避免行号偏移；参数遮蔽挡掉外联与宿主文件
        // eslint-disable-next-line no-new-func
        const fn = new Function(...PARAMS, code);
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
        const syntax = e instanceof SyntaxError;
        emit({
          type: 'end',
          status: 'ERROR',
          exit_code: 1,
          error_kind: syntax ? 'SYNTAX' : security ? 'SECURITY' : 'RUNTIME',
          line_no: syntax ? detectSyntaxLine(code) : parseRuntimeLine(e.stack),
          message: e.message,
          elapsed_ms: now() - started_at,
        });
      }

      return { accepted: true, started_at };
    },
  };
}
