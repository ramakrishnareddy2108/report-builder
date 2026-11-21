import { describe, expect, it } from 'vitest';
import { PAGES } from '@/app/nav';
import { isFileSystemAccessSupported } from '@/storage/workspace';

describe('navigation', () => {
  it('lists the 8 pages in order with unique ids', () => {
    expect(PAGES.map((p) => p.label)).toEqual([
      'Workspace',
      'Sources',
      'Doctors',
      'Costs',
      'Run',
      'Months',
      'Dashboards',
      'Settings',
    ]);
    expect(new Set(PAGES.map((p) => p.id)).size).toBe(PAGES.length);
  });
});

describe('isFileSystemAccessSupported', () => {
  it('is true when showDirectoryPicker is a function', () => {
    expect(isFileSystemAccessSupported({ showDirectoryPicker: () => undefined })).toBe(true);
  });

  it('is false when showDirectoryPicker is missing', () => {
    expect(isFileSystemAccessSupported({})).toBe(false);
  });
});
