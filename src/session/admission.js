/**
 * M5 会话与并发控制：准入、单会话互斥、排队与额度释放。
 * 只做策略，不碰执行与结果（D-01 M5）。
 */
export function createAdmission({ max_concurrency = 50, queue_limit = 50 } = {}) {
  const active = new Map(); // slot_id -> session_id
  const queue = [];

  return {
    request({ session_id, run_id }) {
      const runningSession = [...active.values()].includes(session_id);
      if (runningSession) {
        return { admit: false, reason: 'DUPLICATE_IN_SESSION', queue_position: 0 };
      }
      if (active.size >= max_concurrency) {
        if (queue.length >= queue_limit) {
          return { admit: false, reason: 'QUEUE_FULL', queue_position: queue.length };
        }
        queue.push({ session_id, run_id });
        return { admit: false, reason: 'QUEUED', queue_position: queue.length };
      }
      const slot_id = `slot-${run_id}`;
      active.set(slot_id, session_id);
      return { admit: true, slot_id };
    },

    release({ slot_id }) {
      const released = active.delete(slot_id);
      return { released };
    },

    get active_slots() {
      return active.size;
    },

    get queue_length() {
      return queue.length;
    },
  };
}
