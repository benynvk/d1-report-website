import { describe, expect, it } from 'vitest';
import {
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
