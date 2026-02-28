import Parser, { Tree } from 'web-tree-sitter';
import { DidChangeTextDocumentParams } from 'vscode-languageserver';
import { AnalyzerRegistry } from './analyzerRegistry';

interface DocumentState {
  uri: string;
  content: string;
  tree: Tree;
  version: number;
}

export class DocumentManager {
  private documents: Map<string, DocumentState> = new Map();

  constructor(
    private parser: Parser,
    private registry: AnalyzerRegistry
  ) {}

  openDocument(uri: string, content: string, version: number): void {
    const tree = this.parser.parse(content);
    const state: DocumentState = { uri, content, tree, version };
    this.documents.set(uri, state);

    this.registry.dispatchAnalysis({
      uri,
      tree,
      changedRanges: [],
      isFullParse: true,
      fullText: content,
    });
  }

  changeDocument(params: DidChangeTextDocumentParams): void {
    const uri = params.textDocument.uri;
    const state = this.documents.get(uri);
    if (!state) return;

    const oldTree = state.tree;

    for (const change of params.contentChanges) {
      if (!('range' in change) || !change.range) {
        // Full content replacement
        state.content = change.text;
        state.tree = this.parser.parse(state.content);
        state.version = params.textDocument.version;
        this.registry.dispatchAnalysis({
          uri,
          tree: state.tree,
          changedRanges: [],
          isFullParse: true,
          fullText: state.content,
        });
        oldTree.delete();
        return;
      }

      const startIndex = this.offsetAt(state.content, change.range.start.line, change.range.start.character);
      const oldEndIndex = this.offsetAt(state.content, change.range.end.line, change.range.end.character);
      const newEndIndex = startIndex + change.text.length;

      const startPosition = {
        row: change.range.start.line,
        column: change.range.start.character,
      };
      const oldEndPosition = {
        row: change.range.end.line,
        column: change.range.end.character,
      };

      // Apply edit to content string first to compute new end position
      const newContent =
        state.content.substring(0, startIndex) +
        change.text +
        state.content.substring(oldEndIndex);

      const newEndPosition = this.indexToPoint(newContent, newEndIndex);

      state.tree.edit({
        startIndex,
        oldEndIndex,
        newEndIndex,
        startPosition,
        oldEndPosition,
        newEndPosition,
      });

      state.content = newContent;
    }

    const newTree = this.parser.parse(state.content, state.tree);

    const changedRanges = newTree.getChangedRanges(oldTree).map((r) => ({
      startPosition: r.startPosition,
      endPosition: r.endPosition,
      startIndex: r.startIndex,
      endIndex: r.endIndex,
    }));

    oldTree.delete();

    state.tree = newTree;
    state.version = params.textDocument.version;

    this.registry.dispatchAnalysis({
      uri,
      tree: newTree,
      changedRanges,
      isFullParse: false,
      fullText: state.content,
    });
  }

  closeDocument(uri: string): void {
    const state = this.documents.get(uri);
    if (state) {
      state.tree.delete();
      this.documents.delete(uri);
      this.registry.dispatchDocumentRemoved(uri);
    }
  }

  getDocumentState(uri: string): { uri: string; content: string; tree: Tree; version: number } | undefined {
    return this.documents.get(uri);
  }

  private offsetAt(text: string, line: number, character: number): number {
    let offset = 0;
    let currentLine = 0;
    for (let i = 0; i < text.length; i++) {
      if (currentLine === line) {
        return offset + character;
      }
      if (text[i] === '\n') {
        currentLine++;
      }
      offset++;
    }
    return offset + character;
  }

  private indexToPoint(text: string, index: number): { row: number; column: number } {
    let row = 0;
    let lastLineStart = 0;
    for (let i = 0; i < index && i < text.length; i++) {
      if (text[i] === '\n') {
        row++;
        lastLineStart = i + 1;
      }
    }
    return { row, column: index - lastLineStart };
  }
}
