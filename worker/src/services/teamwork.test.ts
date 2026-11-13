import { describe, expect, it } from 'vitest';
import { canonicalTaskUrl } from './teamwork';

const BASE = 'https://offspringdigital.teamwork.com';

describe('canonicalTaskUrl', () => {
  it.each([
    [`${BASE}/app/tasks/44192294`],
    [`${BASE}/#/tasks/44192294`],
    [`${BASE}/tasks/44192294`],
    [`${BASE}/app/tasks/44192294?c=123`],
    [`${BASE}/#/tasks/44192294/comments`],
  ])('maps %s to the /app/tasks form', (url) => {
    expect(canonicalTaskUrl(url)).toBe(`${BASE}/app/tasks/44192294`);
  });

  it('leaves non-task and foreign links alone', () => {
    expect(canonicalTaskUrl(`${BASE}/app/projects/1`)).toBe(`${BASE}/app/projects/1`);
    expect(canonicalTaskUrl('https://example.com/#/tasks/1')).toBe('https://example.com/#/tasks/1');
    expect(canonicalTaskUrl(`${BASE}/app/tasks/12abc`)).toBe(`${BASE}/app/tasks/12abc`);
    expect(canonicalTaskUrl(null)).toBeNull();
  });
});
