import { describe, it, expect } from 'vitest';
import { parsePvString, pvIdentityKey } from '../analyzers/pvAnalyzer/pvParser';

describe('parsePvString', () => {
  it('parses bare PVs', () => {
    const result = parsePvString('$ru');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('ru');
    expect(result[0].isBare).toBe(true);
    expect(result[0].category).toBe('sip_uri');
    expect(result[0].fullMatch).toBe('$ru');
  });

  it('parses parenthesized PVs', () => {
    const result = parsePvString('$var(myvar)');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('var');
    expect(result[0].innerName).toBe('myvar');
    expect(result[0].isBare).toBe(false);
    expect(result[0].category).toBe('script_var');
  });

  it('parses shared variables', () => {
    const result = parsePvString('$shv(counter)');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('shv');
    expect(result[0].innerName).toBe('counter');
    expect(result[0].category).toBe('shared_var');
  });

  it('parses keyed PVs like $sht(table=>key)', () => {
    const result = parsePvString('$sht(ipban=>$si)');
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].pvClass).toBe('sht');
    expect(result[0].innerName).toBe('ipban=>$si');
  });

  it('parses xavp with nested fields', () => {
    const result = parsePvString('$xavp(root=>field)');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('xavp');
    expect(result[0].innerName).toBe('root=>field');
    expect(result[0].category).toBe('avp');
  });

  it('parses network PVs', () => {
    for (const pv of ['$si', '$sp', '$Ri', '$Rp']) {
      const result = parsePvString(pv);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('network');
    }
  });

  it('parses message PVs', () => {
    for (const pv of ['$rm', '$rs', '$ci', '$ua']) {
      const result = parsePvString(pv);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('message');
    }
  });

  it('parses transaction PVs like $T(reply_code)', () => {
    const result = parsePvString('$T(reply_code)');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('T');
    expect(result[0].innerName).toBe('reply_code');
    expect(result[0].isBare).toBe(false);
    expect(result[0].category).toBe('transaction');
  });

  it('parses timestamp value PVs like $TV(s)', () => {
    const result = parsePvString('$TV(s)');
    expect(result).toHaveLength(1);
    expect(result[0].pvClass).toBe('TV');
    expect(result[0].innerName).toBe('s');
    expect(result[0].isBare).toBe(false);
    expect(result[0].category).toBe('time');
  });

  it('returns empty for non-PV strings', () => {
    expect(parsePvString('hello world')).toHaveLength(0);
    expect(parsePvString('')).toHaveLength(0);
    expect(parsePvString('no dollar here')).toHaveLength(0);
  });

  it('tracks correct offsets', () => {
    const result = parsePvString('$var(x)');
    expect(result[0].offset).toBe(0);
    expect(result[0].length).toBe(7);
  });
});

describe('pvIdentityKey', () => {
  it('returns class name for bare PVs', () => {
    const pv = parsePvString('$ru')[0];
    expect(pvIdentityKey(pv)).toBe('ru');
  });

  it('returns class:name for parenthesized PVs', () => {
    const pv = parsePvString('$var(myvar)')[0];
    expect(pvIdentityKey(pv)).toBe('var:myvar');
  });
});
