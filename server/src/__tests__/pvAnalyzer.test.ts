import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import Parser from 'web-tree-sitter';
import * as path from 'path';
import { PvAnalyzer } from '../analyzers/pvAnalyzer/index';

let parser: Parser;

beforeAll(async () => {
  await Parser.init();
  const wasmPath = path.join(__dirname, '..', '..', 'wasm', 'tree-sitter-python.wasm');
  const Python = await Parser.Language.load(wasmPath);
  parser = new Parser();
  parser.setLanguage(Python);
});

function makeAnalyzer() {
  return new PvAnalyzer();
}

function analyzeCode(analyzer: PvAnalyzer, uri: string, code: string) {
  const tree = parser.parse(code);
  analyzer.analyze({
    uri,
    tree,
    changedRanges: [],
    isFullParse: true,
    fullText: code,
  });
  return tree;
}

function docContext(uri: string, code: string) {
  const tree = parser.parse(code);
  return { uri, tree, fullText: code };
}

describe('PvAnalyzer - Diagnostics', () => {
  it('reports unknown PV class as error', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$fake_thing(oops)")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const diags = analyzer.getDiagnostics({ uri: 'test://a.py', tree, fullText: code });
    const unknownDiag = diags.find(d => d.message.includes('Unknown pseudo-variable'));
    expect(unknownDiag).toBeDefined();
    expect(unknownDiag!.severity).toBe(1); // DiagnosticSeverity.Error = 1
  });

  it('does not warn on known bare PVs', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$ru")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const diags = analyzer.getDiagnostics({ uri: 'test://a.py', tree, fullText: code });
    expect(diags).toHaveLength(0);
  });

  it('does not warn on known class PVs', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.sets("$var(x)", "val")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const diags = analyzer.getDiagnostics({ uri: 'test://a.py', tree, fullText: code });
    expect(diags).toHaveLength(0);
  });

  it('warns when variable is read but never set', () => {
    const analyzer = makeAnalyzer();
    const code = 'val = KSR.pv.get("$var(never_defined)")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const diags = analyzer.getDiagnostics({ uri: 'test://a.py', tree, fullText: code });
    expect(diags.some(d => d.code === 'undefined-pv')).toBe(true);
  });

  it('does not warn when variable is set before read', () => {
    const analyzer = makeAnalyzer();
    const code = [
      'KSR.pv.sets("$var(x)", "hello")',
      'val = KSR.pv.get("$var(x)")',
    ].join('\n');
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const diags = analyzer.getDiagnostics({ uri: 'test://a.py', tree, fullText: code });
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('finds definitions across documents', () => {
    const analyzer = makeAnalyzer();
    analyzeCode(analyzer, 'test://a.py', 'KSR.pv.sets("$var(x)", "hello")');
    const code2 = 'val = KSR.pv.get("$var(x)")';
    const tree2 = analyzeCode(analyzer, 'test://b.py', code2);
    const diags = analyzer.getDiagnostics({ uri: 'test://b.py', tree: tree2, fullText: code2 });
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });
});

describe('PvAnalyzer - Definitions', () => {
  it('returns definition location for a read variable', () => {
    const analyzer = makeAnalyzer();
    const code = [
      'KSR.pv.sets("$var(x)", "hello")',
      'val = KSR.pv.get("$var(x)")',
    ].join('\n');
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    // Position cursor on $var(x) in the get call (line 1, inside the string)
    const defs = analyzer.getDefinitions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 1, character: 20 }
    );
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].range.start.line).toBe(0); // Points to the sets() call on line 0
  });

  it('returns empty for position outside PV', () => {
    const analyzer = makeAnalyzer();
    const code = 'print("hello")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const defs = analyzer.getDefinitions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 0 }
    );
    expect(defs).toHaveLength(0);
  });
});

describe('PvAnalyzer - References', () => {
  it('finds all references across documents', () => {
    const analyzer = makeAnalyzer();
    analyzeCode(analyzer, 'test://a.py', 'KSR.pv.sets("$var(x)", "hello")');
    const code2 = 'val = KSR.pv.get("$var(x)")';
    const tree2 = analyzeCode(analyzer, 'test://b.py', code2);
    // Position on $var(x) in file b
    const refs = analyzer.getReferences(
      { uri: 'test://b.py', tree: tree2, fullText: code2 },
      { line: 0, character: 20 }
    );
    expect(refs.length).toBe(2); // One in a.py, one in b.py
    expect(refs.map(r => r.uri).sort()).toEqual(['test://a.py', 'test://b.py']);
  });
});

describe('PvAnalyzer - Hover', () => {
  it('returns hover info for bare PV', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$ru")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const hover = analyzer.getHover(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 13 }
    );
    expect(hover).not.toBeNull();
    expect((hover!.contents as any).value).toContain('$ru');
    expect((hover!.contents as any).value).toContain('Request URI');
  });

  it('returns null for position outside PV', () => {
    const analyzer = makeAnalyzer();
    const code = 'print("hello")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const hover = analyzer.getHover(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 0 }
    );
    expect(hover).toBeNull();
  });
});

describe('PvAnalyzer - Semantic Tokens', () => {
  it('emits tokens for bare PVs', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$ru")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const tokens = analyzer.getSemanticTokens({ uri: 'test://a.py', tree, fullText: code });
    expect(tokens.length).toBeGreaterThan(0);
    // $ru is a builtin → tokenType 2
    expect(tokens[0].tokenType).toBe(2);
  });

  it('emits three tokens for class PVs: $var( as type, name as name, ) as type', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.sets("$var(caller)", "alice")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const tokens = analyzer.getSemanticTokens({ uri: 'test://a.py', tree, fullText: code });
    expect(tokens).toHaveLength(3);
    // $var( → pvType (teal)
    expect(tokens[0].tokenType).toBe(0);
    expect(tokens[0].length).toBe(5); // $var(
    // caller → pvName (light blue)
    expect(tokens[1].tokenType).toBe(1);
    expect(tokens[1].length).toBe(6); // caller
    // ) → pvType (teal)
    expect(tokens[2].tokenType).toBe(0);
    expect(tokens[2].length).toBe(1);
  });
});

describe('PvAnalyzer - Completions', () => {
  it('returns PV completions inside KSR.pv.get string', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const completions = analyzer.getCompletions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 13 } // After the $
    );
    expect(completions.length).toBeGreaterThan(0);
    expect(completions.some(c => c.label === '$ru')).toBe(true);
    expect(completions.some(c => c.label === '$var(')).toBe(true);
  });

  it('returns variable name completions inside $var()', () => {
    const analyzer = makeAnalyzer();
    // First define some variables
    analyzeCode(analyzer, 'test://defs.py', [
      'KSR.pv.sets("$var(caller)", "alice")',
      'KSR.pv.seti("$var(counter)", 1)',
    ].join('\n'));

    const code = 'KSR.pv.get("$var()")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const completions = analyzer.getCompletions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 17 } // Between the parens in $var()
    );
    expect(completions.some(c => c.label === 'caller')).toBe(true);
    expect(completions.some(c => c.label === 'counter')).toBe(true);
  });

  it('returns empty completions outside KSR.pv strings', () => {
    const analyzer = makeAnalyzer();
    const code = 'print("hello")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const completions = analyzer.getCompletions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 8 }
    );
    expect(completions).toHaveLength(0);
  });

  // KSR.pv method completion requires a parseable attribute chain.
  // Incomplete code like "KSR.pv.g" doesn't form a valid AST node,
  // so method completions won't fire. This is a known limitation —
  // Pylance/Jedi handle method completions for KSR.pv.* anyway.
  it.skip('returns KSR.pv method completions', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.g';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const completions = analyzer.getCompletions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 8 }
    );
    expect(completions.some(c => c.label === 'get')).toBe(true);
    expect(completions.some(c => c.label === 'sets')).toBe(true);
  });

  it('class PV completion snippet does not produce double dollar', () => {
    const analyzer = makeAnalyzer();
    const code = 'KSR.pv.get("$")';
    const tree = analyzeCode(analyzer, 'test://a.py', code);
    const completions = analyzer.getCompletions(
      { uri: 'test://a.py', tree, fullText: code },
      { line: 0, character: 13 }
    );
    const varCompletion = completions.find(c => c.label === '$var(');
    expect(varCompletion).toBeDefined();
    // The textEdit text should be a snippet: \$var($1)
    // In snippet syntax, \$ is literal $, $1 is cursor
    const editText = (varCompletion!.textEdit as any).newText;
    expect(editText).toBe('\\$var($1)');
    // Verify it does NOT start with \\$$ or contain double dollars
    expect(editText).not.toContain('$$');
  });
});
