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
import { MarkupKind } from 'vscode-languageserver';
import { SyntaxNode, Tree } from 'web-tree-sitter';

const CALLBACK_METHODS = new Set(['t_on_failure', 't_on_branch']);
const HTABLE_METHODS = new Set([
  'sht_get', 'sht_gete', 'sht_sets', 'sht_seti', 'sht_inc', 'sht_rm',
]);
const HTABLE_WRITE_METHODS = new Set(['sht_sets', 'sht_seti', 'sht_inc']);

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

export class CallGraphAnalyzer implements Analyzer {
  readonly id = 'callGraph';
  readonly name = 'Call Graph Analyzer';

  private callGraph = new CallGraph();
  private importResolver = new ImportResolver();
  private importsByFile: Map<string, ImportBinding[]> = new Map();
  private functionsByFile: Map<string, ExtractedFunction[]> = new Map();
  private callbacksByFile: Map<string, CallbackReference[]> = new Map();
  private htablesByFile: Map<string, HtableReference[]> = new Map();

  constructor(
    private getWorkspaceRoots: () => string[],
    private getKnownFiles: () => Set<string>
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

    // Extract callback registrations (KSR.tm.t_on_failure/t_on_branch)
    const callbacks = extractCallbackRegistrations(tree);
    this.callbacksByFile.set(uri, callbacks);

    // Extract htable references (KSR.htable.sht_*)
    const htables = extractHtableReferences(tree);
    this.htablesByFile.set(uri, htables);
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
    const ht = this.findHtableAtPosition(doc, position);
    if (!ht) return [];

    const refs: Location[] = [];
    for (const [uri, htRefs] of this.htablesByFile) {
      for (const ref of htRefs) {
        if (ref.tableName === ht.tableName) {
          refs.push({
            uri,
            range: {
              start: { line: ref.nameRange.startPosition.row, character: ref.nameRange.startPosition.column },
              end: { line: ref.nameRange.endPosition.row, character: ref.nameRange.endPosition.column },
            },
          });
        }
      }
    }
    return refs;
  }

  getHover(doc: DocumentContext, position: Position): Hover | null {
    const ht = this.findHtableAtPosition(doc, position);
    if (!ht) return null;

    // Collect all references to this table across all files
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
      range: {
        start: { line: ht.nameRange.startPosition.row, character: ht.nameRange.startPosition.column },
        end: { line: ht.nameRange.endPosition.row, character: ht.nameRange.endPosition.column },
      },
    };
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
    const cb = this.findCallbackAtPosition(doc, position);
    if (!cb) return [];

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

    return [];
  }

  onDocumentRemoved(uri: string): void {
    this.callGraph.removeFile(uri);
    this.importsByFile.delete(uri);
    this.functionsByFile.delete(uri);
    this.callbacksByFile.delete(uri);
    this.htablesByFile.delete(uri);
  }

  // --- Public API for PvAnalyzer ---

  getCallGraph(): CallGraph { return this.callGraph; }

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
}

// --- Module-level helpers ---

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

function extractCallbackRegistrations(tree: Tree): CallbackReference[] {
  const refs: CallbackReference[] = [];
  walkForCallbacks(tree.rootNode, refs);
  return refs;
}

function walkForCallbacks(node: SyntaxNode, refs: CallbackReference[]): void {
  if (node.type === 'call') {
    const ref = tryExtractCallback(node);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForCallbacks(child, refs);
  }
}

function tryExtractCallback(callNode: SyntaxNode): CallbackReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrTmCallbackMethod(funcNode)) return null;

  const methodId = funcNode.childForFieldName('attribute')!;

  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  let firstArg: SyntaxNode | null = null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    firstArg = argsNode.namedChild(i);
    break;
  }
  if (!firstArg || firstArg.type !== 'string') return null;

  const contentNode = firstArg.namedChildren.find((c) => c.type === 'string_content');
  if (!contentNode) return null;

  return {
    name: contentNode.text,
    method: methodId.text,
    nameRange: {
      startPosition: contentNode.startPosition,
      endPosition: contentNode.endPosition,
      startIndex: contentNode.startIndex,
      endIndex: contentNode.endIndex,
    },
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

function extractHtableReferences(tree: Tree): HtableReference[] {
  const refs: HtableReference[] = [];
  walkForHtableCalls(tree.rootNode, refs);
  return refs;
}

function walkForHtableCalls(node: SyntaxNode, refs: HtableReference[]): void {
  if (node.type === 'call') {
    const ref = tryExtractHtableCall(node);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForHtableCalls(child, refs);
  }
}

function tryExtractHtableCall(callNode: SyntaxNode): HtableReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || !isKsrHtableMethod(funcNode)) return null;

  const methodId = funcNode.childForFieldName('attribute')!;

  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  const firstArg = argsNode.namedChild(0);
  if (!firstArg || firstArg.type !== 'string') return null;

  const contentNode = firstArg.namedChildren.find((c) => c.type === 'string_content');
  if (!contentNode) return null;

  return {
    tableName: contentNode.text,
    method: methodId.text,
    nameRange: {
      startPosition: contentNode.startPosition,
      endPosition: contentNode.endPosition,
      startIndex: contentNode.startIndex,
      endIndex: contentNode.endIndex,
    },
  };
}
