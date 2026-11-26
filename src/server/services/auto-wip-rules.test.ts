import { describe, expect, it } from 'vitest';
import {
  entriesFromLines,
  workNotes,
  cellSegments,
  nextProgress,
  annotateLines,
  randomDayHours,
  splitHours,
  WORK_NOTES,
  type BoardTask,
  cellText,
  eveningFromMorning,
  historyWindow,
  makeUnique,
  normalizeCell,
  parseCell,
  pickTasks,
  stageTier,
} from './auto-wip-rules';

const task = (id: number, stage: string | null, priority: string | null, emails = ['a@x.com']): BoardTask => ({
  id,
  title: `T${id}`,
  url: `https://tw/app/tasks/${id}`,
  stage,
  priority,
  assigneeEmails: emails,
});

describe('pickTasks', () => {
  it('takes In progress / Ready for QA first, highest priority first, max 2', () => {
    const picked = pickTasks(
      [
        task(1, 'Ready to start', 'high'),
        task(2, 'In progress', 'low'),
        task(3, 'Ready for QA', 'high'),
        task(4, 'In progress', null),
        task(5, 'In progress', 'medium'),
      ],
      'A@x.com',
    );
    expect(picked.map((t) => t.id)).toEqual([3, 5]);
  });

  it('falls back to Ready to start only when nothing is in progress / QA', () => {
    expect(pickTasks([task(1, null, 'high'), task(2, 'Ready to start', 'low')], 'a@x.com').map((t) => t.id)).toEqual([2]);
  });

  it('then any assigned task, but never finished ones or other people\'s', () => {
    const picked = pickTasks(
      [task(1, 'Done', 'high'), task(2, 'Deployed', 'high'), task(3, null, 'low'), task(4, 'In progress', 'high', ['b@x.com']), task(5, 'Ready to deploy', 'high')],
      'a@x.com',
    );
    expect(picked.map((t) => t.id)).toEqual([5, 3]);
  });

  it('returns nothing when the member has no D1 task', () => {
    expect(pickTasks([task(1, 'In progress', 'high', ['b@x.com'])], 'a@x.com')).toEqual([]);
  });
});

describe('stageTier', () => {
  it('ranks the D1 board columns', () => {
    expect(['In progress', 'Ready for QA', 'Ready to start', 'Done local', 'Ready to deploy', null, 'Deployed', 'Done'].map(stageTier)).toEqual([
      0, 0, 1, 2, 2, 2, null, null,
    ]);
  });
});

describe('makeUnique', () => {
  const A = { display: 'Task A', url: 'u1' };
  const B = { display: 'Task B', url: 'u2' };
  const hist = (...cells: string[]) => new Set(cells.map(normalizeCell));

  it('keeps the content when it is new', () => {
    const r = makeUnique([A, B], hist('- Task C'), 'Review code');
    expect(r.change).toBe('none');
    expect(cellText(r.lines)).toBe('- Task A\n- Task B');
  });

  it('reorders when the same list was used', () => {
    const r = makeUnique([A, B], hist('- Task A\n- Task B'), 'Review code');
    expect(r.change).toBe('reordered');
    expect(cellText(r.lines)).toBe('- Task B\n- Task A');
  });

  it('adds the filler task when every order was used (comparison ignores bullets/case)', () => {
    const r = makeUnique([A, B], hist('task a\ntask b', '* TASK B\n* task a'), 'Review code');
    expect(r.change).toBe('filler');
    expect(cellText(r.lines)).toBe('- Task A\n- Task B\n- Review code');
  });

  it('adds the filler for a single repeated task', () => {
    const r = makeUnique([A], hist('Task A'), 'Smoke test');
    expect(cellText(r.lines)).toBe('- Task A\n- Smoke test');
  });

  it('gives up (keeps the original) only when even the filler variants are used', () => {
    const r = makeUnique([A], hist('Task A', '- Task A\n- Smoke test', '- Smoke test\n- Task A'), 'Smoke test');
    expect(r.change).toBe('still-duplicate');
  });
});

describe('eveningFromMorning', () => {
  it('copies every task with its link and marks each one in progress', () => {
    const e = eveningFromMorning([{ display: 'Task A', url: 'u1' }, { display: 'Weekly meeting' }]);
    expect(cellText(e)).toBe('Task A => In progress\nWeekly meeting => In progress');
    expect(e[0].url).toBe('u1');
  });

  it('drops the "Other - " prefix of a no-link task', () => {
    expect(cellText(eveningFromMorning([{ display: 'Other - Update deps' }]))).toBe('Update deps => In progress');
  });

  it('keeps a status that is already there', () => {
    const e = eveningFromMorning([{ display: 'Task A', url: 'u1', suffix: ' => Done' }, { display: 'Fix CI => 80%' }]);
    expect(cellText(e)).toBe('Task A => Done\nFix CI => 80%');
  });
});

describe('parseCell', () => {
  it('splits a bulleted cell into lines and keeps each link', () => {
    const text = '- Task A\n- Weekly meeting\n- Task B (2h)';
    const lines = parseCell({
      formattedValue: text,
      textFormatRuns: [
        { startIndex: 2, format: { link: { uri: 'u1' } } },
        { startIndex: 8, format: {} },
        { startIndex: 28, format: { link: { uri: 'u2' } } },
        { startIndex: 34, format: {} },
      ],
    });
    expect(lines).toEqual([
      { prefix: undefined, display: 'Task A', url: 'u1', suffix: undefined },
      { display: 'Weekly meeting', url: null },
      { prefix: undefined, display: 'Task B', url: 'u2', suffix: ' (2h)' },
    ]);
  });

  it('uses a whole-cell hyperlink for a one-line cell', () => {
    expect(parseCell({ formattedValue: 'Task A', hyperlink: 'u1' })).toEqual([{ display: 'Task A', url: 'u1' }]);
  });
});

describe('historyWindow', () => {
  it('covers the 7 calendar days before, across a month boundary', () => {
    expect(historyWindow('2026-12-02')).toEqual([
      '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02',
    ]);
  });
});

describe('entriesFromLines', () => {
  const types = new Set(['other', 'meeting']);
  it('maps links, task types and free text, with In progress from the status', () => {
    expect(
      entriesFromLines(
        [
          { display: 'Login API', url: 'https://x/tasks/1', prefix: '- ', suffix: ' => In progress' },
          { display: 'Meeting', prefix: '- ' },
          { display: 'Review code => Done', prefix: '- ' },
        ],
        types,
      ),
    ).toEqual([
      { taskName: 'Login API', href: 'https://x/tasks/1', hours: 0, inProgress: true, progress: null },
      { taskName: 'Meeting', href: null, hours: 0, inProgress: false, progress: null },
      { taskName: 'Other - Review code', href: null, hours: 0, inProgress: false, progress: null },
    ]);
  });
  it('drops free text when there is no Other type', () => {
    expect(entriesFromLines([{ display: 'Smoke test' }], new Set())).toEqual([]);
  });
});

describe('workNotes', () => {
  it('gives distinct notes within a report', () => {
    const n = workNotes('dev', '2026-11-26', 'm1', 5);
    expect(new Set(n).size).toBe(5);
    n.forEach((x) => expect(WORK_NOTES.dev).toContain(x));
  });
  it('does not repeat the previous working day, across a weekend', () => {
    for (const [prev, next] of [['2026-11-26', '2026-11-27'], ['2026-11-27', '2026-11-30']]) {
      const a = workNotes('tester', prev, 'm1', 3);
      const b = workNotes('tester', next, 'm1', 3);
      expect(b.filter((x) => a.includes(x))).toEqual([]);
    }
  });
  it('is stable for the same member and day', () => {
    expect(workNotes('dev', '2026-11-26', 'm1', 2)).toEqual(workNotes('dev', '2026-11-26', 'm1', 2));
  });
  it('annotates lines and reads the notes back into entries', () => {
    const lines = annotateLines(
      [
        { display: 'Login API', url: 'https://x/tasks/1', suffix: ' => In progress' },
        { display: 'Signup', url: 'https://x/tasks/2', suffix: ': typed by me => In progress' },
        { display: 'Meeting' },
      ],
      ['Write unit tests'],
      [3.5, 3, 1.2],
    );
    expect(cellText(lines)).toBe(
      'Login API: Write unit tests (3.5h) => In progress\nSignup: typed by me (3h) => In progress\nMeeting (1.2h)',
    );
    expect(entriesFromLines(lines, new Set(['meeting']))).toEqual([
      { taskName: 'Write unit tests', href: 'https://x/tasks/1', hours: 3.5, inProgress: true, progress: null },
      { taskName: 'typed by me', href: 'https://x/tasks/2', hours: 3, inProgress: true, progress: null },
      { taskName: 'Meeting', href: null, hours: 1.2, inProgress: false, progress: null },
    ]);
  });
  it('keeps a morning note through the evening', () => {
    const morning = annotateLines([{ display: 'Login API', url: 'https://x/tasks/1' }], ['Design database schema']);
    const evening = annotateLines(eveningFromMorning(morning), ['Other note'], [7.6], () => 45);
    expect(cellText(evening)).toBe('Login API: Design database schema (7.6h) => In progress (45%)');
    expect(entriesFromLines(evening, new Set())).toEqual([
      { taskName: 'Design database schema', href: 'https://x/tasks/1', hours: 7.6, inProgress: true, progress: 45 },
    ]);
  });
  it('keeps the day total when a line cannot be recorded', () => {
    const lines = annotateLines(
      [{ display: 'Login API', url: 'https://x/tasks/1' }, { display: 'Review code' }],
      ['Write unit tests'],
      [5, 2.6],
    );
    expect(entriesFromLines(lines, new Set()).map((e) => e.hours)).toEqual([7.6]);
  });
  it('moves progress forward from the last report', () => {
    for (let i = 0; i < 200; i++) {
      const fresh = nextProgress(undefined);
      expect(fresh % 5).toBe(0);
      expect(fresh).toBeGreaterThanOrEqual(20);
      expect(fresh).toBeLessThanOrEqual(60);
      const later = nextProgress(50);
      expect(later).toBeGreaterThanOrEqual(60);
      expect(later).toBeLessThanOrEqual(75);
      expect(nextProgress(90)).toBe(95);
    }
  });
});

describe('evening hours', () => {
  it('keeps the day total in 7.3-8.5h, about 20% at 8h or more', () => {
    let long = 0;
    for (let i = 0; i < 5000; i++) {
      const t = randomDayHours();
      expect(t).toBeGreaterThanOrEqual(7.3);
      expect(t).toBeLessThanOrEqual(8.5);
      if (t >= 8) long++;
    }
    expect(long / 5000).toBeGreaterThan(0.17);
    expect(long / 5000).toBeLessThan(0.23);
  });
  it('takes partial leave off the day', () => {
    const t = randomDayHours(4, () => 0.5);
    expect(t).toBeCloseTo(3.6);
  });
  it('splits a total exactly, 0.5h minimum per task', () => {
    for (let i = 0; i < 500; i++) {
      const total = randomDayHours();
      const n = 1 + (i % 5);
      const parts = splitHours(total, n);
      expect(parts).toHaveLength(n);
      expect(Math.round(parts.reduce((a, b) => a + b, 0) * 10)).toBe(Math.round(total * 10));
      parts.forEach((p) => expect(p).toBeGreaterThanOrEqual(0.5));
    }
  });
});

describe('cellSegments', () => {
  it('splits a cell into linked and plain pieces', () => {
    expect(
      cellSegments({
        formattedValue: '- Login API: done\n- Meeting',
        textFormatRuns: [{ startIndex: 2, format: { link: { uri: 'https://x/1' } } }, { startIndex: 11, format: {} }],
      }),
    ).toEqual([{ text: '- ' }, { text: 'Login API', url: 'https://x/1' }, { text: ': done\n- Meeting' }]);
  });
  it('uses a whole-cell hyperlink', () => {
    expect(cellSegments({ formattedValue: 'Task', hyperlink: 'https://x/2' })).toEqual([{ text: 'Task', url: 'https://x/2' }]);
  });
});
