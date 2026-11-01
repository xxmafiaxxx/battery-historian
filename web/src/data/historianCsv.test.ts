import { describe, expect, it } from 'vitest';
import { groupBySeries, parseCsvRows, parseHistorianCsv } from './historianCsv';

const HEADER = 'metric,type,start_time,end_time,value,opt';

describe('parseCsvRows', () => {
  it('parses plain rows', () => {
    expect(parseCsvRows('a,b,c\n1,2,3')).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
  });

  it('parses quoted fields with commas', () => {
    expect(parseCsvRows('"x,y",2')).toEqual([['x,y', '2']]);
  });

  it('parses escaped quotes inside quoted fields', () => {
    expect(parseCsvRows('"he said ""hi""",b')).toEqual([['he said "hi"', 'b']]);
  });

  it('handles CRLF and no trailing newline', () => {
    expect(parseCsvRows('a,b\r\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('parseHistorianCsv', () => {
  it('parses an int battery level row and computes extent', () => {
    const csv = [HEADER, 'Level,int,1000,2000,52,', 'Level,int,2000,3000,51,'].join('\n');
    const { entries, extent } = parseHistorianCsv(csv, "Battery History");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toHaveLength(2);
    expect(entries[0]!).toMatchObject({
      seriesName: 'Level',
      type: 'int',
      startTime: 1000,
      endTime: 2000,
      value: 52,
      uid: null,
    });
    expect(extent).toEqual({ min: 1000, max: 3000 });
  });

  it('converts temperature from deciCelcius', () => {
    const csv = [HEADER, 'Temperature,int,0,1000,255,'].join('\n');
    const { entries } = parseHistorianCsv(csv, 'Battery History');
    expect(entries[0]!.value).toBeCloseTo(25.5);
  });

  it('uses opt as the value for bool rows', () => {
    const csv = [HEADER, 'Screen,bool,0,1000,true,on'].join('\n');
    const { entries } = parseHistorianCsv(csv, 'Battery History');
    expect(entries[0]!.value).toBe('on');
  });

  it('parses float rows', () => {
    const csv = [HEADER, 'Level (Voltage),float,0,1000,3.85,'].join('\n');
    const { entries } = parseHistorianCsv(csv, 'Battery History');
    expect(entries[0]!.value).toBeCloseTo(3.85);
  });

  it('extracts uid from opt for service rows', () => {
    const csv = [HEADER, 'Wakelock for uid,service,0,5000,some.lock,10042'].join('\n');
    const { entries } = parseHistorianCsv(csv, 'Battery History');
    expect(entries[0]!.uid).toBe(10042);
  });

  it('does not treat empty opt as a uid', () => {
    const csv = [HEADER, 'Top Application,service,0,5000,com.app,'].join('\n');
    const { entries } = parseHistorianCsv(csv, 'Battery History');
    expect(entries[0]!.uid).toBeNull();
  });

  it('groups entries by series preserving order', () => {
    const csv = [HEADER, 'B,int,0,1,1,', 'A,int,0,1,2,', 'B,int,1,2,3,'].join('\n');
    const { entries } = parseHistorianCsv(csv, 's');
    const groups = groupBySeries(entries);
    expect([...groups.keys()]).toEqual(['B', 'A']);
    expect(groups.get('B')).toHaveLength(2);
  });

  it('skips malformed rows', () => {
    const csv = [HEADER, 'Level,int,100,200,52,', 'garbage', 'Level,int,200,300,51,'].join('\n');
    const { entries } = parseHistorianCsv(csv, 's');
    expect(entries).toHaveLength(2);
  });
});
