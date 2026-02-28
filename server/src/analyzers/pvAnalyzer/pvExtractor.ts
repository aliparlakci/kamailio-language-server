import { SyntaxNode, Tree } from 'web-tree-sitter';
import { TreeSitterRange } from '../../core/types';

export const KSR_PV_METHODS: Record<string, { isWrite: boolean; description: string }> = {
  'get':      { isWrite: false, description: 'Get PV value (returns int/string or $null)' },
  'gete':     { isWrite: false, description: 'Get PV value (empty string instead of $null)' },
  'getw':     { isWrite: false, description: 'Get PV value ("<<null>>" instead of $null)' },
  'getvs':    { isWrite: false, description: 'Get PV value (custom string instead of $null)' },
  'getvn':    { isWrite: false, description: 'Get PV value (custom int instead of $null)' },
  'sets':     { isWrite: true,  description: 'Set PV to string value' },
  'seti':     { isWrite: true,  description: 'Set PV to integer value' },
  'setx':     { isWrite: true,  description: 'Set PV to null' },
  'is_null':  { isWrite: false, description: 'Check if PV is null' },
  'unset':    { isWrite: true,  description: 'Unset PV value' },
};

export interface PvReference {
  pvString: string;
  method: string;
  isWrite: boolean;
  stringNode: {
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    startIndex: number;
    endIndex: number;
  };
  callNode: {
    startPosition: { row: number; column: number };
    endPosition: { row: number; column: number };
    startIndex: number;
    endIndex: number;
  };
}

export function extractPvReferences(
  tree: Tree,
  changedRanges?: TreeSitterRange[]
): PvReference[] {
  const refs: PvReference[] = [];
  const root = tree.rootNode;

  if (changedRanges && changedRanges.length > 0) {
    for (const range of changedRanges) {
      const node = root.descendantForPosition(
        range.startPosition,
        range.endPosition
      );
      if (node) {
        const stmtNode = findStatementAncestor(node);
        walkForPvCalls(stmtNode, refs);
      }
    }
  } else {
    walkForPvCalls(root, refs);
  }

  return refs;
}

function walkForPvCalls(node: SyntaxNode, refs: PvReference[]): void {
  if (node.type === 'call') {
    const ref = tryExtractPvCall(node);
    if (ref) {
      refs.push(ref);
      return;
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkForPvCalls(child, refs);
  }
}

function tryExtractPvCall(callNode: SyntaxNode): PvReference | null {
  const funcNode = callNode.childForFieldName('function');
  if (!funcNode || funcNode.type !== 'attribute') return null;

  // funcNode should be KSR.pv.<method>
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId) return null;
  const method = methodId.text;
  if (!(method in KSR_PV_METHODS)) return null;

  // funcNode.object should be KSR.pv
  const ksrPvNode = funcNode.childForFieldName('object');
  if (!ksrPvNode || ksrPvNode.type !== 'attribute') return null;

  const pvId = ksrPvNode.childForFieldName('attribute');
  const ksrId = ksrPvNode.childForFieldName('object');
  if (!pvId || !ksrId) return null;
  if (ksrId.type !== 'identifier' || ksrId.text !== 'KSR') return null;
  if (pvId.type !== 'identifier' || pvId.text !== 'pv') return null;

  // Get the first string argument
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return null;

  let firstArg: SyntaxNode | null = null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    firstArg = argsNode.namedChild(i);
    break;
  }
  if (!firstArg || firstArg.type !== 'string') return null;

  // Find string_content inside the string node
  const contentNode = firstArg.namedChildren.find(
    (c) => c.type === 'string_content'
  );
  if (!contentNode) return null;

  return {
    pvString: contentNode.text,
    method,
    isWrite: KSR_PV_METHODS[method].isWrite,
    stringNode: {
      startPosition: contentNode.startPosition,
      endPosition: contentNode.endPosition,
      startIndex: contentNode.startIndex,
      endIndex: contentNode.endIndex,
    },
    callNode: {
      startPosition: callNode.startPosition,
      endPosition: callNode.endPosition,
      startIndex: callNode.startIndex,
      endIndex: callNode.endIndex,
    },
  };
}

function findStatementAncestor(node: SyntaxNode): SyntaxNode {
  let current = node;
  while (current.parent) {
    if (
      current.type === 'expression_statement' ||
      current.type === 'if_statement' ||
      current.type === 'assignment' ||
      current.type === 'return_statement' ||
      current.type === 'function_definition' ||
      current.type === 'module'
    ) {
      return current;
    }
    current = current.parent;
  }
  return current;
}
