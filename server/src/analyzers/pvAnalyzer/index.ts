import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DiagnosticSeverity,
  Hover,
  InsertTextFormat,
  Location,
  MarkupKind,
  Position,
  Range,
  TextEdit,
  Command,
} from 'vscode-languageserver';
import {
  Analyzer,
  AnalysisContext,
  DocumentContext,
  SemanticTokenData,
} from '../../core/types';
import { extractPvReferences, KSR_PV_METHODS } from './pvExtractor';
import { parsePvString, pvIdentityKey } from './pvParser';
import { VariableIndex, PvOccurrence } from './variableIndex';
import { BUILTIN_PVS, BUILTIN_BARE_PVS, BUILTIN_PV_CLASSES } from '../../data/builtinPvs';
import { SyntaxNode } from 'web-tree-sitter';
import type { CallGraphAnalyzer } from '../callGraphAnalyzer/index';

// Semantic token type indices (must match legend order in server.ts)
const TOKEN_TYPE_PV_TYPE = 0;     // 'kamailioPvType' — $var(, $avp(, $shv(
const TOKEN_TYPE_PV_NAME = 1;     // 'kamailioPvName' — the name inside parens
const TOKEN_TYPE_PV_BUILTIN = 2;  // 'kamailioPvBuiltin' — $ru, $fu, $si

// Semantic token modifier flags
const MODIFIER_WRITE = 0b10; // 'modification' in legend

export class PvAnalyzer implements Analyzer {
  readonly id = 'pv';
  readonly name = 'KSR.pv Pseudo-Variable Analyzer';

  private indices: Map<string, VariableIndex> = new Map();
  private callGraphAnalyzer: CallGraphAnalyzer | null = null;

  setCallGraphAnalyzer(cga: CallGraphAnalyzer): void {
    this.callGraphAnalyzer = cga;
  }

  analyze(context: AnalysisContext): void {
    // Always rebuild index from the full tree. Tree-sitter parsing is
    // already incremental; walking the parsed tree for KSR.pv calls is
    // cheap even for multi-thousand-line files. This avoids range
    // mismatch bugs where removeInRange doesn't cover the same scope
    // as the re-extraction.
    const index = new VariableIndex();
    this.indices.set(context.uri, index);

    const refs = extractPvReferences(context.tree);

    for (const ref of refs) {
      const parsedPvs = parsePvString(ref.pvString);
      for (const pv of parsedPvs) {
        // Adjust PV offset to be relative to document, not the string
        const adjustedPv = {
          ...pv,
          offset: ref.stringNode.startIndex + pv.offset,
        };
        index.add({
          pv: adjustedPv,
          method: ref.method,
          isWrite: ref.isWrite,
          range: {
            startPosition: {
              row: ref.stringNode.startPosition.row,
              column: ref.stringNode.startPosition.column + pv.offset,
            },
            endPosition: {
              row: ref.stringNode.startPosition.row,
              column: ref.stringNode.startPosition.column + pv.offset + pv.length,
            },
            startIndex: ref.stringNode.startIndex + pv.offset,
            endIndex: ref.stringNode.startIndex + pv.offset + pv.length,
          },
        });
      }
    }
  }

  getSemanticTokens(doc: DocumentContext): SemanticTokenData[] {
    const index = this.indices.get(doc.uri);
    if (!index) return [];

    const tokens: SemanticTokenData[] = [];

    for (const occ of index.getAll()) {
      if (occ.pv.isBare) {
        // Bare PV like $ru — highlight as builtin
        tokens.push({
          line: occ.range.startPosition.row,
          char: occ.range.startPosition.column,
          length: occ.pv.length,
          tokenType: TOKEN_TYPE_PV_BUILTIN,
          tokenModifiers: occ.isWrite ? MODIFIER_WRITE : 0,
        });
      } else {
        // Class PV like $var(name) — highlight $class( as type, name as name
        const classLen = 1 + occ.pv.pvClass.length + 1; // $class(
        tokens.push({
          line: occ.range.startPosition.row,
          char: occ.range.startPosition.column,
          length: classLen,
          tokenType: TOKEN_TYPE_PV_TYPE,
          tokenModifiers: 0,
        });
        if (occ.pv.innerName) {
          tokens.push({
            line: occ.range.startPosition.row,
            char: occ.range.startPosition.column + classLen,
            length: occ.pv.innerName.length,
            tokenType: TOKEN_TYPE_PV_NAME,
            tokenModifiers: occ.isWrite ? MODIFIER_WRITE : 0,
          });
          // Closing ) in same color as $var(
          tokens.push({
            line: occ.range.startPosition.row,
            char: occ.range.startPosition.column + classLen + occ.pv.innerName.length,
            length: 1,
            tokenType: TOKEN_TYPE_PV_TYPE,
            tokenModifiers: 0,
          });
        }
      }
    }

    return tokens;
  }

  getCompletions(doc: DocumentContext, position: Position): CompletionItem[] {
    const node = doc.tree.rootNode.descendantForPosition({
      row: position.line,
      column: position.character,
    });
    if (!node) return [];

    // Check if we're inside a string within a KSR.pv call
    if (this.isInsideKsrPvString(node)) {
      return this.getPvCompletions(doc, position, node);
    }

    // Check if we're completing a KSR.pv method name
    if (this.isCompletingKsrPvMethod(node)) {
      return Object.entries(KSR_PV_METHODS).map(([method, info]) => ({
        label: method,
        kind: CompletionItemKind.Method,
        detail: info.description,
      }));
    }

    return [];
  }

  getDiagnostics(doc: DocumentContext): Diagnostic[] {
    const index = this.indices.get(doc.uri);
    if (!index) return [];

    const diags: Diagnostic[] = [];
    const userVarPrefixes = ['var:', 'avp:', 'shv:', 'xavp:', 'xavu:', 'xavi:'];

    for (const occ of index.getAll()) {
      // Check for unknown PV classes
      if (!BUILTIN_PV_CLASSES.has(occ.pv.pvClass)) {
        diags.push({
          severity: DiagnosticSeverity.Error,
          range: {
            start: { line: occ.range.startPosition.row, character: occ.range.startPosition.column },
            end: { line: occ.range.endPosition.row, character: occ.range.endPosition.column },
          },
          message: `Unknown pseudo-variable: ${occ.pv.fullMatch}`,
          source: 'kamailio-pv',
        });
      }
    }

    // Check for variables that are read but never set (within this document)
    for (const key of index.getAllIdentities()) {
      if (userVarPrefixes.some((p) => key.startsWith(p))) {
        const occs = index.getByIdentity(key);
        const hasRead = occs.some((o) => !o.isWrite);
        const hasWrite = occs.some((o) => o.isWrite);

        if (hasRead && !hasWrite) {
          // Check across all documents
          let foundWriteElsewhere = false;
          for (const [uri, otherIndex] of this.indices) {
            if (uri === doc.uri) continue;
            if (otherIndex.getAllWrites(key).length > 0) {
              foundWriteElsewhere = true;
              break;
            }
          }

          // Also check transitive writes via the call graph
          if (!foundWriteElsewhere && this.callGraphAnalyzer) {
            const cg = this.callGraphAnalyzer.getCallGraph();
            foundWriteElsewhere = cg.hasTransitiveWrite(key);
          }

          if (!foundWriteElsewhere) {
            const firstRead = occs.find((o) => !o.isWrite);
            if (firstRead) {
              diags.push({
                severity: DiagnosticSeverity.Warning,
                range: {
                  start: { line: firstRead.range.startPosition.row, character: firstRead.range.startPosition.column },
                  end: { line: firstRead.range.endPosition.row, character: firstRead.range.endPosition.column },
                },
                message: `Pseudo-variable '${firstRead.pv.fullMatch}' is read but never set in the workspace`,
                source: 'kamailio-pv',
                code: 'undefined-pv',
              });
            }
          }
        }
      }
    }

    return diags;
  }

  getDefinitions(doc: DocumentContext, position: Position): Location[] {
    const occ = this.findOccurrenceAtPosition(doc, position);
    if (!occ) return [];

    const key = pvIdentityKey(occ.pv);
    const definitions: Location[] = [];

    // Search all documents for writes of this variable
    for (const [uri, index] of this.indices) {
      for (const write of index.getAllWrites(key)) {
        definitions.push({
          uri,
          range: {
            start: { line: write.range.startPosition.row, character: write.range.startPosition.column },
            end: { line: write.range.endPosition.row, character: write.range.endPosition.column },
          },
        });
      }
    }

    return definitions;
  }

  getReferences(doc: DocumentContext, position: Position): Location[] {
    const occ = this.findOccurrenceAtPosition(doc, position);
    if (!occ) return [];

    const key = pvIdentityKey(occ.pv);
    const refs: Location[] = [];

    // Search all documents
    for (const [uri, index] of this.indices) {
      for (const occurrence of index.getByIdentity(key)) {
        refs.push({
          uri,
          range: {
            start: { line: occurrence.range.startPosition.row, character: occurrence.range.startPosition.column },
            end: { line: occurrence.range.endPosition.row, character: occurrence.range.endPosition.column },
          },
        });
      }
    }

    return refs;
  }

  getHover(doc: DocumentContext, position: Position): Hover | null {
    const occ = this.findOccurrenceAtPosition(doc, position);
    if (!occ) return null;

    const builtin = BUILTIN_PVS.find((b) => b.pvClass === occ.pv.pvClass);
    const key = pvIdentityKey(occ.pv);

    // Count reads/writes across all documents
    let reads = 0;
    let writes = 0;
    for (const index of this.indices.values()) {
      for (const o of index.getByIdentity(key)) {
        if (o.isWrite) writes++;
        else reads++;
      }
    }

    const lines = [
      `**${occ.pv.fullMatch}**`,
      '',
      builtin ? builtin.description : 'User-defined variable',
      '',
      `Category: \`${occ.pv.category}\``,
      `References: ${reads} reads, ${writes} writes`,
    ];

    if (builtin?.isReadOnly) {
      lines.push('', '*Read-only*');
    }

    return {
      contents: {
        kind: MarkupKind.Markdown,
        value: lines.join('\n'),
      },
      range: {
        start: { line: occ.range.startPosition.row, character: occ.range.startPosition.column },
        end: { line: occ.range.endPosition.row, character: occ.range.endPosition.column },
      },
    };
  }

  onDocumentRemoved(uri: string): void {
    this.indices.delete(uri);
  }

  // --- Private helpers ---

  private findOccurrenceAtPosition(doc: DocumentContext, position: Position): PvOccurrence | undefined {
    const index = this.indices.get(doc.uri);
    if (!index) return undefined;

    const offset = this.positionToOffset(doc.fullText, position);
    return index.findAtOffset(offset);
  }

  private isInsideKsrPvString(node: SyntaxNode): boolean {
    // Walk up to find if we're inside a string that's an argument to KSR.pv.*
    // The cursor may land on string_content, string_start, string_end, or string
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
        if (funcNode && this.isKsrPvAttribute(funcNode)) {
          return true;
        }
      }
      current = current.parent;
    }
    return false;
  }

  private isCompletingKsrPvMethod(node: SyntaxNode): boolean {
    if (node.type !== 'identifier' || !node.parent) return false;
    const parent = node.parent;
    if (parent.type !== 'attribute') return false;

    const obj = parent.childForFieldName('object');
    if (!obj || obj.type !== 'attribute') return false;

    const ksrId = obj.childForFieldName('object');
    const pvId = obj.childForFieldName('attribute');
    return (
      !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
      !!pvId && pvId.type === 'identifier' && pvId.text === 'pv'
    );
  }

  private isKsrPvAttribute(funcNode: SyntaxNode): boolean {
    if (funcNode.type !== 'attribute') return false;
    const obj = funcNode.childForFieldName('object');
    if (!obj || obj.type !== 'attribute') return false;

    const pvId = obj.childForFieldName('attribute');
    const ksrId = obj.childForFieldName('object');
    return (
      !!ksrId && ksrId.type === 'identifier' && ksrId.text === 'KSR' &&
      !!pvId && pvId.type === 'identifier' && pvId.text === 'pv'
    );
  }

  private getPvCompletions(doc: DocumentContext, position: Position, node: SyntaxNode): CompletionItem[] {
    // Find the string_content node. The cursor might land on string_content,
    // string, string_start, string_end, or even ERROR nodes.
    let contentNode: SyntaxNode | null = null;
    let stringNode: SyntaxNode | null = null;

    // Walk up to find the string node
    let current: SyntaxNode | null = node;
    while (current) {
      if (current.type === 'string_content') {
        contentNode = current;
        stringNode = current.parent;
        break;
      }
      if (current.type === 'string') {
        stringNode = current;
        contentNode = current.namedChildren.find((c) => c.type === 'string_content') || null;
        break;
      }
      current = current.parent;
    }

    if (!contentNode) {
      // Empty string or cursor is on the quote — find the string node
      // and compute insert position right after the opening quote
      if (stringNode) {
        const openQuote = stringNode.children.find((c) => c.type === 'string_start');
        if (openQuote) {
          const insertPos: Position = {
            line: openQuote.endPosition.row,
            character: openQuote.endPosition.column,
          };
          const emptyRange: Range = { start: insertPos, end: insertPos };
          return this.getAllPvCompletionItems(emptyRange);
        }
      }
      const emptyRange: Range = { start: position, end: position };
      return this.getAllPvCompletionItems(emptyRange);
    }

    const stringStart = contentNode.startPosition;
    const fullText = contentNode.text;
    const cursorCol = position.character - stringStart.column;
    const typed = fullText.substring(0, Math.max(0, cursorCol));

    // Find the last '$' before cursor
    const dollarIdx = typed.lastIndexOf('$');
    if (dollarIdx === -1) {
      // No '$' typed yet — offer all PV completions inserting at cursor
      const insertRange: Range = { start: position, end: position };
      return this.getAllPvCompletionItems(insertRange);
    }

    const afterDollar = typed.substring(dollarIdx + 1);
    const openParenIdx = afterDollar.indexOf('(');

    // Range from the '$' to the cursor — this is what we'll replace
    const replaceStart: Position = {
      line: position.line,
      character: stringStart.column + dollarIdx,
    };
    const replaceRange: Range = {
      start: replaceStart,
      end: position,
    };

    if (openParenIdx !== -1) {
      // User typed "$var(call" — completing the variable NAME
      const pvClass = afterDollar.substring(0, openParenIdx);

      // Range from after the '(' to cursor
      const nameReplaceStart: Position = {
        line: position.line,
        character: stringStart.column + dollarIdx + 1 + openParenIdx + 1,
      };
      const nameReplaceRange: Range = {
        start: nameReplaceStart,
        end: position,
      };

      return this.getVariableNameCompletions(pvClass, nameReplaceRange);
    }

    // User typed "$" or "$va" etc — completing the PV class/builtin
    return this.getAllPvCompletionItems(replaceRange);
  }

  private getAllPvCompletionItems(replaceRange: Range): CompletionItem[] {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    // Built-in bare PVs (e.g., $ru, $fu)
    for (const builtin of BUILTIN_PVS) {
      if (builtin.isBare) {
        items.push({
          label: builtin.template,
          kind: CompletionItemKind.Variable,
          detail: builtin.description,
          documentation: {
            kind: MarkupKind.Markdown,
            value: `**${builtin.template}**\n\n${builtin.description}\n\nCategory: \`${builtin.category}\`${builtin.isReadOnly ? '\n\n*Read-only*' : ''}`,
          },
          filterText: builtin.template,
          sortText: `0${builtin.template}`,
          textEdit: TextEdit.replace(replaceRange, builtin.template),
        });
        seen.add(builtin.template);
      }
    }

    // Class PV prefixes (e.g., $var(, $shv() — insert $var() with cursor between parens
    for (const builtin of BUILTIN_PVS) {
      if (!builtin.isBare) {
        const prefix = `$${builtin.pvClass}(`;
        if (!seen.has(prefix)) {
          // Snippet: \\$ is literal $ in snippet syntax, $1 positions cursor between parens
          // Use string concatenation to avoid JS template literal consuming $ before ${
          const snippetText = '\\$' + builtin.pvClass + '($1)';
          items.push({
            label: prefix,
            kind: CompletionItemKind.Class,
            detail: builtin.description,
            filterText: prefix,
            sortText: `0${prefix}`,
            insertTextFormat: InsertTextFormat.Snippet,
            textEdit: TextEdit.replace(replaceRange, snippetText),
            command: {
              title: 'Trigger variable name completion',
              command: 'editor.action.triggerSuggest',
            },
          });
          seen.add(prefix);
        }
      }
    }

    // User-defined complete variables (e.g., $var(caller)) — only those that have been set
    for (const index of this.indices.values()) {
      for (const key of index.getAllIdentities()) {
        const parts = key.split(':');
        if (parts.length === 2) {
          // Only suggest variables that have been written somewhere in the workspace
          if (!this.hasWriteForKey(key)) continue;
          const [pvClass, name] = parts;
          const template = `$${pvClass}(${name})`;
          if (!seen.has(template)) {
            items.push({
              label: template,
              kind: CompletionItemKind.Variable,
              detail: `User-defined ${pvClass} variable`,
              filterText: template,
              sortText: `0${template}`,
              textEdit: TextEdit.replace(replaceRange, template),
            });
            seen.add(template);
          }
        }
      }
    }

    return items;
  }

  private getVariableNameCompletions(pvClass: string, replaceRange: Range): CompletionItem[] {
    const items: CompletionItem[] = [];
    const seen = new Set<string>();

    for (const index of this.indices.values()) {
      for (const key of index.getAllIdentities()) {
        const parts = key.split(':');
        if (parts.length === 2 && parts[0] === pvClass) {
          // Only suggest variables that have been set somewhere
          if (!this.hasWriteForKey(key)) continue;
          const name = parts[1];
          if (!seen.has(name)) {
            items.push({
              label: name,
              kind: CompletionItemKind.Variable,
              detail: `${pvClass} variable`,
              filterText: name,
              sortText: `0${name}`,
              textEdit: TextEdit.replace(replaceRange, name),
            });
            seen.add(name);
          }
        }
      }
    }

    return items;
  }

  private hasWriteForKey(key: string): boolean {
    for (const index of this.indices.values()) {
      if (index.getAllWrites(key).length > 0) return true;
    }
    return false;
  }

  private positionToOffset(text: string, position: Position): number {
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
}
