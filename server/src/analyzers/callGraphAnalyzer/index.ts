import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  Location,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver';
import {
  Analyzer,
  AnalysisContext,
  DocumentContext,
  SemanticTokenData,
  TreeSitterRange,
} from '../../core/types';
import { CallGraph } from './callGraph';
import { ImportResolver, ImportBinding } from './importResolver';
import { extractFunctions, ExtractedFunction, FunctionDef } from './functionExtractor';
import { STANDARD_SIP_HEADERS, findStandardHeader } from '../../data/sipHeaders';
import { MarkupKind } from 'vscode-languageserver';
import { SyntaxNode, Tree } from 'web-tree-sitter';

const CALLBACK_METHODS = new Set(['t_on_failure', 't_on_branch']);
const HTABLE_METHODS = new Set([
  'sht_get', 'sht_gete', 'sht_sets', 'sht_seti', 'sht_inc', 'sht_rm',
]);
const HTABLE_WRITE_METHODS = new Set(['sht_sets', 'sht_seti', 'sht_inc']);
const HDR_METHODS = new Set([
  'get', 'gete', 'gete_idx', 'is_present', 'remove',
]);
const STAT_METHODS = new Set(['update_stat']);

interface CallbackReference {
  name: string;
  method: string;
  nameRange: TreeSitterRange;
}

interface HtableReference {
  tableName: string;
  method: string;
  nameRange: TreeSitterRange;
}

interface HdrReference {
  headerName: string;
  method: string;
  nameRange: TreeSitterRange;
}

interface StatReference {
  statName: string;
  nameRange: TreeSitterRange;
}

export class CallGraphAnalyzer implements Analyzer {
  readonly id = 'callGraph';
  readonly name = 'Call Graph Analyzer';

  private callGraph = new CallGraph();
  private importResolver = new ImportResolver();
  private importsByFile: Map<string, ImportBinding[]> = new Map();
  private functionsByFile: Map<string, ExtractedFunction[]> = new Map();
  private callbacksByFile: Map<string, CallbackReference[]> = new Map();
  private htablesByFile: Map<string, HtableReference[]> = new Map();
  private hdrsByFile: Map<string, HdrReference[]> = new Map();
  private statsByFile: Map<string, StatReference[]> = new Map();
  private rawStringsByFile: Map<string, Map<string, string>> = new Map();
  private rawAliasesByFile: Map<string, Map<string, string>> = new Map();

  constructor(
    private getWorkspaceRoots: () => string[],
    private getKnownFiles: () => Set<string>,
    private getDeclaredStats: () => Map<string, { name: string; uri: string; line: number }> = () => new Map()
  ) {}

  analyze(context: AnalysisContext): void {
    const { uri, tree } = context;

    // Remove old data for this file
    this.callGraph.removeFile(uri);

    // Extract imports and resolve module paths
    const imports = this.importResolver.extractImports(tree);
    const workspaceRoots = this.getWorkspaceRoots();
    const knownFiles = this.getKnownFiles();
    for (const imp of imports) {
      imp.resolvedUri = this.importResolver.resolveModulePath(
        imp.modulePath, uri, workspaceRoots, knownFiles
      );
    }
    this.importsByFile.set(uri, imports);

    // Extract functions, call sites, PV accesses
    const functions = extractFunctions(tree, uri);
    this.functionsByFile.set(uri, functions);

    // Register functions in the call graph
    for (const fn of functions) {
      this.callGraph.addFunction(fn.def);
      const fnKey = CallGraph.qualifiedKey(uri, fn.def.name);
      this.callGraph.setDirectPvAccess(fnKey, fn.pvReads, fn.pvWrites);
    }

    // Resolve call edges
    for (const fn of functions) {
      const fnKey = CallGraph.qualifiedKey(uri, fn.def.name);
      for (const callSite of fn.callSites) {
        const resolved = this.resolveCallee(callSite.callee, uri);
        if (resolved) {
          this.callGraph.addEdge(fnKey, resolved);
        }
      }
    }

    // Collect raw string assignments and aliases for cross-file constant resolution.
    const { rawStrings, rawAliases } = extractRawConstants(tree);
    this.rawStringsByFile.set(uri, rawStrings);
    this.rawAliasesByFile.set(uri, rawAliases);
    const allConstants = this.getAllConstants();

    // Extract callback registrations (KSR.tm.t_on_failure/t_on_branch)
    const callbacks = extractCallbackRegistrations(tree, allConstants);
    this.callbacksByFile.set(uri, callbacks);

    // Extract htable references (KSR.htable.sht_*)
    const htables = extractHtableReferences(tree, allConstants);
    this.htablesByFile.set(uri, htables);

    // Extract header references (KSR.hdr.*)
    const hdrs = extractHdrReferences(tree, allConstants);
    this.hdrsByFile.set(uri, hdrs);

    // Extract statistic references (KSR.statistics.update_stat)
    const stats = extractStatReferences(tree, allConstants);
    this.statsByFile.set(uri, stats);
  }

  private resolveCallee(callee: string, fromUri: string): string | null {
    // Check local functions in the same file
    const localFunctions = this.functionsByFile.get(fromUri);
    if (localFunctions) {
      const local = localFunctions.find((f) => f.def.name === callee);
      if (local) return CallGraph.qualifiedKey(fromUri, callee);
    }

    // Check imports
    const resolved = this.importResolver.resolveCallTarget(
      callee, fromUri, this.importsByFile
    );
    if (resolved) return CallGraph.qualifiedKey(resolved.uri, resolved.name);

    // Fallback: unique global name match
    const globalMatches = this.callGraph.getFunctionsByName(callee);
    if (globalMatches.length === 1) {
      return CallGraph.qualifiedKey(globalMatches[0].def.uri, callee);
    }

    return null;
  }

  // --- Analyzer interface ---

  getSemanticTokens(_doc: DocumentContext): SemanticTokenData[] { return []; }

  getReferences(doc: DocumentContext, position: Position): Location[] {
    // Htable references
    const ht = this.findHtableAtPosition(doc, position);
    if (ht) {
      const refs: Location[] = [];
      for (const [uri, htRefs] of this.htablesByFile) {
        for (const ref of htRefs) {
          if (ref.tableName === ht.tableName) {
            refs.push({ uri, range: toRange(ref.nameRange) });
          }
        }
      }
      return refs;
    }

    // Hdr references
    const hdr = this.findHdrAtPosition(doc, position);
    if (hdr) {
      const refs: Location[] = [];
      for (const [uri, hdrRefs] of this.hdrsByFile) {
        for (const ref of hdrRefs) {
          if (ref.headerName === hdr.headerName) {
            refs.push({ uri, range: toRange(ref.nameRange) });
          }
        }
      }
      return refs;
    }

    // Stat references
    const stat = this.findStatAtPosition(doc, position);
    if (stat) {
      const refs: Location[] = [];
      for (const [uri, statRefs] of this.statsByFile) {
        for (const ref of statRefs) {
          if (ref.statName === stat.statName) {
            refs.push({ uri, range: toRange(ref.nameRange) });
          }
        }
      }
      return refs;
    }

    return [];
  }

  getHover(doc: DocumentContext, position: Position): Hover | null {
    // Htable hover
    const ht = this.findHtableAtPosition(doc, position);
    if (ht) {
      const methods = new Map<string, number>();
      for (const refs of this.htablesByFile.values()) {
        for (const ref of refs) {
          if (ref.tableName === ht.tableName) {
            methods.set(ref.method, (methods.get(ref.method) || 0) + 1);
          }
        }
      }
      const lines = [
        `**htable: ${ht.tableName}**`,
        '',
        ...Array.from(methods.entries()).map(([m, count]) => `- \`${m}\`: ${count} call site${count > 1 ? 's' : ''}`),
      ];
      return {
        contents: { kind: MarkupKind.Markdown, value: lines.join('\n') },
        range: toRange(ht.nameRange),
      };
    }

    // SIP header hover
    const hdr = this.findHdrAtPosition(doc, position);
    if (hdr) {
      const standard = findStandardHeader(hdr.headerName);
      const lines = [
        `**${hdr.headerName}**`,
        '',
        standard ? standard.description : 'Custom SIP header',
      ];
      if (standard?.rfc) lines.push('', `*${standard.rfc}*`);
      return {
        contents: { kind: MarkupKind.Markdown, value: lines.join('\n') },
        range: toRange(hdr.nameRange),
      };
    }

    // Stat hover
    const stat = this.findStatAtPosition(doc, position);
    if (stat) {
      const declared = this.getDeclaredStats().has(stat.statName);
      let count = 0;
      for (const refs of this.statsByFile.values()) {
        count += refs.filter(r => r.statName === stat.statName).length;
      }
      const lines = [
        `**statistic: ${stat.statName}**`,
        '',
        declared ? 'Declared in kamailio.cfg' : 'Not declared in kamailio.cfg',
        '',
        `${count} reference${count !== 1 ? 's' : ''} in workspace`,
      ];
      return {
        contents: { kind: MarkupKind.Markdown, value: lines.join('\n') },
        range: toRange(stat.nameRange),
      };
    }

    return null;
  }

  getDiagnostics(doc: DocumentContext): Diagnostic[] {
    const diags: Diagnostic[] = [];

    // Callback validation
    const callbacks = this.callbacksByFile.get(doc.uri);
    if (callbacks) {
      for (const cb of callbacks) {
        if (!this.findFunctionByName(cb.name)) {
          diags.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: cb.nameRange.startPosition.row, character: cb.nameRange.startPosition.column },
              end: { line: cb.nameRange.endPosition.row, character: cb.nameRange.endPosition.column },
            },
            message: `Callback function '${cb.name}' is not defined in the workspace`,
            source: 'kamailio-callback',
            code: 'undefined-callback',
          });
        }
      }
    }

    // Htable read-without-write validation
    const htables = this.htablesByFile.get(doc.uri);
    if (htables) {
      const warned = new Set<string>();
      for (const ht of htables) {
        if (HTABLE_WRITE_METHODS.has(ht.method)) continue;
        if (warned.has(ht.tableName)) continue;
        if (!this.hasHtableWrite(ht.tableName)) {
          warned.add(ht.tableName);
          diags.push({
            severity: DiagnosticSeverity.Warning,
            range: {
              start: { line: ht.nameRange.startPosition.row, character: ht.nameRange.startPosition.column },
              end: { line: ht.nameRange.endPosition.row, character: ht.nameRange.endPosition.column },
            },
            message: `Hash table '${ht.tableName}' is read but never written to in the workspace`,
            source: 'kamailio-htable',
            code: 'htable-never-set',
          });
        }
      }
    }

    // Statistics validation: flag undeclared stat names
    const stats = this.statsByFile.get(doc.uri);
    const declaredStats = this.getDeclaredStats();
    if (stats && declaredStats.size > 0) {
      for (const st of stats) {
        if (!declaredStats.has(st.statName)) {
          diags.push({
            severity: DiagnosticSeverity.Warning,
            range: toRange(st.nameRange),
            message: `Statistic '${st.statName}' is not declared in kamailio.cfg`,
            source: 'kamailio-stat',
            code: 'undeclared-stat',
          });
        }
      }
    }

    return diags;
  }

  private hasHtableWrite(tableName: string): boolean {
    for (const refs of this.htablesByFile.values()) {
      for (const ref of refs) {
        if (ref.tableName === tableName && HTABLE_WRITE_METHODS.has(ref.method)) {
          return true;
        }
      }
    }
    return false;
  }

  getDefinitions(doc: DocumentContext, position: Position): Location[] {
    // Callback → function definition
    const cb = this.findCallbackAtPosition(doc, position);
    if (cb) {
      const funcDef = this.findFunctionByName(cb.name);
      if (!funcDef) return [];
      return [{
        uri: funcDef.uri,
        range: {
          start: { line: funcDef.nameRange.startPosition.row, character: funcDef.nameRange.startPosition.column },
          end: { line: funcDef.nameRange.endPosition.row, character: funcDef.nameRange.endPosition.column },
        },
      }];
    }

    // Stat → kamailio.cfg declaration
    const stat = this.findStatAtPosition(doc, position);
    if (stat) {
      const decl = this.getDeclaredStats().get(stat.statName);
      if (!decl) return [];
      return [{
        uri: decl.uri,
        range: {
          start: { line: decl.line, character: 0 },
          end: { line: decl.line, character: 0 },
        },
      }];
    }

    return [];
  }

  getCompletions(doc: DocumentContext, position: Position): CompletionItem[] {
    const node = doc.tree.rootNode.descendantForPosition({
      row: position.line,
      column: position.character,
    });
    if (!node) return [];

    if (this.isInsideCallbackString(node)) {
      return this.getCallbackCompletions(node, position);
    }

    if (this.isInsideHtableString(node)) {
      return this.getHtableCompletions(node, position);
    }

    if (this.isInsideHdrString(node)) {
      return this.getHdrCompletions(node, position);
    }

    if (this.isInsideStatString(node)) {
      return this.getStatCompletions(node, position);
    }

    return [];
  }

  onDocumentRemoved(uri: string): void {
    this.callGraph.removeFile(uri);
    this.importsByFile.delete(uri);
    this.functionsByFile.delete(uri);
    this.callbacksByFile.delete(uri);
    this.htablesByFile.delete(uri);
    this.hdrsByFile.delete(uri);
    this.statsByFile.delete(uri);
    this.rawStringsByFile.delete(uri);
    this.rawAliasesByFile.delete(uri);
  }

  // --- Public API for PvAnalyzer ---

  getCallGraph(): CallGraph { return this.callGraph; }

  private getAllConstants(): StringConstants {
    // Merge raw strings and aliases from all files
    const allStrings: Map<string, string> = new Map();
    const allAliases: Map<string, string> = new Map();
    for (const strings of this.rawStringsByFile.values()) {
      for (const [k, v] of strings) allStrings.set(k, v);
    }
    for (const aliases of this.rawAliasesByFile.values()) {
      for (const [k, v] of aliases) allAliases.set(k, v);
    }
    // Resolve alias chains across the merged global data
    const constants: StringConstants = new Map(allStrings);
    for (const [name, target] of allAliases) {
      const resolved = resolveAliasChain(target, allStrings, allAliases);
      if (resolved !== undefined) {
        constants.set(name, resolved);
      }
    }
    return constants;
  }

  // --- Private helpers ---

  private findFunctionByName(name: string): FunctionDef | null {
    for (const functions of this.functionsByFile.values()) {
      for (const fn of functions) {
        if (fn.def.name === name) return fn.def;
      }
    }
    return null;
  }

  private findCallbackAtPosition(doc: DocumentContext, position: Position): CallbackReference | undefined {
    const callbacks = this.callbacksByFile.get(doc.uri);
    if (!callbacks) return undefined;

    const offset = positionToOffset(doc.fullText, position);
    return callbacks.find(
      (cb) => offset >= cb.nameRange.startIndex && offset < cb.nameRange.endIndex
    );
  }

  private isInsideCallbackString(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    let stringNode: SyntaxNode | null = null;

    while (current) {
      if (current.type === 'string') {
        stringNode = current;
      } else if (current.type === 'string_content' || current.type === 'string_start' || current.type === 'string_end') {
        stringNode = current.parent;
      }
      if (current.type === 'call' && stringNode) {
        const funcNode = current.childForFieldName('function');
        if (funcNode && isKsrTmCallbackMethod(funcNode)) {
          return true;
        }
      }
      current = current.parent;
    }
    return false;
  }

  private getCallbackCompletions(node: SyntaxNode, position: Position): CompletionItem[] {
    const replaceRange = this.getStringContentRange(node, position);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const functions of this.functionsByFile.values()) {
      for (const fn of functions) {
        if (fn.def.name === '<module>') continue;
        if (seen.has(fn.def.name)) continue;
        seen.add(fn.def.name);
        items.push({
          label: fn.def.name,
          kind: CompletionItemKind.Function,
          sortText: `0${fn.def.name}`,
          textEdit: TextEdit.replace(replaceRange, fn.def.name),
        });
      }
    }
    return items;
  }

  private getHtableCompletions(node: SyntaxNode, position: Position): CompletionItem[] {
    const replaceRange = this.getStringContentRange(node, position);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();
    for (const refs of this.htablesByFile.values()) {
      for (const ref of refs) {
        if (seen.has(ref.tableName)) continue;
        seen.add(ref.tableName);
        items.push({
          label: ref.tableName,
          kind: CompletionItemKind.Value,
          sortText: `0${ref.tableName}`,
          textEdit: TextEdit.replace(replaceRange, ref.tableName),
        });
      }
    }
    return items;
  }

  private isInsideHtableString(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    let stringNode: SyntaxNode | null = null;

    while (current) {
      if (current.type === 'string') {
        stringNode = current;
      } else if (current.type === 'string_content' || current.type === 'string_start' || current.type === 'string_end') {
        stringNode = current.parent;
      }
      if (current.type === 'call' && stringNode) {
        // Check that the string is the FIRST argument (table name)
        const argsNode = current.childForFieldName('arguments');
        if (argsNode) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.startIndex === stringNode.startIndex) {
            const funcNode = current.childForFieldName('function');
            if (funcNode && isKsrHtableMethod(funcNode)) {
              return true;
            }
          }
        }
      }
      current = current.parent;
    }
    return false;
  }

  private findHtableAtPosition(doc: DocumentContext, position: Position): HtableReference | undefined {
    const htables = this.htablesByFile.get(doc.uri);
    if (!htables) return undefined;

    const offset = positionToOffset(doc.fullText, position);
    return htables.find(
      (ht) => offset >= ht.nameRange.startIndex && offset < ht.nameRange.endIndex
    );
  }

  private getStringContentRange(node: SyntaxNode, position: Position): Range {
    let current: SyntaxNode | null = node;
    while (current) {
      if (current.type === 'string_content') {
        return {
          start: { line: current.startPosition.row, character: current.startPosition.column },
          end: { line: current.endPosition.row, character: current.endPosition.column },
        };
      }
      if (current.type === 'string') {
        const content = current.namedChildren.find((c) => c.type === 'string_content');
        if (content) {
          return {
            start: { line: content.startPosition.row, character: content.startPosition.column },
            end: { line: content.endPosition.row, character: content.endPosition.column },
          };
        }
        const openQuote = current.children.find((c) => c.type === 'string_start');
        if (openQuote) {
          const insertPos = { line: openQuote.endPosition.row, character: openQuote.endPosition.column };
          return { start: insertPos, end: insertPos };
        }
      }
      current = current.parent;
    }
    return { start: position, end: position };
  }

  private getHdrCompletions(node: SyntaxNode, position: Position): CompletionItem[] {
    const replaceRange = this.getStringContentRange(node, position);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    // Standard SIP headers
    for (const h of STANDARD_SIP_HEADERS) {
      seen.add(h.name);
      items.push({
        label: h.name,
        kind: CompletionItemKind.EnumMember,
        detail: h.rfc,
        documentation: h.description,
        sortText: `0${h.name}`,
        textEdit: TextEdit.replace(replaceRange, h.name),
      });
    }

    // Custom headers from workspace
    for (const refs of this.hdrsByFile.values()) {
      for (const ref of refs) {
        if (seen.has(ref.headerName)) continue;
        seen.add(ref.headerName);
        items.push({
          label: ref.headerName,
          kind: CompletionItemKind.Value,
          detail: 'Custom header',
          sortText: `0${ref.headerName}`,
          textEdit: TextEdit.replace(replaceRange, ref.headerName),
        });
      }
    }

    return items;
  }

  private isInsideHdrString(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    let stringNode: SyntaxNode | null = null;

    while (current) {
      if (current.type === 'string') {
        stringNode = current;
      } else if (current.type === 'string_content' || current.type === 'string_start' || current.type === 'string_end') {
        stringNode = current.parent;
      }
      if (current.type === 'call' && stringNode) {
        const argsNode = current.childForFieldName('arguments');
        if (argsNode) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.startIndex === stringNode.startIndex) {
            const funcNode = current.childForFieldName('function');
            if (funcNode && isKsrHdrMethod(funcNode)) {
              return true;
            }
          }
        }
      }
      current = current.parent;
    }
    return false;
  }

  private findHdrAtPosition(doc: DocumentContext, position: Position): HdrReference | undefined {
    const hdrs = this.hdrsByFile.get(doc.uri);
    if (!hdrs) return undefined;

    const offset = positionToOffset(doc.fullText, position);
    return hdrs.find(
      (h) => offset >= h.nameRange.startIndex && offset < h.nameRange.endIndex
    );
  }

  private getStatCompletions(node: SyntaxNode, position: Position): CompletionItem[] {
    const replaceRange = this.getStringContentRange(node, position);
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    // Declared stats from kamailio.cfg
    for (const [name] of this.getDeclaredStats()) {
      seen.add(name);
      items.push({
        label: name,
        kind: CompletionItemKind.EnumMember,
        detail: 'Declared in kamailio.cfg',
        sortText: `0${name}`,
        textEdit: TextEdit.replace(replaceRange, name),
      });
    }

    // Stats seen in workspace but not in cfg
    for (const refs of this.statsByFile.values()) {
      for (const ref of refs) {
        if (seen.has(ref.statName)) continue;
        seen.add(ref.statName);
        items.push({
          label: ref.statName,
          kind: CompletionItemKind.Value,
          sortText: `0${ref.statName}`,
          textEdit: TextEdit.replace(replaceRange, ref.statName),
        });
      }
    }

    return items;
  }

  private isInsideStatString(node: SyntaxNode): boolean {
    let current: SyntaxNode | null = node;
    let stringNode: SyntaxNode | null = null;

    while (current) {
      if (current.type === 'string') {
        stringNode = current;
      } else if (current.type === 'string_content' || current.type === 'string_start' || current.type === 'string_end') {
        stringNode = current.parent;
      }
      if (current.type === 'call' && stringNode) {
        const argsNode = current.childForFieldName('arguments');
        if (argsNode) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.startIndex === stringNode.startIndex) {
            const funcNode = current.childForFieldName('function');
            if (funcNode && isKsrStatMethod(funcNode)) {
              return true;
            }
          }
        }
      }
      current = current.parent;
    }
    return false;
  }

  private findStatAtPosition(doc: DocumentContext, position: Position): StatReference | undefined {
    const stats = this.statsByFile.get(doc.uri);
    if (!stats) return undefined;

    const offset = positionToOffset(doc.fullText, position);
    return stats.find(
      (s) => offset >= s.nameRange.startIndex && offset < s.nameRange.endIndex
    );
  }
}

// --- Module-level helpers ---

function toRange(r: TreeSitterRange): Range {
  return {
    start: { line: r.startPosition.row, character: r.startPosition.column },
    end: { line: r.endPosition.row, character: r.endPosition.column },
  };
}

type StringConstants = Map<string, string>;

function extractRawConstants(tree: Tree): {
  rawStrings: Map<string, string>;
  rawAliases: Map<string, string>;
} {
  const rawStrings: Map<string, string> = new Map();
  const rawAliases: Map<string, string> = new Map();
  walkForRawAssignments(tree.rootNode, rawStrings, rawAliases);
  return { rawStrings, rawAliases };
}

function walkForRawAssignments(
  node: SyntaxNode,
  rawStrings: Map<string, string>,
  rawAliases: Map<string, string>
): void {
  if (node.type === 'expression_statement') {
    const expr = node.namedChild(0);
    if (expr?.type === 'assignment') {
      const left = expr.childForFieldName('left');
      const right = expr.childForFieldName('right');
      if (left?.type === 'identifier' && right) {
        if (right.type === 'string') {
          const hasInterpolation = right.namedChildren.some((c) => c.type === 'interpolation');
          if (!hasInterpolation) {
            const content = right.namedChildren.find((c) => c.type === 'string_content');
            if (content) rawStrings.set(left.text, content.text);
          }
        } else if (right.type === 'integer' || right.type === 'float') {
          rawStrings.set(left.text, right.text);
        } else if (right.type === 'identifier') {
          rawAliases.set(left.text, right.text);
        }
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForRawAssignments(child, rawStrings, rawAliases);
  }
}

function resolveAliasChain(
  target: string,
  rawStrings: Map<string, string>,
  rawAliases: Map<string, string>,
  depth = 0
): string | undefined {
  if (depth > 10) return undefined; // prevent infinite loops
  const direct = rawStrings.get(target);
  if (direct !== undefined) return direct;
  const next = rawAliases.get(target);
  if (next !== undefined) return resolveAliasChain(next, rawStrings, rawAliases, depth + 1);
  return undefined;
}

/** Resolve the first argument of a call to a string value + range.
 *  Handles both string literals and identifier references to constants. */
function resolveFirstStringArg(
  argsNode: SyntaxNode,
  constants: StringConstants
): { value: string; range: TreeSitterRange } | null {
  const firstArg = argsNode.namedChild(0);
  if (!firstArg) return null;

  if (firstArg.type === 'string') {
    const hasInterpolation = firstArg.namedChildren.some((c) => c.type === 'interpolation');

    if (!hasInterpolation) {
      // Plain string — extract string_content directly
      const content = firstArg.namedChildren.find((c) => c.type === 'string_content');
      if (!content) return null;
      return {
        value: content.text,
        range: {
          startPosition: content.startPosition,
          endPosition: content.endPosition,
          startIndex: content.startIndex,
          endIndex: content.endIndex,
        },
      };
    }

    // F-string — try to resolve all interpolations from constants
    let resolved = '';
    for (const child of firstArg.namedChildren) {
      if (child.type === 'string_content') {
        resolved += child.text;
      } else if (child.type === 'interpolation') {
        const expr = child.namedChildren[0];
        const val = resolveExprToConstant(expr, constants);
        if (val === undefined) return null;
        resolved += val;
      }
    }

    // All interpolations resolved — use the first content/interpolation for range
    const rangeNode = firstArg.namedChildren.find(
      (c) => c.type === 'string_content' || c.type === 'interpolation'
    );
    if (!rangeNode) return null;
    const lastNode = [...firstArg.namedChildren].reverse().find(
      (c) => c.type === 'string_content' || c.type === 'interpolation'
    )!;
    return {
      value: resolved,
      range: {
        startPosition: rangeNode.startPosition,
        endPosition: lastNode.endPosition,
        startIndex: rangeNode.startIndex,
        endIndex: lastNode.endIndex,
      },
    };
  }

  // Identifier or attribute access (e.g., STAT_NAME or Definitions.STAT_NAME)
  const resolvedVal = resolveExprToConstant(firstArg, constants);
  if (resolvedVal !== undefined) {
    return {
      value: resolvedVal,
      range: {
        startPosition: firstArg.startPosition,
        endPosition: firstArg.endPosition,
        startIndex: firstArg.startIndex,
        endIndex: firstArg.endIndex,
      },
    };
  }

  return null;
}

/** Try to resolve an expression node to a constant string value.
 *  Handles: identifier (NAME), attribute (Module.NAME). */
function resolveExprToConstant(
  expr: SyntaxNode | undefined,
  constants: StringConstants
): string | undefined {
  if (!expr) return undefined;

  if (expr.type === 'identifier') {
    return constants.get(expr.text);
  }

  // Attribute access: Definitions.DISPATCHER_NO_DEST_CODE → look up DISPATCHER_NO_DEST_CODE
  if (expr.type === 'attribute') {
    const attr = expr.childForFieldName('attribute');
    if (attr) return constants.get(attr.text);
  }

  return undefined;
}

function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === position.line) {
      return offset + position.character;
    }
    if (text[i] === '\n') {
      line++;
    }
    offset++;
  }
  return offset + position.character;
}

function isKsrTmCallbackMethod(funcNode: SyntaxNode): boolean {
  if (funcNode.type !== 'attribute') return false;
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId || !CALLBACK_METHODS.has(methodId.text)) return false;

  const obj = funcNode.childForFieldName('object');
  if (!obj || obj.type !== 'attribute') return false;
  const tmId = obj.childForFieldName('attribute');
  const ksrId = obj.childForFieldName('object');
  return (
    !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
    !!tmId && tmId.type === 'identifier' && tmId.text === 'tm'
  );
}

function extractCallbackRegistrations(tree: Tree, constants: StringConstants): CallbackReference[] {
  const refs: CallbackReference[] = [];
  walkForCallbacks(tree.rootNode, refs, constants);
  return refs;
}

function walkForCallbacks(node: SyntaxNode, refs: CallbackReference[], constants: StringConstants): void {
  if (node.type === 'call') {
    const ref = tryExtractCallback(node, constants);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForCallbacks(child, refs, constants);
  }
}

function tryExtractCallback(callNode: SyntaxNode, constants: StringConstants): CallbackReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrTmCallbackMethod(funcNode)) return null;

  const methodId = funcNode.childForFieldName('attribute')!;
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  const resolved = resolveFirstStringArg(argsNode, constants);
  if (!resolved) return null;

  return {
    name: resolved.value,
    method: methodId.text,
    nameRange: resolved.range,
  };
}

function isKsrHtableMethod(funcNode: SyntaxNode): boolean {
  if (funcNode.type !== 'attribute') return false;
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId || !HTABLE_METHODS.has(methodId.text)) return false;

  const obj = funcNode.childForFieldName('object');
  if (!obj || obj.type !== 'attribute') return false;
  const htId = obj.childForFieldName('attribute');
  const ksrId = obj.childForFieldName('object');
  return (
    !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
    !!htId && htId.type === 'identifier' && htId.text === 'htable'
  );
}

function extractHtableReferences(tree: Tree, constants: StringConstants): HtableReference[] {
  const refs: HtableReference[] = [];
  walkForHtableCalls(tree.rootNode, refs, constants);
  return refs;
}

function walkForHtableCalls(node: SyntaxNode, refs: HtableReference[], constants: StringConstants): void {
  if (node.type === 'call') {
    const ref = tryExtractHtableCall(node, constants);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForHtableCalls(child, refs, constants);
  }
}

function tryExtractHtableCall(callNode: SyntaxNode, constants: StringConstants): HtableReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrHtableMethod(funcNode)) return null;

  const methodId = funcNode.childForFieldName('attribute')!;
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  const resolved = resolveFirstStringArg(argsNode, constants);
  if (!resolved) return null;

  return {
    tableName: resolved.value,
    method: methodId.text,
    nameRange: resolved.range,
  };
}

function isKsrHdrMethod(funcNode: SyntaxNode): boolean {
  if (funcNode.type !== 'attribute') return false;
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId || !HDR_METHODS.has(methodId.text)) return false;

  const obj = funcNode.childForFieldName('object');
  if (!obj || obj.type !== 'attribute') return false;
  const hdrId = obj.childForFieldName('attribute');
  const ksrId = obj.childForFieldName('object');
  return (
    !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
    !!hdrId && hdrId.type === 'identifier' && hdrId.text === 'hdr'
  );
}

function extractHdrReferences(tree: Tree, constants: StringConstants): HdrReference[] {
  const refs: HdrReference[] = [];
  walkForHdrCalls(tree.rootNode, refs, constants);
  return refs;
}

function walkForHdrCalls(node: SyntaxNode, refs: HdrReference[], constants: StringConstants): void {
  if (node.type === 'call') {
    const ref = tryExtractHdrCall(node, constants);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForHdrCalls(child, refs, constants);
  }
}

function tryExtractHdrCall(callNode: SyntaxNode, constants: StringConstants): HdrReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrHdrMethod(funcNode)) return null;

  const methodId = funcNode.childForFieldName('attribute')!;
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  const resolved = resolveFirstStringArg(argsNode, constants);
  if (!resolved) return null;

  return {
    headerName: resolved.value,
    method: methodId.text,
    nameRange: resolved.range,
  };
}

function isKsrStatMethod(funcNode: SyntaxNode): boolean {
  if (funcNode.type !== 'attribute') return false;
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId || !STAT_METHODS.has(methodId.text)) return false;

  const obj = funcNode.childForFieldName('object');
  if (!obj || obj.type !== 'attribute') return false;
  const statId = obj.childForFieldName('attribute');
  const ksrId = obj.childForFieldName('object');
  return (
    !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
    !!statId && statId.type === 'identifier' && statId.text === 'statistics'
  );
}

function extractStatReferences(tree: Tree, constants: StringConstants): StatReference[] {
  const refs: StatReference[] = [];
  walkForStatCalls(tree.rootNode, refs, constants);
  return refs;
}

function walkForStatCalls(node: SyntaxNode, refs: StatReference[], constants: StringConstants): void {
  if (node.type === 'call') {
    const ref = tryExtractStatCall(node, constants);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForStatCalls(child, refs, constants);
  }
}

function tryExtractStatCall(callNode: SyntaxNode, constants: StringConstants): StatReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrStatMethod(funcNode)) return null;

  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  const resolved = resolveFirstStringArg(argsNode, constants);
  if (!resolved) return null;

  return {
    statName: resolved.value,
    nameRange: resolved.range,
  };
}
