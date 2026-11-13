import { describe, expect, it } from 'vitest';
import { parseReport } from './parser';

describe('parseReport', () => {
  it('parses the basic template', () => {
    const { entries, totalHours } = parseReport(
      '- Task A: 5\n- Task B: 1\n- Task C: 1',
    );
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ taskName: 'Task A', hours: 5 });
    expect(totalHours).toBe(7);
  });

  it('handles decimals with , or . and an h suffix', () => {
    const { entries } = parseReport('- Task: 0,5\n- Other - 1.5h');
    expect(entries[0].hours).toBe(0.5);
    expect(entries[1].hours).toBe(1.5);
  });

  it('extracts a markdown link as href with a clean name', () => {
    const { entries } = parseReport(
      '- Review [PR #12](https://github.com/x/y/pull/12): 1',
    );
    expect(entries[0].taskName).toBe('Review PR #12');
    expect(entries[0].href).toBe('https://github.com/x/y/pull/12');
    expect(entries[0].hours).toBe(1);
  });

  it('extracts an angle link and raw url', () => {
    const angle = parseReport('- Deploy <https://ci/42|pipeline>: 1').entries[0];
    expect(angle.href).toBe('https://ci/42');
    expect(angle.taskName).toBe('Deploy pipeline');

    const raw = parseReport('- Task C (https://x.com/c): 1').entries[0];
    expect(raw.href).toBe('https://x.com/c');
  });

  it('strips bullets and numbering', () => {
    const { entries } = parseReport('3) Fix login bug: 2.5');
    expect(entries[0]).toMatchObject({ taskName: 'Fix login bug', hours: 2.5 });
  });

  it('ignores lines without hours', () => {
    const { entries, ignored } = parseReport('Báo cáo ngày 1/7\n- Task A: 3');
    expect(entries).toHaveLength(1);
    expect(ignored).toContain('Báo cáo ngày 1/7');
  });
});
