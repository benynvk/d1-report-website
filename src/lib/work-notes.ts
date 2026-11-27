/**
 * What was done on a task (a report's "Detail"), per position. Auto-WIP
 * rotates through these; the report form offers them as suggestions.
 */
export const WORK_NOTES: Record<'dev' | 'tester', string[]> = {
  dev: [
    'Analyze requirements',
    'Confirm requirements with the customer',
    'Design database schema',
    'Implement API endpoints',
    'Build UI components',
    'Integrate API with frontend',
    'Fix bugs from feedback',
    'Handle edge cases and validation',
    'Write unit tests',
    'Refactor and optimize code',
    'Address code review comments',
  ],
  tester: [
    'Analyze requirements',
    'Confirm requirements with the customer',
    'Write test cases',
    'Prepare test data',
    'Execute functional tests',
    'Test API endpoints',
    'Log and report bugs',
    'Retest fixed bugs',
    'Run regression tests',
    'Check UI on different devices',
    'Update test report',
  ],
};
