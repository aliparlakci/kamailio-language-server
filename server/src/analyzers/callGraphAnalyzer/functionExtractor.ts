import { SyntaxNode, Tree } from 'web-tree-sitter';
import { TreeSitterRange } from '../../core/types';
import { KSR_PV_METHODS } from '../pvAnalyzer/pvExtractor';
import { parsePvString, pvIdentityKey } from '../pvAnalyzer/pvParser';

export interface FunctionDef {
  name: string;
  uri: string;
  range: TreeSitterRange;
  nameRange: TreeSitterRange;
  parameters: string[];
}

export interface CallSite {
  callee: string;
  uri: string;
  enclosingFunction: string | null;
  range: TreeSitterRange;
}

export interface ExtractedFunction {
  def: FunctionDef;
  callSites: CallSite[];
  pvReads: Set<string>;
  pvWrites: Set<string>;
}

function nodeRange(node: SyntaxNode): TreeSitterRange {
  return {
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

export function extractFunctions(tree: Tree, uri: string): ExtractedFunction[] {
  const results: ExtractedFunction[] = [];
  const root = tree.rootNode;

  // Extract top-level function definitions and class methods
  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i)!;
    if (node.type === 'function_definition') {
      results.push(extractOneFunction(node, uri));
    } else if (node.type === 'decorated_definition') {
      const funcNode = node.namedChildren.find((c) => c.type === 'function_definition');
      if (funcNode) {
        results.push(extractOneFunction(funcNode, uri));
      }
    } else if (node.type === 'class_definition') {
      extractClassMethods(node, uri, results);
    }
  }

  // Also extract module-level calls and PV accesses as a synthetic "<module>" function
  const moduleFn: ExtractedFunction = {
    def: {
      name: '<module>',
      uri,
      range: nodeRange(root),
      nameRange: nodeRange(root),
      parameters: [],
    },
    callSites: [],
    pvReads: new Set(),
    pvWrites: new Set(),
  };
  collectCallsAndPvAccess(root, uri, null, moduleFn.callSites, moduleFn.pvReads, moduleFn.pvWrites, true);
  if (moduleFn.callSites.length > 0 || moduleFn.pvReads.size > 0 || moduleFn.pvWrites.size > 0) {
    results.push(moduleFn);
  }

  return results;
}

function extractClassMethods(classNode: SyntaxNode, uri: string, results: ExtractedFunction[]): void {
  const bodyNode = classNode.childForFieldName('body');
  if (!bodyNode) return;

  for (let i = 0; i < bodyNode.namedChildCount; i++) {
    const node = bodyNode.namedChild(i)!;
    if (node.type === 'function_definition') {
      results.push(extractOneFunction(node, uri));
    } else if (node.type === 'decorated_definition') {
      const funcNode = node.namedChildren.find((c) => c.type === 'function_definition');
      if (funcNode) {
        results.push(extractOneFunction(funcNode, uri));
      }
    }
  }
}

function extractOneFunction(funcNode: SyntaxNode, uri: string): ExtractedFunction {
  const nameNode = funcNode.childForFieldName('name')!;
  const paramsNode = funcNode.childForFieldName('parameters');
  const bodyNode = funcNode.childForFieldName('body');

  const parameters: string[] = [];
  if (paramsNode) {
    for (let i = 0; i < paramsNode.namedChildCount; i++) {
      const param = paramsNode.namedChild(i)!;
      if (param.type === 'identifier') {
        parameters.push(param.text);
      } else if (param.type === 'typed_parameter' || param.type === 'default_parameter') {
        const name = param.childForFieldName('name');
        if (name) parameters.push(name.text);
      }
    }
  }

  const callSites: CallSite[] = [];
  const pvReads = new Set<string>();
  const pvWrites = new Set<string>();

  if (bodyNode) {
    collectCallsAndPvAccess(bodyNode, uri, nameNode.text, callSites, pvReads, pvWrites, false);
  }

  return {
    def: {
      name: nameNode.text,
      uri,
      range: nodeRange(funcNode),
      nameRange: nodeRange(nameNode),
      parameters,
    },
    callSites,
    pvReads,
    pvWrites,
  };
}

function collectCallsAndPvAccess(
  node: SyntaxNode,
  uri: string,
  enclosingFunction: string | null,
  callSites: CallSite[],
  pvReads: Set<string>,
  pvWrites: Set<string>,
  moduleLevel: boolean
): void {
  if (node.type === 'function_definition') {
    // Don't recurse into nested function defs (they're handled separately)
    if (!moduleLevel) return;
    // At module level, skip function bodies
    return;
  }

  if (node.type === 'call') {
    const funcNode = node.childForFieldName('function');
    if (funcNode) {
      // Check if this is a KSR.pv.* call
      const ksrPvMethod = getKsrPvMethod(funcNode);
      if (ksrPvMethod) {
        // Extract PV access
        extractPvAccess(node, ksrPvMethod, pvReads, pvWrites);
      } else {
        // Regular function call — record as call site
        const callee = getCalleeName(funcNode);
        if (callee && !callee.startsWith('KSR.')) {
          callSites.push({
            callee,
            uri,
            enclosingFunction,
            range: nodeRange(node),
          });
        }
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) {
      collectCallsAndPvAccess(child, uri, enclosingFunction, callSites, pvReads, pvWrites, moduleLevel);
    }
  }
}

function getCalleeName(funcNode: SyntaxNode): string | null {
  if (funcNode.type === 'identifier') {
    return funcNode.text;
  }
  if (funcNode.type === 'attribute') {
    const obj = funcNode.childForFieldName('object');
    const attr = funcNode.childForFieldName('attribute');
    if (obj && attr) {
      const objName = getCalleeName(obj);
      if (objName) return objName + '.' + attr.text;
    }
  }
  return null;
}

function getKsrPvMethod(funcNode: SyntaxNode): string | null {
  if (funcNode.type !== 'attribute') return null;
  const methodId = funcNode.childForFieldName('attribute');
  if (!methodId) return null;
  const method = methodId.text;
  if (!(method in KSR_PV_METHODS)) return null;

  const obj = funcNode.childForFieldName('object');
  if (!obj || obj.type !== 'attribute') return null;
  const pvId = obj.childForFieldName('attribute');
  const ksrId = obj.childForFieldName('object');
  if (!ksrId || ksrId.type !== 'identifier' || ksrId.text !== 'KSR') return null;
  if (!pvId || pvId.type !== 'identifier' || pvId.text !== 'pv') return null;

  return method;
}

function extractPvAccess(
  callNode: SyntaxNode,
  method: string,
  pvReads: Set<string>,
  pvWrites: Set<string>
): void {
  const argsNode = callNode.childForFieldName('arguments');
  if (!argsNode) return;

  let firstArg: SyntaxNode | null = null;
  for (let i = 0; i < argsNode.namedChildCount; i++) {
    firstArg = argsNode.namedChild(i);
    break;
  }
  if (!firstArg || firstArg.type !== 'string') return;

  const contentNode = firstArg.namedChildren.find((c) => c.type === 'string_content');
  if (!contentNode) return;

  const pvs = parsePvString(contentNode.text);
  const isWrite = KSR_PV_METHODS[method]?.isWrite ?? false;

  for (const pv of pvs) {
    const key = pvIdentityKey(pv);
    if (isWrite) {
      pvWrites.add(key);
    } else {
      pvReads.add(key);
    }
  }
}
