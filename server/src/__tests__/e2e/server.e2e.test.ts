import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TestLspClient } from './lspClient';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let client: TestLspClient;

beforeAll(async () => {
  client = await TestLspClient.start();
}, 10000);

afterAll(async () => {
  await client.shutdown();
});

describe('E2E: Diagnostics', () => {
  it('reports unknown pseudo-variable as error', async () => {
    const uri = 'file:///test/diag_unknown.py';
    await client.openDocument(uri, 'KSR.pv.get("$fake_thing(oops)")');
    const diags = await client.waitForDiagnostics(uri);
    const unknownDiag = diags.find(d => d.message.includes('Unknown pseudo-variable'));
    expect(unknownDiag).toBeDefined();
    expect(unknownDiag!.severity).toBe(1); // DiagnosticSeverity.Error = 1
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

  it('does not suggest variables that are only read, never set', async () => {
    const defUri = 'file:///test/comp_filter_defs.py';
    await client.openDocument(defUri, [
      'KSR.pv.sets("$var(defined_var)", "val")',
      'x = KSR.pv.get("$var(only_read)")',
    ].join('\n'));

    const uri = 'file:///test/comp_filter.py';
    await client.openDocument(uri, 'KSR.pv.get("$var()")');
    const items = await client.getCompletions(uri, 0, 17);
    expect(items.some(c => c.label === 'defined_var')).toBe(true);
    expect(items.some(c => c.label === 'only_read')).toBe(false);
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

  it('returns hover info for PV inside f-string KSR.pv call', async () => {
    const uri = 'file:///test/hover_fstring.py';
    // x = f"{KSR.pv.get('$fU')}"  — char 20 is second char of $fU
    await client.openDocument(uri, 'x = f"{KSR.pv.get(\'$fU\')}"');
    const hover = await client.getHover(uri, 0, 20);
    expect(hover).not.toBeNull();
    const content = (hover!.contents as any).value;
    expect(content).toContain('$fU');
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

  it('finds all references for bare PVs across documents', async () => {
    const uri1 = 'file:///test/ref_bare_a.py';
    const uri2 = 'file:///test/ref_bare_b.py';
    await client.openDocument(uri1, 'val = KSR.pv.get("$rU")');
    await client.openDocument(uri2, 'user = KSR.pv.get("$rU")');
    const refs = await client.getReferences(uri2, 0, 20);
    expect(refs.length).toBe(2);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual([uri1, uri2]);
  });

  it('finds references for PV inside f-string KSR.pv call', async () => {
    const uri1 = 'file:///test/ref_fstr_a.py';
    const uri2 = 'file:///test/ref_fstr_b.py';
    // Use $tU to avoid collision with other tests using $ru/$rU
    await client.openDocument(uri1, 'KSR.pv.get("$tU")');
    // x = f"{KSR.pv.get('$tU')}"  — char 20 is second char of $tU
    await client.openDocument(uri2, 'x = f"{KSR.pv.get(\'$tU\')}"');
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

describe('E2E: Cross-file PV resolution', () => {
  it('no warning when variable is set in another open file', async () => {
    const setterUri = 'file:///test/cross/setter.py';
    const readerUri = 'file:///test/cross/reader.py';

    await client.openDocument(setterUri, 'KSR.pv.sets("$var(cross_file)", "val")');
    await client.openDocument(readerUri, 'x = KSR.pv.get("$var(cross_file)")');

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(readerUri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('warns when variable is set nowhere across all files', async () => {
    const uri = 'file:///test/cross/lonely.py';
    await client.openDocument(uri, 'x = KSR.pv.get("$var(truly_missing)")');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d => d.code === 'undefined-pv')).toBe(true);
  });
});

describe('E2E: Call chain analysis', () => {
  it('no warning when variable is set through a direct call chain', async () => {
    // helpers.py defines a function that sets a variable
    const helpersUri = 'file:///test/chain/helpers.py';
    await client.openDocument(helpersUri, [
      'def setup_vars():',
      '    KSR.pv.sets("$var(from_helper)", "val")',
    ].join('\n'));

    // main.py calls setup_vars() and reads the variable
    const mainUri = 'file:///test/chain/main.py';
    await client.openDocument(mainUri, [
      'from helpers import setup_vars',
      '',
      'def ksr_request_route(msg):',
      '    setup_vars()',
      '    val = KSR.pv.get("$var(from_helper)")',
    ].join('\n'));

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(mainUri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('no warning when variable is set through a transitive call chain', async () => {
    // deep.py sets the variable
    const deepUri = 'file:///test/chain2/deep.py';
    await client.openDocument(deepUri, [
      'def set_deep():',
      '    KSR.pv.sets("$var(deep_var)", "deep_val")',
    ].join('\n'));

    // middle.py calls deep
    const middleUri = 'file:///test/chain2/middle.py';
    await client.openDocument(middleUri, [
      'from deep import set_deep',
      '',
      'def middle_func():',
      '    set_deep()',
    ].join('\n'));

    // top.py calls middle and reads the variable
    const topUri = 'file:///test/chain2/top.py';
    await client.openDocument(topUri, [
      'from middle import middle_func',
      '',
      'def ksr_request_route(msg):',
      '    middle_func()',
      '    val = KSR.pv.get("$var(deep_var)")',
    ].join('\n'));

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(topUri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('no warning when variable is set in same-file helper function', async () => {
    const uri = 'file:///test/chain/samefile.py';
    await client.openDocument(uri, [
      'def init_vars():',
      '    KSR.pv.sets("$var(local_chain)", "val")',
      '',
      'def ksr_request_route(msg):',
      '    init_vars()',
      '    val = KSR.pv.get("$var(local_chain)")',
    ].join('\n'));

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('completions include variables set through call chains', async () => {
    // A helper sets variables
    const helperUri = 'file:///test/chain_comp/helper.py';
    await client.openDocument(helperUri, [
      'def setup():',
      '    KSR.pv.sets("$var(chain_complete)", "val")',
    ].join('\n'));

    // Main file has an empty get
    const mainUri = 'file:///test/chain_comp/main.py';
    await client.openDocument(mainUri, 'x = KSR.pv.get("$var()")');
    const items = await client.getCompletions(mainUri, 0, 21);
    expect(items.some(c => c.label === 'chain_complete')).toBe(true);
  });
});

describe('E2E: Multiple PV types across files', () => {
  it('tracks $shv variables across files', async () => {
    const setUri = 'file:///test/shv/setter.py';
    const getUri = 'file:///test/shv/reader.py';

    await client.openDocument(setUri, 'KSR.pv.sets("$shv(global_counter)", "0")');
    await client.openDocument(getUri, 'x = KSR.pv.get("$shv(global_counter)")');

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(getUri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('tracks $avp variables across files', async () => {
    const setUri = 'file:///test/avp/setter.py';
    const getUri = 'file:///test/avp/reader.py';

    await client.openDocument(setUri, 'KSR.pv.sets("$avp(auth_user)", "alice")');
    await client.openDocument(getUri, 'x = KSR.pv.get("$avp(auth_user)")');

    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(getUri);
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('$var and $shv with same name are distinct', async () => {
    const uri = 'file:///test/distinct/vars.py';
    await client.openDocument(uri, [
      'KSR.pv.sets("$var(x)", "val")',
      'y = KSR.pv.get("$shv(x)")',
    ].join('\n'));

    const diags = await client.waitForDiagnostics(uri);
    // $shv(x) was never set — only $var(x) was
    expect(diags.some(d => d.code === 'undefined-pv' && d.message.includes('$shv(x)'))).toBe(true);
  });
});

describe('E2E: Workspace indexing (files on disk, not opened in editor)', () => {
  let wsClient: TestLspClient;
  let tmpDir: string;

  beforeAll(async () => {
    // Create a temp workspace with .py files on disk
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kemi-ws-test-'));

    // File 1: sets $var(disk_var) — NOT opened in editor
    fs.writeFileSync(path.join(tmpDir, 'setter.py'), [
      'def setup():',
      '    KSR.pv.sets("$var(disk_var)", "from_disk")',
      '    KSR.pv.sets("$shv(disk_shared)", "shared_val")',
    ].join('\n'));

    // File 2: helper that calls setup() — NOT opened in editor
    fs.writeFileSync(path.join(tmpDir, 'helpers.py'), [
      'from setter import setup',
      '',
      'def init_all():',
      '    setup()',
      '    KSR.pv.sets("$var(helper_var)", "helper_val")',
    ].join('\n'));

    // Start server with the temp directory as workspace root
    wsClient = await TestLspClient.start([
      { uri: 'file://' + tmpDir, name: 'test-workspace' },
    ]);

    // Give workspace indexer time to scan all files
    await new Promise(r => setTimeout(r, 500));
  }, 15000);

  afterAll(async () => {
    await wsClient.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds PV definitions from disk files without opening them', async () => {
    // Open a NEW file that reads $var(disk_var) — set in setter.py on disk
    const readerUri = 'file://' + path.join(tmpDir, 'reader.py');
    await wsClient.openDocument(readerUri, 'x = KSR.pv.get("$var(disk_var)")');

    await new Promise(r => setTimeout(r, 500));
    const diags = wsClient.getDiagnostics(readerUri);
    // Should NOT warn — setter.py was indexed from disk
    expect(diags.filter(d => d.code === 'undefined-pv')).toHaveLength(0);
  });

  it('finds references across disk-indexed and editor-opened files', async () => {
    // Open a file that uses $shv(disk_shared) — set in setter.py on disk
    const uri = 'file://' + path.join(tmpDir, 'ref_check.py');
    await wsClient.openDocument(uri, 'y = KSR.pv.get("$shv(disk_shared)")');

    const refs = await wsClient.getReferences(uri, 0, 20);
    // Should find at least 2: one in setter.py (disk), one in ref_check.py (editor)
    expect(refs.length).toBeGreaterThanOrEqual(2);

    const refUris = refs.map(r => r.uri);
    expect(refUris).toContain('file://' + path.join(tmpDir, 'setter.py'));
    expect(refUris).toContain(uri);
  });

  it('go-to-definition jumps to disk-indexed file', async () => {
    const uri = 'file://' + path.join(tmpDir, 'goto_check.py');
    await wsClient.openDocument(uri, 'z = KSR.pv.get("$var(helper_var)")');

    const defs = await wsClient.getDefinitions(uri, 0, 20);
    expect(defs.length).toBeGreaterThan(0);
    // Definition should be in helpers.py (the disk file)
    expect(defs[0].uri).toBe('file://' + path.join(tmpDir, 'helpers.py'));
  });

  it('completions include variables from disk-indexed files', async () => {
    const uri = 'file://' + path.join(tmpDir, 'comp_check.py');
    await wsClient.openDocument(uri, 'KSR.pv.get("$var()")');

    const items = await wsClient.getCompletions(uri, 0, 17);
    // Should include variables from setter.py and helpers.py on disk
    expect(items.some(c => c.label === 'disk_var')).toBe(true);
    expect(items.some(c => c.label === 'helper_var')).toBe(true);
  });

  it('warns correctly when variable is not set anywhere on disk', async () => {
    const uri = 'file://' + path.join(tmpDir, 'missing_check.py');
    await wsClient.openDocument(uri, 'w = KSR.pv.get("$var(not_on_disk)")');

    const diags = await wsClient.waitForDiagnostics(uri);
    expect(diags.some(d => d.code === 'undefined-pv')).toBe(true);
  });
});

describe('E2E: Callback function validation', () => {
  it('warns when callback function does not exist', async () => {
    const uri = 'file:///test/cb_missing.py';
    await client.openDocument(uri, 'KSR.tm.t_on_failure("nonexistent_func")');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d =>
      d.message.includes('nonexistent_func') && d.code === 'undefined-callback'
    )).toBe(true);
  });

  it('does not warn when callback function exists in same file', async () => {
    const uri = 'file:///test/cb_exists.py';
    const code = [
      'def ksr_failure_manage():',
      '    pass',
      '',
      'KSR.tm.t_on_failure("ksr_failure_manage")',
    ].join('\n');
    await client.openDocument(uri, code);
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri);
    expect(diags.filter(d => d.code === 'undefined-callback')).toHaveLength(0);
  });

  it('does not warn when callback function exists in another file', async () => {
    const defUri = 'file:///test/cb_cross_def.py';
    const useUri = 'file:///test/cb_cross_use.py';
    await client.openDocument(defUri, [
      'def ksr_branch_handler():',
      '    pass',
    ].join('\n'));
    await client.openDocument(useUri, 'KSR.tm.t_on_branch("ksr_branch_handler")');
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(useUri);
    expect(diags.filter(d => d.code === 'undefined-callback')).toHaveLength(0);
  });

  it('does not warn when callback is a class method', async () => {
    const uri = 'file:///test/cb_class_method.py';
    const code = [
      'class Kamailio:',
      '    def ksr_failure_manage(self):',
      '        pass',
      '',
      '    def route(self):',
      '        KSR.tm.t_on_failure("ksr_failure_manage")',
    ].join('\n');
    await client.openDocument(uri, code);
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri);
    expect(diags.filter(d => d.code === 'undefined-callback')).toHaveLength(0);
  });

  it('navigates to class method definition from callback', async () => {
    const uri = 'file:///test/cb_class_goto.py';
    const code = [
      'class Kamailio:',
      '    def ksr_class_failure_handler(self):',
      '        pass',
      '',
      '    def route(self):',
      '        KSR.tm.t_on_failure("ksr_class_failure_handler")',
    ].join('\n');
    await client.openDocument(uri, code);
    // line 5: '        KSR.tm.t_on_failure("ksr_class_failure_handler")'
    // char 33 is inside the callback name
    const defs = await client.getDefinitions(uri, 5, 33);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].range.start.line).toBe(1);
  });

  it('validates t_on_branch callbacks too', async () => {
    const uri = 'file:///test/cb_branch_missing.py';
    await client.openDocument(uri, 'KSR.tm.t_on_branch("nonexistent_branch_handler")');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d =>
      d.message.includes('nonexistent_branch_handler') && d.code === 'undefined-callback'
    )).toBe(true);
  });

  it('navigates from callback string to function definition', async () => {
    const uri = 'file:///test/cb_goto.py';
    const code = [
      'def ksr_failure_manage():',
      '    pass',
      '',
      'KSR.tm.t_on_failure("ksr_failure_manage")',
    ].join('\n');
    await client.openDocument(uri, code);
    // char 25 is inside "ksr_failure_manage" on line 3
    const defs = await client.getDefinitions(uri, 3, 25);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].range.start.line).toBe(0);
  });

  it('navigates to function definition in another file', async () => {
    const defUri = 'file:///test/cb_goto_def.py';
    const useUri = 'file:///test/cb_goto_use.py';
    await client.openDocument(defUri, [
      'def ksr_on_branch_auth():',
      '    pass',
    ].join('\n'));
    await client.openDocument(useUri, 'KSR.tm.t_on_branch("ksr_on_branch_auth")');
    // char 25 is inside "ksr_on_branch_auth" on line 0
    const defs = await client.getDefinitions(useUri, 0, 25);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].uri).toBe(defUri);
    expect(defs[0].range.start.line).toBe(0);
  });

  it('suggests function names inside callback string', async () => {
    const uri = 'file:///test/cb_comp.py';
    const code = [
      'def ksr_failure_manage():',
      '    pass',
      '',
      'def ksr_on_branch_auth():',
      '    pass',
      '',
      'KSR.tm.t_on_failure("")',
    ].join('\n');
    await client.openDocument(uri, code);
    // char 21 is between the quotes in t_on_failure("") on line 6
    const items = await client.getCompletions(uri, 6, 21);
    expect(items.some(c => c.label === 'ksr_failure_manage')).toBe(true);
    expect(items.some(c => c.label === 'ksr_on_branch_auth')).toBe(true);
  });
});

describe('E2E: Htable tracking', () => {
  it('suggests table names inside KSR.htable first arg', async () => {
    const uri1 = 'file:///test/ht_usage.py';
    const uri2 = 'file:///test/ht_comp.py';
    await client.openDocument(uri1, 'KSR.htable.sht_get("DestList", key)');
    await client.openDocument(uri2, 'KSR.htable.sht_get("")');
    // char 20 is between the quotes in sht_get("")
    const items = await client.getCompletions(uri2, 0, 20);
    expect(items.some(c => c.label === 'DestList')).toBe(true);
  });

  it('collects table names from different htable methods', async () => {
    const uri1 = 'file:///test/ht_sets.py';
    const uri2 = 'file:///test/ht_gets.py';
    await client.openDocument(uri1, 'KSR.htable.sht_sets("SessionCache", key, val)');
    await client.openDocument(uri2, 'KSR.htable.sht_get("")');
    const items = await client.getCompletions(uri2, 0, 20);
    expect(items.some(c => c.label === 'SessionCache')).toBe(true);
  });

  it('returns hover for htable table name', async () => {
    const uri1 = 'file:///test/ht_hover_a.py';
    const uri2 = 'file:///test/ht_hover_b.py';
    await client.openDocument(uri1, 'KSR.htable.sht_get("RouteCache", key)');
    await client.openDocument(uri2, 'KSR.htable.sht_sets("RouteCache", key, val)');
    // char 22 is inside "RouteCache" in sht_get on uri1
    const hover = await client.getHover(uri1, 0, 22);
    expect(hover).not.toBeNull();
    const content = (hover!.contents as any).value;
    expect(content).toContain('RouteCache');
    expect(content).toContain('sht_get');
    expect(content).toContain('sht_sets');
  });

  it('finds all references for a table name across documents', async () => {
    const uri1 = 'file:///test/ht_ref_a.py';
    const uri2 = 'file:///test/ht_ref_b.py';
    const uri3 = 'file:///test/ht_ref_c.py';
    await client.openDocument(uri1, 'KSR.htable.sht_get("RefTable", key)');
    await client.openDocument(uri2, 'KSR.htable.sht_sets("RefTable", key, val)');
    await client.openDocument(uri3, 'KSR.htable.sht_rm("RefTable", key)');
    // char 22 is inside "RefTable" on uri1
    const refs = await client.getReferences(uri1, 0, 22);
    expect(refs.length).toBe(3);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual([uri1, uri2, uri3]);
  });

  it('warns when htable is read but never written to', async () => {
    const uri = 'file:///test/ht_nowrite.py';
    await client.openDocument(uri, 'KSR.htable.sht_get("NeverWritten", key)');
    const diags = await client.waitForDiagnostics(uri);
    expect(diags.some(d =>
      d.message.includes('NeverWritten') && d.code === 'htable-never-set'
    )).toBe(true);
  });

  it('does not warn when htable is written in another file', async () => {
    const uri1 = 'file:///test/ht_write.py';
    const uri2 = 'file:///test/ht_read.py';
    await client.openDocument(uri1, 'KSR.htable.sht_sets("WrittenTable", key, val)');
    await client.openDocument(uri2, 'KSR.htable.sht_get("WrittenTable", key)');
    await new Promise(r => setTimeout(r, 500));
    const diags = client.getDiagnostics(uri2);
    expect(diags.filter(d => d.code === 'htable-never-set')).toHaveLength(0);
  });
});

describe('E2E: SIP header completions', () => {
  it('suggests standard SIP headers inside KSR.hdr.get', async () => {
    const uri = 'file:///test/hdr_comp.py';
    await client.openDocument(uri, 'KSR.hdr.get("")');
    // char 13 is between the quotes
    const items = await client.getCompletions(uri, 0, 13);
    expect(items.some(c => c.label === 'Via')).toBe(true);
    expect(items.some(c => c.label === 'From')).toBe(true);
    expect(items.some(c => c.label === 'To')).toBe(true);
    expect(items.some(c => c.label === 'Call-ID')).toBe(true);
    expect(items.some(c => c.label === 'Route')).toBe(true);
  });

  it('suggests standard SIP headers inside KSR.hdr.is_present', async () => {
    const uri = 'file:///test/hdr_present.py';
    await client.openDocument(uri, 'KSR.hdr.is_present("")');
    // char 20 is between the quotes
    const items = await client.getCompletions(uri, 0, 20);
    expect(items.some(c => c.label === 'Reason')).toBe(true);
    expect(items.some(c => c.label === 'Contact')).toBe(true);
  });

  it('also suggests custom headers seen in the workspace', async () => {
    const uri1 = 'file:///test/hdr_custom_def.py';
    const uri2 = 'file:///test/hdr_custom_use.py';
    await client.openDocument(uri1, 'KSR.hdr.get("X-My-Custom-Header")');
    await client.openDocument(uri2, 'KSR.hdr.get("")');
    const items = await client.getCompletions(uri2, 0, 13);
    expect(items.some(c => c.label === 'X-My-Custom-Header')).toBe(true);
  });

  it('returns hover for standard SIP header', async () => {
    const uri = 'file:///test/hdr_hover.py';
    await client.openDocument(uri, 'KSR.hdr.get("Via")');
    // char 14 is inside "Via"
    const hover = await client.getHover(uri, 0, 14);
    expect(hover).not.toBeNull();
    const content = (hover!.contents as any).value;
    expect(content).toContain('Via');
  });

  it('finds all references for a header name across documents', async () => {
    const uri1 = 'file:///test/hdr_ref_a.py';
    const uri2 = 'file:///test/hdr_ref_b.py';
    await client.openDocument(uri1, 'KSR.hdr.get("Reason")');
    await client.openDocument(uri2, 'KSR.hdr.is_present("Reason")');
    // char 14 is inside "Reason" on uri1
    const refs = await client.getReferences(uri1, 0, 14);
    expect(refs.length).toBe(2);
    const uris = refs.map(r => r.uri).sort();
    expect(uris).toEqual([uri1, uri2]);
  });

  it('resolves constants used as header names', async () => {
    const uri1 = 'file:///test/hdr_const.py';
    const uri2 = 'file:///test/hdr_const_comp.py';
    const code = [
      'MY_HEADER = "X-Custom-Auth"',
      'KSR.hdr.get(MY_HEADER)',
    ].join('\n');
    await client.openDocument(uri1, code);
    await client.openDocument(uri2, 'KSR.hdr.get("")');
    // "X-Custom-Auth" should appear in completions from constant resolution
    const items = await client.getCompletions(uri2, 0, 13);
    expect(items.some(c => c.label === 'X-Custom-Auth')).toBe(true);
  });

  it('resolves constants used as htable table names', async () => {
    const uri1 = 'file:///test/ht_const.py';
    const uri2 = 'file:///test/ht_const_comp.py';
    const code = [
      'TABLE_NAME = "MyTable"',
      'KSR.htable.sht_get(TABLE_NAME, key)',
    ].join('\n');
    await client.openDocument(uri1, code);
    await client.openDocument(uri2, 'KSR.htable.sht_get("")');
    const items = await client.getCompletions(uri2, 0, 20);
    expect(items.some(c => c.label === 'MyTable')).toBe(true);
  });
});
