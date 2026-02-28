import { describe, it, expect, beforeAll } from 'vitest';
import Parser from 'web-tree-sitter';
import { CallGraph } from '../analyzers/callGraphAnalyzer/callGraph';
import { ImportResolver } from '../analyzers/callGraphAnalyzer/importResolver';
import { extractFunctions } from '../analyzers/callGraphAnalyzer/functionExtractor';
import { createTestParser } from './helpers/treeSitter';

let parser: Parser;

beforeAll(async () => {
  parser = await createTestParser();
});

describe('CallGraph', () => {
  it('adds functions and creates edges', () => {
    const cg = new CallGraph();
    cg.addFunction({ name: 'a', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addFunction({ name: 'b', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addEdge(CallGraph.qualifiedKey('file:///a.py', 'a'), CallGraph.qualifiedKey('file:///a.py', 'b'));

    const a = cg.getFunction(CallGraph.qualifiedKey('file:///a.py', 'a'))!;
    expect(a.callees.has(CallGraph.qualifiedKey('file:///a.py', 'b'))).toBe(true);

    const b = cg.getFunction(CallGraph.qualifiedKey('file:///a.py', 'b'))!;
    expect(b.callers.has(CallGraph.qualifiedKey('file:///a.py', 'a'))).toBe(true);
  });

  it('computes transitive PV writes', () => {
    const cg = new CallGraph();
    cg.addFunction({ name: 'main', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addFunction({ name: 'helper', uri: 'file:///b.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addFunction({ name: 'deep', uri: 'file:///b.py', range: {} as any, nameRange: {} as any, parameters: [] });

    cg.setDirectPvAccess(CallGraph.qualifiedKey('file:///b.py', 'helper'), new Set(), new Set(['var:x']));
    cg.setDirectPvAccess(CallGraph.qualifiedKey('file:///b.py', 'deep'), new Set(), new Set(['var:y']));

    cg.addEdge(CallGraph.qualifiedKey('file:///a.py', 'main'), CallGraph.qualifiedKey('file:///b.py', 'helper'));
    cg.addEdge(CallGraph.qualifiedKey('file:///b.py', 'helper'), CallGraph.qualifiedKey('file:///b.py', 'deep'));

    const writes = cg.getTransitivePvWrites(CallGraph.qualifiedKey('file:///a.py', 'main'));
    expect(writes.has('var:x')).toBe(true);
    expect(writes.has('var:y')).toBe(true);
  });

  it('handles cycles without infinite loops', () => {
    const cg = new CallGraph();
    cg.addFunction({ name: 'a', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addFunction({ name: 'b', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });

    cg.setDirectPvAccess(CallGraph.qualifiedKey('file:///a.py', 'a'), new Set(), new Set(['var:x']));
    cg.setDirectPvAccess(CallGraph.qualifiedKey('file:///a.py', 'b'), new Set(), new Set(['var:y']));

    // Create a cycle: a -> b -> a
    cg.addEdge(CallGraph.qualifiedKey('file:///a.py', 'a'), CallGraph.qualifiedKey('file:///a.py', 'b'));
    cg.addEdge(CallGraph.qualifiedKey('file:///a.py', 'b'), CallGraph.qualifiedKey('file:///a.py', 'a'));

    const writes = cg.getTransitivePvWrites(CallGraph.qualifiedKey('file:///a.py', 'a'));
    expect(writes.has('var:x')).toBe(true);
    expect(writes.has('var:y')).toBe(true);
  });

  it('removes file and cleans up edges', () => {
    const cg = new CallGraph();
    cg.addFunction({ name: 'main', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addFunction({ name: 'helper', uri: 'file:///b.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.addEdge(CallGraph.qualifiedKey('file:///a.py', 'main'), CallGraph.qualifiedKey('file:///b.py', 'helper'));

    cg.removeFile('file:///b.py');

    expect(cg.getFunction(CallGraph.qualifiedKey('file:///b.py', 'helper'))).toBeUndefined();
    const main = cg.getFunction(CallGraph.qualifiedKey('file:///a.py', 'main'))!;
    expect(main.callees.size).toBe(0);
  });

  it('hasTransitiveWrite checks all functions', () => {
    const cg = new CallGraph();
    cg.addFunction({ name: 'setter', uri: 'file:///a.py', range: {} as any, nameRange: {} as any, parameters: [] });
    cg.setDirectPvAccess(CallGraph.qualifiedKey('file:///a.py', 'setter'), new Set(), new Set(['var:x']));

    expect(cg.hasTransitiveWrite('var:x')).toBe(true);
    expect(cg.hasTransitiveWrite('var:unknown')).toBe(false);
  });
});

describe('ImportResolver', () => {
  it('extracts from...import statement', () => {
    const tree = parser.parse('from helpers import setup_vars');
    const resolver = new ImportResolver();
    const imports = resolver.extractImports(tree);
    expect(imports).toHaveLength(1);
    expect(imports[0].localName).toBe('setup_vars');
    expect(imports[0].remoteName).toBe('setup_vars');
    expect(imports[0].modulePath).toBe('helpers');
  });

  it('extracts aliased import', () => {
    const tree = parser.parse('from helpers import setup_vars as sv');
    const resolver = new ImportResolver();
    const imports = resolver.extractImports(tree);
    expect(imports).toHaveLength(1);
    expect(imports[0].localName).toBe('sv');
    expect(imports[0].remoteName).toBe('setup_vars');
  });

  it('extracts import statement', () => {
    const tree = parser.parse('import helpers');
    const resolver = new ImportResolver();
    const imports = resolver.extractImports(tree);
    expect(imports).toHaveLength(1);
    expect(imports[0].localName).toBe('helpers');
    expect(imports[0].modulePath).toBe('helpers');
  });

  it('resolves module path to file URI', () => {
    const resolver = new ImportResolver();
    const knownFiles = new Set(['file:///workspace/helpers.py']);
    const resolved = resolver.resolveModulePath(
      'helpers', 'file:///workspace/main.py', ['/workspace'], knownFiles
    );
    expect(resolved).toBe('file:///workspace/helpers.py');
  });

  it('resolves dotted module path', () => {
    const resolver = new ImportResolver();
    const knownFiles = new Set(['file:///workspace/pkg/utils.py']);
    const resolved = resolver.resolveModulePath(
      'pkg.utils', 'file:///workspace/main.py', ['/workspace'], knownFiles
    );
    expect(resolved).toBe('file:///workspace/pkg/utils.py');
  });

  it('returns null for unknown module', () => {
    const resolver = new ImportResolver();
    const resolved = resolver.resolveModulePath(
      'nonexistent', 'file:///workspace/main.py', ['/workspace'], new Set()
    );
    expect(resolved).toBeNull();
  });

  it('resolves call target through imports', () => {
    const resolver = new ImportResolver();
    const importsByFile = new Map([
      ['file:///workspace/main.py', [{
        localName: 'setup_vars',
        remoteName: 'setup_vars',
        resolvedUri: 'file:///workspace/helpers.py',
        modulePath: 'helpers',
        isWildcard: false,
      }]],
    ]);
    const result = resolver.resolveCallTarget('setup_vars', 'file:///workspace/main.py', importsByFile);
    expect(result).toEqual({ uri: 'file:///workspace/helpers.py', name: 'setup_vars' });
  });
});

describe('FunctionExtractor', () => {
  it('extracts function definitions', () => {
    const code = [
      'def ksr_request_route(msg):',
      '    pass',
    ].join('\n');
    const tree = parser.parse(code);
    const fns = extractFunctions(tree, 'file:///a.py');
    expect(fns.some(f => f.def.name === 'ksr_request_route')).toBe(true);
  });

  it('extracts call sites within a function', () => {
    const code = [
      'def main():',
      '    helper_func()',
      '    another()',
    ].join('\n');
    const tree = parser.parse(code);
    const fns = extractFunctions(tree, 'file:///a.py');
    const main = fns.find(f => f.def.name === 'main')!;
    expect(main.callSites.map(c => c.callee)).toContain('helper_func');
    expect(main.callSites.map(c => c.callee)).toContain('another');
  });

  it('extracts PV reads and writes per function', () => {
    const code = [
      'def setup():',
      '    KSR.pv.sets("$var(x)", "hello")',
      '    KSR.pv.seti("$var(counter)", 0)',
      '',
      'def handler():',
      '    val = KSR.pv.get("$var(x)")',
      '    method = KSR.pv.get("$rm")',
    ].join('\n');
    const tree = parser.parse(code);
    const fns = extractFunctions(tree, 'file:///a.py');

    const setup = fns.find(f => f.def.name === 'setup')!;
    expect(setup.pvWrites.has('var:x')).toBe(true);
    expect(setup.pvWrites.has('var:counter')).toBe(true);
    expect(setup.pvReads.size).toBe(0);

    const handler = fns.find(f => f.def.name === 'handler')!;
    expect(handler.pvReads.has('var:x')).toBe(true);
    expect(handler.pvReads.has('rm')).toBe(true);
    expect(handler.pvWrites.size).toBe(0);
  });

  it('does not include KSR calls as regular call sites', () => {
    const code = [
      'def main():',
      '    KSR.pv.sets("$var(x)", "val")',
      '    helper()',
    ].join('\n');
    const tree = parser.parse(code);
    const fns = extractFunctions(tree, 'file:///a.py');
    const main = fns.find(f => f.def.name === 'main')!;
    expect(main.callSites.map(c => c.callee)).toEqual(['helper']);
  });

  it('extracts function parameters', () => {
    const code = 'def func(msg, ctx):\n    pass';
    const tree = parser.parse(code);
    const fns = extractFunctions(tree, 'file:///a.py');
    expect(fns[0].def.parameters).toEqual(['msg', 'ctx']);
  });
});
