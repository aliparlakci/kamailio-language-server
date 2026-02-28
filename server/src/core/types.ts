import type { Tree, Point } from 'web-tree-sitter';
import type {
  CompletionItem,
  Diagnostic,
  Location,
  Position,
  Hover,
} from 'vscode-languageserver';

export interface TreeSitterRange {
  startPosition: Point;
  endPosition: Point;
  startIndex: number;
  endIndex: number;
}

export interface AnalysisContext {
  uri: string;
  tree: Tree;
  changedRanges: TreeSitterRange[];
  isFullParse: boolean;
  fullText: string;
}

export interface DocumentContext {
  uri: string;
  tree: Tree;
  fullText: string;
}

export interface SemanticTokenData {
  line: number;
  char: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

export interface Analyzer {
  readonly id: string;
  readonly name: string;

  analyze(context: AnalysisContext): void;
  getSemanticTokens(doc: DocumentContext): SemanticTokenData[];
  getCompletions(doc: DocumentContext, position: Position): CompletionItem[];
  getDiagnostics(doc: DocumentContext): Diagnostic[];
  getDefinitions(doc: DocumentContext, position: Position): Location[];
  getReferences(doc: DocumentContext, position: Position): Location[];
  getHover(doc: DocumentContext, position: Position): Hover | null;
  onDocumentRemoved(uri: string): void;
}
