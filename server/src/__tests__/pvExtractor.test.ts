import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'web-tree-sitter';
import { extractPvReferences } from '../analyzers/pvAnalyzer/pvExtractor';
import { createTestParser } from './helpers/treeSitter';

let parser: Parser;

beforeAll(async () => {
  parser = await createTestParser();
});

function parse(code: string) {
  return parser.parse(code);
}

describe('extractPvReferences', () => {
  it('extracts KSR.pv.get calls', () => {
    const tree = parse('KSR.pv.get("$ru")');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].pvString).toBe('$ru');
    expect(refs[0].method).toBe('get');
    expect(refs[0].isWrite).toBe(false);
  });

  it('extracts KSR.pv.sets calls', () => {
    const tree = parse('KSR.pv.sets("$var(x)", "hello")');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].pvString).toBe('$var(x)');
    expect(refs[0].method).toBe('sets');
    expect(refs[0].isWrite).toBe(true);
  });

  it('extracts KSR.pv.seti calls', () => {
    const tree = parse('KSR.pv.seti("$var(counter)", 42)');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].pvString).toBe('$var(counter)');
    expect(refs[0].method).toBe('seti');
    expect(refs[0].isWrite).toBe(true);
  });

  it('extracts KSR.pv.gete calls', () => {
    const tree = parse('KSR.pv.gete("$fu")');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].method).toBe('gete');
    expect(refs[0].isWrite).toBe(false);
  });

  it('handles single-quoted strings', () => {
    const tree = parse("KSR.pv.get('$ru')");
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(1);
    expect(refs[0].pvString).toBe('$ru');
  });

  it('ignores non-KSR.pv calls', () => {
    const tree = parse('KSR.sl.send_reply(200, "OK")');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(0);
  });

  it('ignores regular function calls', () => {
    const tree = parse('print("$var(x)")');
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(0);
  });

  it('extracts multiple calls from one file', () => {
    const code = [
      'def ksr_request_route(msg):',
      '    method = KSR.pv.get("$rm")',
      '    KSR.pv.sets("$var(x)", "test")',
      '    source = KSR.pv.get("$si")',
    ].join('\n');
    const tree = parse(code);
    const refs = extractPvReferences(tree);
    expect(refs).toHaveLength(3);
    expect(refs.map(r => r.pvString)).toEqual(['$rm', '$var(x)', '$si']);
  });

  it('returns correct string node positions', () => {
    const code = 'KSR.pv.get("$ru")';
    const tree = parse(code);
    const refs = extractPvReferences(tree);
    // "$ru" is at index 12-15 (inside the quotes)
    expect(refs[0].stringNode.startIndex).toBe(12);
    expect(refs[0].stringNode.endIndex).toBe(15);
  });
});
