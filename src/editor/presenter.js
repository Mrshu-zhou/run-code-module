/**
 * M1 编辑与呈现：把结果放到输出区，维护按钮态与错误行高亮。
 * 不二次改写文本（转义只在 M4 做），不参与执行与并发（D-01 M1）。
 */
export function renderResult({
  run_id,
  status,
  display_text = '',
  truncated = false,
  elapsed_ms = 0,
  error = null,
  button_state = 'READY',
  dialog = null,
}) {
  const text = truncated ? `${display_text}\n[输出已截断]` : display_text;
  return {
    rendered: true,
    run_id,
    status,
    display_text: text,
    truncated,
    elapsed_ms,
    error,
    highlighted_line: error?.line_no ?? null,
    button_state,
    dialog,
  };
}
