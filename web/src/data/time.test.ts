import { describe, expect, it } from 'vitest';
import { describeBytes, formatDuration } from './time';

describe('formatDuration', () => {
  it('formats hours, minutes, seconds, ms like the legacy UI', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(400)).toBe('400ms');
    expect(formatDuration(12_345)).toBe('12s 345ms');
    expect(formatDuration(3_723_456)).toBe('1h 2m 3s 456ms');
  });
});

describe('describeBytes', () => {
  it('picks sensible units', () => {
    expect(describeBytes(512)).toBe('512 B');
    expect(describeBytes(2048)).toBe('2 KB');
    expect(describeBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(describeBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
  });
});
