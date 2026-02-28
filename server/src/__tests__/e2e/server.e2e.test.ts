import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestLspClient } from './lspClient';

let client: TestLspClient;

beforeAll(async () => {
  client = await TestLspClient.start();
}, 10000);

afterAll(async () => {
  await client.shutdown();
});

describe('E2E: Diagnostics', () => {
  it('reports unknown pseudo-variable', async () => {
    const uri = 'file:///test/diag_unknown.py';
    await client.openDocument(uri, 'KSR.pv.get("$fake_thing(oops)")');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d => d.message.includes('Unknown pseudo-variable'))).toBe(true);
  });

  it('reports variable read but never set', async () => {
    const uri = 'file:///test/diag_undefined.py';
    await client.openDocument(uri, 'val = KSR.pv.get("$var(never_defined)")');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d => d.code === 'undefined-pv')).toBe(true);
  });

  it('does not warn for known bare PVs', async () => {
    const uri = 'file:///test/diag_known.py';
    await client.openDocument(uri, 'val = KSR.pv.get("$ru")');
    // Wait a bit then check — should have no diagnostics
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri);
    expect(diags).toHaveLength(0);
  });

  it('does not warn when variable is set before read', async () => {
    const uri = 'file:///test/diag_defined.py';
    const code = [
      'KSR.pv.sets("$var(x)", "hello")',
      'val = KSR.pv.get("$var(x)")',
    ].join('\n');
    await client.openDocument(uri, code);
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });
});

describe('E2E: Completions', () => {
  it('returns PV completions inside KSR.pv.get string after $', async () => {
    const uri = 'file:///test/comp_dollar.py';
    await client.openDocument(uri, 'KSR.pv.get("$")');
    const items = await client.getCompletions(uri, 0, 13);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some(c => c.label === '$ru')).toBe(true);
    expect(items.some(c => c.label === '$var(')).toBe(true);
  });

  it('returns variable name completions inside $var()', async () => {
    // First define some variables
    const defUri = 'file:///test/comp_defs.py';
    await client.openDocument(defUri, [
      'KSR.pv.sets("$var(caller)", "alice")',
      'KSR.pv.seti("$var(counter)", 1)',
    ].join('\n'));

    const uri = 'file:///test/comp_varname.py';
    await client.openDocument(uri, 'KSR.pv.get("$var()")');
    const items = await client.getCompletions(uri, 0, 17);
    expect(items.some(c => c.label === 'caller')).toBe(true);
    expect(items.some(c => c.label === 'counter')).toBe(true);
  });

  it('$var( completion snippet does not contain double dollar', async () => {
    const uri = 'file:///test/comp_snippet.py';
    await client.openDocument(uri, 'KSR.pv.get("$")');
    const items = await client.getCompletions(uri, 0, 13);
    const varItem = items.find(c => c.label === '$var(');
    expect(varItem).toBeDefined();
    const editText = (varItem!.textEdit as any)?.newText;
    expect(editText).toBeDefined();
    // Should be \$var($1) — escaped $ for snippet, $1 for cursor
    expect(editText).toBe('\\$var($1)');
    expect(editText).not.toContain('$$');
  });

  it('textEdit range covers typed prefix when completing $va -> $var(', async () => {
    const uri = 'file:///test/comp_replace.py';
    // User has typed "$va" inside the string
    await client.openDocument(uri, 'KSR.pv.get("$va")');
    // Cursor is after 'a', before closing quote. "$va" starts at col 12
    // string_content "$va" is at cols 12-15, cursor at col 15
    const items = await client.getCompletions(uri, 0, 15);
    expect(items.length).toBeGreaterThan(0);

    const varItem = items.find(c => c.label === '$var(');
    expect(varItem).toBeDefined();

    // The textEdit must REPLACE "$va" (cols 12-15), not insert at cursor
    const edit = varItem!.textEdit as any;
    expect(edit).toBeDefined();
    expect(edit.range.start.character).toBe(12); // starts at $
    expect(edit.range.end.character).toBe(15);   // ends at cursor (after 'a')
  });

  it('returns no completions outside KSR.pv strings', async () => {
    const uri = 'file:///test/comp_outside.py';
    await client.openDocument(uri, 'print("hello")');
    const items = await client.getCompletions(uri, 0, 8);
    // Should have zero items from our extension (may have items from other sources)
    const pvItems = items.filter(c => c.label.startsWith('$'));
    expect(pvItems).toHaveLength(0);
  });
});

describe('E2E: Hover', () => {
  it('returns hover info for bare PV', async () => {
    const uri = 'file:///test/hover_bare.py';
    await client.openDocument(uri, 'KSR.pv.get("$ru")');
    const hover = await client.getHover(uri, 0, 13);
    expect(hover).not.toBeNull();
    const content = (hover!.contents as any).value;
    expect(content).toContain('$ru');
    expect(content).toContain('Request URI');
  });

  it('returns null outside PV strings', async () => {
    const uri = 'file:///test/hover_outside.py';
    await client.openDocument(uri, 'print("hello")');
    const hover = await client.getHover(uri, 0, 0);
    expect(hover).toBeNull();
  });
});

describe('E2E: Go to Definition', () => {
  it('navigates from get to sets', async () => {
    const uri = 'file:///test/def_nav.py';
    const code = [
      'KSR.pv.sets("$var(target)", "hello")',
      'val = KSR.pv.get("$var(target)")',
    ].join('\n');
    await client.openDocument(uri, code);
    // Position on $var(target) in the get call (line 1)
    const defs = await client.getDefinitions(uri, 1, 22);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].range.start.line).toBe(0);
  });
});

describe('E2E: Find References', () => {
  it('finds all references across documents', async () => {
    const uri1 = 'file:///test/ref_a.py';
    const uri2 = 'file:///test/ref_b.py';
    await client.openDocument(uri1, 'KSR.pv.sets("$var(shared)", "val")');
    await client.openDocument(uri2, 'x = KSR.pv.get("$var(shared)")');
    const refs = await client.getReferences(uri2, 0, 20);
    expect(refs.length).toBe(2);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual([uri1, uri2]);
  });
});

describe('E2E: Semantic Tokens', () => {
  it('returns tokens for PV strings', async () => {
    const uri = 'file:///test/tokens.py';
    await client.openDocument(uri, 'KSR.pv.get("$ru")');
    const tokens = await client.getSemanticTokens(uri);
    expect(tokens).not.toBeNull();
    expect(tokens!.data.length).toBeGreaterThan(0);
  });
});

describe('E2E: Incremental Updates', () => {
  it('updates diagnostics after editing', async () => {
    const uri = 'file:///test/incremental.py';
    // Start with an undefined variable
    await client.openDocument(uri, 'val = KSR.pv.get("$var(undef)")');
    let diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d => d.code === 'undefined-pv')).toBe(true);

    // Add a sets() call before it — change the whole content
    await client.changeDocument(uri, [{
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 31 } },
      text: 'KSR.pv.sets("$var(undef)", "x")\nval = KSR.pv.get("$var(undef)")',
    }]);

    // Wait for debounced diagnostics to update
    await new Promise(r => setTimeout(r, 500));
    diags = client.getDiagnostics(uri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });
});
