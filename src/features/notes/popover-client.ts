/**
 * Client behaviour for inline popovers (<Term> and <Q>).
 *
 * Triggers are <span role="button" data-pop="<popover id>"> so they wrap like
 * text; this script gives them button behaviour (click, Enter, Space) and opens
 * the native popover="auto" element, which handles Escape and light dismiss.
 * It also positions the card next to its trigger and records which key terms a
 * student has explored on this page.
 */

const MARGIN = 12;
const GAP = 10;

const popFor = (trigger: HTMLElement) => document.getElementById(trigger.dataset.pop!);
const triggerFor = (pop: HTMLElement) => document.querySelector<HTMLElement>(`[data-pop="${CSS.escape(pop.id)}"]`);

function place(pop: HTMLElement) {
  const anchor = triggerFor(pop);
  if (!anchor) return;
  // A wrapped trigger has several boxes; anchor to the one that was clicked
  // (approximated by the first line box).
  const r = anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - pw / 2), vw - pw - MARGIN);
  let top = r.bottom + GAP;
  if (top + ph > vh - MARGIN && r.top - GAP - ph >= MARGIN) top = r.top - GAP - ph;
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  pop.dataset.side = top < r.top ? 'above' : 'below';
}

// ---------- key-term progress ----------

const storageKey = () => `seen-terms:${location.pathname}`;

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey()) ?? '[]'));
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(storageKey(), JSON.stringify([...seen]));
  } catch {
    /* storage unavailable — progress lasts for this visit only */
  }
}

function renderProgress(seen: Set<string>) {
  const triggers = [...document.querySelectorAll<HTMLElement>('[data-term]')];
  const all = new Set(triggers.map((el) => el.dataset.term!));
  for (const el of triggers) el.toggleAttribute('data-seen', seen.has(el.dataset.term!));
  const explored = [...all].filter((id) => seen.has(id)).length;
  for (const out of document.querySelectorAll<HTMLElement>('[data-term-progress]')) {
    out.querySelector('[data-count]')!.textContent = String(explored);
    out.querySelector('[data-total]')!.textContent = String(all.size);
    const bar = out.querySelector<HTMLElement>('[data-bar]');
    if (bar) bar.style.width = `${all.size ? (explored / all.size) * 100 : 0}%`;
    out.toggleAttribute('data-complete', all.size > 0 && explored === all.size);
  }
}

// ---------- wiring (once per page, however many components include this) ----------

type Flagged = Window & { __notesPopovers?: boolean };

if (!(window as Flagged).__notesPopovers) {
  (window as Flagged).__notesPopovers = true;
  const seen = loadSeen();
  renderProgress(seen);
  let openPop: HTMLElement | null = null;
  // Light dismiss closes an open popover on pointerdown — before the click on
  // its own trigger arrives. Remember that, so the click doesn't reopen it.
  let closedByThisPress: HTMLElement | null = null;

  const toggle = (trigger: HTMLElement) => {
    const pop = popFor(trigger);
    if (!pop) return;
    if (closedByThisPress === pop) {
      closedByThisPress = null;
      return;
    }
    pop.togglePopover();
  };

  document.addEventListener(
    'pointerdown',
    (e) => {
      const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-pop]');
      const pop = trigger && popFor(trigger);
      closedByThisPress = pop && pop.matches(':popover-open') ? pop : null;
    },
    true,
  );

  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const trigger = target.closest<HTMLElement>('[data-pop]');
    if (trigger) {
      toggle(trigger);
      return;
    }
    if (target.closest('[data-term-reset]')) {
      e.preventDefault();
      seen.clear();
      saveSeen(seen);
      renderProgress(seen);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-pop]');
    if (!trigger) return;
    e.preventDefault();
    closedByThisPress = null;
    toggle(trigger);
  });

  // `toggle` does not bubble; listen in the capture phase.
  document.addEventListener(
    'toggle',
    (event) => {
      const pop = event.target as HTMLElement;
      if (!pop.matches?.('.note-pop')) return;
      const open = (event as ToggleEvent).newState === 'open';
      triggerFor(pop)?.setAttribute('aria-expanded', String(open));
      if (open) {
        openPop = pop;
        place(pop);
        const id = pop.dataset.termId;
        if (id && !seen.has(id)) {
          seen.add(id);
          saveSeen(seen);
          renderProgress(seen);
        }
      } else if (openPop === pop) {
        openPop = null;
      }
    },
    true,
  );

  const reposition = () => openPop && place(openPop);
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition);
}
