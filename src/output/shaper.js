const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: false });

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text) {
  let changed = false;
  const out = text.replace(/[&<>"']/g, (ch) => {
    changed = true;
    return HTML_ESCAPES[ch];
  });
  return { text: out, changed };
}

function utf8Bytes(text) {
  return encoder.encode(text);
}

/**
 * M4 输出处理：把原始增量帧整形为可展示文本，并按 limit_bytes 截断。
 * 纯同步函数，不碰执行与界面（D-01 M4）。
 */
export function shapeOutput({ run_id, raw_chunks = [], total_bytes, limit_bytes = 51200 }) {
  const raw = raw_chunks
    .slice()
    .sort((a, b) => (a.chunk_seq ?? 0) - (b.chunk_seq ?? 0))
    .map((f) => (typeof f === 'string' ? f : f.chunk ?? ''))
    .join('');

  const total = total_bytes ?? utf8Bytes(raw).length;
  let text = raw;
  let truncated = false;
  let truncated_at = 0;

  if (total > limit_bytes) {
    truncated = true;
    const bytes = utf8Bytes(raw);
    let cut = Math.min(limit_bytes, bytes.length);
    // 断点落在多字节字符中间时，向前回退到该字符起始位置
    while (cut > 0 && (bytes[cut] & 0xc0) === 0x80) {
      cut -= 1;
    }
    truncated_at = cut;
    text = decoder.decode(bytes.subarray(0, cut));
  }

  const escapedResult = escapeHtml(text);
  return {
    run_id,
    display_text: escapedResult.text,
    truncated,
    truncated_at,
    escaped: escapedResult.changed,
    total_bytes: total,
  };
}
