import {
  CompletionItem,
  Diagnostic,
  Hover,
  Location,
  Position,
} from 'vscode-languageserver';
import {
  Analyzer,
  AnalysisContext,
  DocumentContext,
  SemanticTokenData,
} from '../../core/types';
import { CallGraph } from './callGraph';
import { ImportResolver, ImportBinding } from './importResolver';
import { extractFunctions, ExtractedFunction } from './functionExtractor';

export class CallGraphAnalyzer implements Analyzer {
  readonly id = 'callGraph';
  readonly name = 'Call Graph Analyzer';

  private callGraph = new CallGraph();
  private importResolver = new ImportResolver();
  private importsByFile: Map<string, ImportBinding[]> = new Map();
  private functionsByFile: Map<string, ExtractedFunction[]> = new Map();

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

  // --- Analyzer interface (data provider only, no LSP features) ---

  getSemanticTokens(_doc: DocumentContext): SemanticTokenData[] { return []; }
  getCompletions(_doc: DocumentContext, _pos: Position): CompletionItem[] { return []; }
  getDiagnostics(_doc: DocumentContext): Diagnostic[] { return []; }
  getDefinitions(_doc: DocumentContext, _pos: Position): Location[] { return []; }
  getReferences(_doc: DocumentContext, _pos: Position): Location[] { return []; }
  getHover(_doc: DocumentContext, _pos: Position): Hover | null { return null; }

  onDocumentRemoved(uri: string): void {
    this.callGraph.removeFile(uri);
    this.importsByFile.delete(uri);
    this.functionsByFile.delete(uri);
  }

  // --- Public API for PvAnalyzer ---

  getCallGraph(): CallGraph { return this.callGraph; }
}
