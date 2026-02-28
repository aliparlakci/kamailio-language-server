import {
  CompletionItem,
  Diagnostic,
  Location,
  Position,
  Hover,
} from 'vscode-languageserver';
import {
  Analyzer,
  AnalysisContext,
  DocumentContext,
  SemanticTokenData,
} from './types';

export class AnalyzerRegistry {
  private analyzers: Map<string, Analyzer> = new Map();

  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.id)) {
      throw new Error(`Analyzer '${analyzer.id}' is already registered`);
    }
    this.analyzers.set(analyzer.id, analyzer);
  }

  dispatchAnalysis(context: AnalysisContext): void {
    for (const analyzer of this.analyzers.values()) {
      try {
        analyzer.analyze(context);
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during analyze():`, err);
      }
    }
  }

  dispatchDocumentRemoved(uri: string): void {
    for (const analyzer of this.analyzers.values()) {
      try {
        analyzer.onDocumentRemoved(uri);
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during onDocumentRemoved():`, err);
      }
    }
  }

  getCompletions(doc: DocumentContext, position: Position): CompletionItem[] {
    const items: CompletionItem[] = [];
    for (const analyzer of this.analyzers.values()) {
      try {
        items.push(...analyzer.getCompletions(doc, position));
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getCompletions():`, err);
      }
    }
    return items;
  }

  getDiagnostics(doc: DocumentContext): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const analyzer of this.analyzers.values()) {
      try {
        diags.push(...analyzer.getDiagnostics(doc));
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getDiagnostics():`, err);
      }
    }
    return diags;
  }

  getDefinitions(doc: DocumentContext, position: Position): Location[] {
    const locs: Location[] = [];
    for (const analyzer of this.analyzers.values()) {
      try {
        locs.push(...analyzer.getDefinitions(doc, position));
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getDefinitions():`, err);
      }
    }
    return locs;
  }

  getReferences(doc: DocumentContext, position: Position): Location[] {
    const locs: Location[] = [];
    for (const analyzer of this.analyzers.values()) {
      try {
        locs.push(...analyzer.getReferences(doc, position));
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getReferences():`, err);
      }
    }
    return locs;
  }

  getHover(doc: DocumentContext, position: Position): Hover | null {
    for (const analyzer of this.analyzers.values()) {
      try {
        const hover = analyzer.getHover(doc, position);
        if (hover) return hover;
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getHover():`, err);
      }
    }
    return null;
  }

  getSemanticTokens(doc: DocumentContext): SemanticTokenData[] {
    const tokens: SemanticTokenData[] = [];
    for (const analyzer of this.analyzers.values()) {
      try {
        tokens.push(...analyzer.getSemanticTokens(doc));
      } catch (err) {
        console.error(`Analyzer '${analyzer.id}' threw during getSemanticTokens():`, err);
      }
    }
    return tokens;
  }
}
