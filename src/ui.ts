import { formatClock, PRESETS, type Phase } from './session.ts';
import type { Prefs } from './prefs.ts';

export type Handlers = {
  minutes(value: number): void;
  warmup(): void;
  water(): void;
  bowl(): void;
  scene(id: string | 1 | -1): void;
  start(): void;
  skip(): void;
  cancel(): void;
  end(): void;
  credits(): Promise<string>;
};

const REVEAL_MS = 4000;
const STEP_PX = 26;

const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export function createUi(on: Handlers) {
  const app = $('.app');
  const minutes = $('.minutes');
  const value = $('.minutes .value');
  const warmup = $('.warmup');
  const water = $('.water');
  const bowl = $('.bowl');
  const clock = $('.clock');
  const ring = $<SVGCircleElement>('.countdown .ring circle');
  const credits = $<HTMLDialogElement>('.credits');
  let current: Prefs | null = null;
  let revealTimer = 0;

  const click = (selector: string, handler: () => void) => $(selector).addEventListener('click', handler);
  click('.warmup', on.warmup);
  click('.water', on.water);
  click('.bowl', on.bowl);
  click('.start', on.start);
  click('.skip', on.skip);
  click('.cancel', on.cancel);
  click('.end', on.end);
  click('.reveal', () => reveal());
  $('.running').addEventListener('focusin', () => reveal());
  click('.info', async () => {
    renderCredits($('.credits-body'), await on.credits());
    credits.showModal();
  });
  for (const preset of document.querySelectorAll<HTMLButtonElement>('.presets button')) {
    preset.addEventListener('click', () => on.minutes(Number(preset.dataset.minutes)));
  }
  for (const dot of document.querySelectorAll<HTMLButtonElement>('.dots button')) {
    dot.addEventListener('click', () => on.scene(dot.dataset.scene!));
  }

  minutes.addEventListener('keydown', event => {
    const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[event.key];
    if (!step || !current) return;
    event.preventDefault();
    on.minutes(current.minutes + step);
  });
  minutes.addEventListener('wheel', event => {
    event.preventDefault();
    if (current) on.minutes(current.minutes + (event.deltaY < 0 ? 1 : -1));
  }, { passive: false });

  minutes.addEventListener('pointerdown', event => {
    if (!current) return;
    const startY = event.clientY;
    const startValue = current.minutes;
    minutes.setPointerCapture(event.pointerId);
    minutes.classList.add('dragging');
    const move = (e: PointerEvent) => {
      const next = startValue + Math.round((startY - e.clientY) / STEP_PX);
      if (current && next !== current.minutes) {
        on.minutes(next);
        navigator.vibrate?.(3);
      }
    };
    const up = () => {
      minutes.classList.remove('dragging');
      minutes.removeEventListener('pointermove', move);
    };
    minutes.addEventListener('pointermove', move);
    minutes.addEventListener('pointerup', up, { once: true });
    minutes.addEventListener('pointercancel', up, { once: true });
  });

  app.addEventListener('pointerdown', event => {
    const target = event.target as Element;
    if (app.dataset.phase === 'warmup' || app.dataset.phase === 'meditation') {
      if (!target.closest('.actions button')) reveal();
      return;
    }
    if (target.closest('button, .minutes, dialog')) return;
    const { clientX: x0, clientY: y0 } = event;
    app.addEventListener('pointerup', e => {
      const dx = e.clientX - x0;
      if (Math.abs(dx) > 48 && Math.abs(dx) > 2 * Math.abs(e.clientY - y0)) on.scene(dx < 0 ? 1 : -1);
    }, { once: true });
  });

  addEventListener('keydown', event => {
    if (app.dataset.phase === 'warmup' || app.dataset.phase === 'meditation') {
      if (!app.classList.contains('revealed')) {
        reveal();
        if (event.key !== 'Tab') event.preventDefault();
      }
    }
  });

  // Controls stay while they hold focus, so keyboard and screen-reader users
  // are never left on a control that vanishes.
  function reveal() {
    setRevealed(true);
    clearTimeout(revealTimer);
    revealTimer = window.setTimeout(() => {
      const focus = document.activeElement;
      const held = $('.actions').contains(focus) || (focus === $('.reveal') && focus.matches(':focus-visible'));
      if (held) reveal();
      else setRevealed(false);
    }, REVEAL_MS);
  }

  function setRevealed(revealed: boolean) {
    app.classList.toggle('revealed', revealed);
    $('.reveal').setAttribute('aria-expanded', String(revealed));
  }

  return {
    setPhase(phase: Phase) {
      const running = phase === 'warmup' || phase === 'meditation';
      if (!running) {
        setRevealed(false);
        clearTimeout(revealTimer);
      }
      app.dataset.phase = running ? phase : 'idle';
      $('.setup').inert = running;
      $('.running').inert = !running;
      if (!running && document.activeElement === document.body) $<HTMLButtonElement>('.start').focus({ preventScroll: true });
    },

    renderSetup(prefs: Prefs, bowlIndex: number, bowlCount: number) {
      current = prefs;
      value.textContent = String(prefs.minutes);
      minutes.setAttribute('aria-valuenow', String(prefs.minutes));
      for (const preset of document.querySelectorAll<HTMLButtonElement>('.presets button')) {
        preset.setAttribute('aria-pressed', String(Number(preset.dataset.minutes) === prefs.minutes));
      }
      $('.presets').classList.toggle('custom', !PRESETS.includes(prefs.minutes));
      warmup.style.setProperty('--fill', String(prefs.warmup));
      warmup.querySelector('.seconds')!.textContent = prefs.warmup ? String(prefs.warmup) : '';
      warmup.setAttribute('aria-label', prefs.warmup ? `Warm-up ${prefs.warmup} seconds` : 'Warm-up off');
      water.setAttribute('aria-pressed', String(prefs.water));
      bowl.setAttribute('aria-label', `Bowl ${bowlIndex + 1} of ${Math.max(1, bowlCount)}`);
      bowl.querySelector('.pips')!.replaceChildren(...Array.from({ length: bowlCount }, (_, i) => {
        const pip = document.createElement('i');
        if (i === bowlIndex) pip.className = 'on';
        return pip;
      }));
      for (const dot of document.querySelectorAll<HTMLButtonElement>('.dots button')) {
        dot.setAttribute('aria-pressed', String(dot.dataset.scene === prefs.scene));
      }
    },

    renderClock(phase: Phase, remainingMs: number, fraction: number) {
      clock.textContent = phase === 'warmup' ? String(Math.ceil(remainingMs / 1000)) : formatClock(remainingMs);
      ring.style.strokeDashoffset = String(Math.round(1000 * (1 - fraction)));
    },

    chime: () => pulse(bowl, 'chiming'),
    refuse: () => pulse($('.start'), 'refused'),
  };
}

function pulse(el: Element, name: string) {
  el.classList.remove(name);
  void el.getBoundingClientRect();
  el.classList.add(name);
}

// Renders the headings and tables of a credits Markdown file, without innerHTML.
function renderCredits(root: Element, markdown: string) {
  const inline = (text: string, parent: Element) => {
    const clean = (t: string) => t.replace(/[*`]/g, '');
    let rest = text;
    for (const match of text.matchAll(/\[([^\]]+)\]\((https?:[^)]+)\)|(https?:\/\/\S+)/g)) {
      const index = rest.indexOf(match[0]);
      parent.append(clean(rest.slice(0, index)));
      const link = parent.appendChild(document.createElement('a'));
      link.href = match[2] ?? match[3];
      link.textContent = clean(match[1] ?? match[3].replace(/^https?:\/\//, ''));
      link.target = '_blank';
      link.rel = 'noopener';
      rest = rest.slice(index + match[0].length);
    }
    parent.append(clean(rest));
  };
  root.replaceChildren();
  let columns: string[] | null = null;
  let list: HTMLUListElement | null = null;
  for (const line of markdown.split('\n').map(l => l.trim())) {
    const heading = /^#{2,3}\s+(.*)/.exec(line);
    if (heading) inline(heading[1], root.appendChild(document.createElement('h2')));
    if (!line.startsWith('|')) {
      columns = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.every(cell => /^-+$/.test(cell))) continue;
    if (!columns) {
      columns = cells.map(cell => cell.toLowerCase());
      list = root.appendChild(document.createElement('ul'));
      continue;
    }
    const row = new Map(columns.map((column, i) => [column, cells[i] ?? '']));
    const item = list!.appendChild(document.createElement('li'));
    inline(row.get('title') ?? '', item.appendChild(document.createElement('strong')));
    item.append(document.createElement('br'));
    inline(['author', 'licence', 'source'].map(key => row.get(key)).filter(Boolean).join(' · '), item);
  }
}
