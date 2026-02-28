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
import { SyntaxNode, Tree } from 'web-tree-sitter';

const CALLBACK_METHODS = new Set(['t_on_failure', 't_on_branch']);

interface CallbackReference {
  name: string;
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
  getReferences(_doc: DocumentContext, _pos: Position): Location[] { return []; }
  getHover(_doc: DocumentContext, _pos: Position): Hover | null { return null; }

  getDiagnostics(doc: DocumentContext): Diagnostic[] {
    const callbacks = this.callbacksByFile.get(doc.uri);
    if (!callbacks || callbacks.length === 0) return [];

    const diags: Diagnostic[] = [];
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
    return diags;
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

    if (!this.isInsideCallbackString(node)) return [];

    const replaceRange = this.getCallbackStringRange(node, position);

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
          textEdit: TextEdit.replace(replaceRange, fn.def.name),
        });
      }
    }
    return items;
  }

  onDocumentRemoved(uri: string): void {
    this.callGraph.removeFile(uri);
    this.importsByFile.delete(uri);
    this.functionsByFile.delete(uri);
    this.callbacksByFile.delete(uri);
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

  private getCallbackStringRange(node: SyntaxNode, position: Position): Range {
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
        // Empty string — insert between quotes
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
