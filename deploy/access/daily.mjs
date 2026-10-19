// The daily Connections position. A puzzle moves on only after a day on which a
// signed-in student opened it; a day without visitors keeps it for the next day.
// Only the position and the last day it was seen are stored, never who saw it.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Days are the school's calendar days, whatever the server or a browser uses.
export const TIME_ZONE = 'America/Toronto';

export function schoolDay(time, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// One view on a day. A clock set back never brings a new puzzle.
export function advance(state, day) {
  if (state.viewed === day) return state;
  return { number: state.viewed !== null && state.viewed < day ? state.number + 1 : state.number, viewed: day };
}

const valid = (state) => Number.isSafeInteger(state?.number) && state.number >= 0 &&
  (state.viewed === null || (typeof state.viewed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.viewed)));

// `file` null keeps the position in memory only (tests and local checks).
export function createDailyRotation(file, { now = () => Date.now(), timeZone = TIME_ZONE, log = console.error } = {}) {
  let state = { number: 0, viewed: null };
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (valid(saved)) state = { number: saved.number, viewed: saved.viewed };
      else log(`Ignoring invalid daily puzzle state in ${file}; starting from the first puzzle.`);
    } catch (error) {
      if (error.code !== 'ENOENT') log(`Unable to read daily puzzle state: ${error.message}`);
    }
  }
  function save() {
    try {
      mkdirSync(dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(state));
      renameSync(temp, file);
    } catch (error) {
      // Keep serving from memory; the next successful save catches up.
      log(`Unable to save daily puzzle state: ${error.message}`);
    }
  }
  return {
    /** Today's puzzle number, counting this request as today's view. */
    view() {
      const day = schoolDay(now(), timeZone);
      const next = advance(state, day);
      if (next !== state) { state = next; if (file) save(); }
      return { number: state.number, date: day };
    },
  };
}
