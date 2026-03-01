export type PvCategory =
  | 'sip_header'
  | 'sip_uri'
  | 'script_var'
  | 'avp'
  | 'shared_var'
  | 'htable'
  | 'dialog_var'
  | 'transaction'
  | 'network'
  | 'message'
  | 'time'
  | 'other';

export interface ParsedPv {
  fullMatch: string;
  pvClass: string;
  innerName: string | null;
  index: string | null;
  offset: number;
  length: number;
  isBare: boolean;
  category: PvCategory;
}

const SIP_URI_PVS = new Set([
  'ru', 'rU', 'fu', 'fU', 'tu', 'tU', 'ou', 'oU', 'du', 'su',
  'rd', 'fd', 'td', 'od', 'dd', 'pd', 'ad', 'rp', 'rP',
  'dp', 'dP', 'op', 'oP', 'fn', 'tn', 'pn',
]);

const NETWORK_PVS = new Set([
  'si', 'sp', 'Ri', 'Rp', 'Rn', 'RAi', 'RAp', 'pr', 'proto',
]);

const MESSAGE_PVS = new Set([
  'rm', 'rs', 'cl', 'rb', 'ml', 'mb', 'bs', 'ct', 'cT', 'ua',
  'mi', 'mt', 'cs', 'csb', 'ci', 'ft', 'tt',
]);

function categorizePv(pvClass: string): PvCategory {
  if (pvClass === 'hdr' || pvClass === 'hdrc' || pvClass === 'hfl' || pvClass === 'hflc') return 'sip_header';
  if (SIP_URI_PVS.has(pvClass)) return 'sip_uri';
  if (pvClass === 'var' || pvClass === 'vz' || pvClass === 'vn') return 'script_var';
  if (pvClass === 'avp' || pvClass === 'xavp' || pvClass === 'xavu' || pvClass === 'xavi') return 'avp';
  if (pvClass === 'shv') return 'shared_var';
  if (pvClass === 'sht' || pvClass.startsWith('sht')) return 'htable';
  if (pvClass === 'dlg_var' || pvClass === 'dlg' || pvClass === 'dlg_ctx') return 'dialog_var';
  if (pvClass === 'T' || pvClass.startsWith('T_')) return 'transaction';
  if (NETWORK_PVS.has(pvClass)) return 'network';
  if (MESSAGE_PVS.has(pvClass)) return 'message';
  if (pvClass === 'Ts' || pvClass === 'Tf' || pvClass === 'TF' || pvClass === 'TV' || pvClass === 'time' || pvClass === 'utime') return 'time';
  return 'other';
}

/**
 * Parse all PV references from a string like "$var(foo)" or "$ru".
 *
 * Handles:
 * - Bare PVs: $ru, $fu, $si
 * - Parenthesized: $var(name), $avp(name), $hdr(Via)
 * - Keyed: $sht(table=>key), $xavp(root=>field)
 * - Indexed: $(hdr(Via)[0])
 */
export function parsePvString(input: string): ParsedPv[] {
  const results: ParsedPv[] = [];

  // Match $(class(inner)[index]), $class(inner), or $bare
  const pvRegex = /\$\((\w+)\(([^)]*)\)(?:\[([^\]]*)\])?\)|\$(\w+)\(([^)]*)\)|\$([a-zA-Z]\w*)/g;

  let match: RegExpExecArray | null;
  while ((match = pvRegex.exec(input)) !== null) {
    if (match[0] === '$$') continue;

    let pvClass: string;
    let innerName: string | null = null;
    let index: string | null = null;
    let isBare: boolean;

    if (match[1] !== undefined) {
      // $(class(inner)[index])
      pvClass = match[1];
      innerName = match[2] || null;
      index = match[3] || null;
      isBare = false;
    } else if (match[4] !== undefined) {
      // $class(inner)
      pvClass = match[4];
      innerName = match[5] || null;
      isBare = false;
    } else {
      // $bare
      pvClass = match[6];
      isBare = true;
    }

    results.push({
      fullMatch: match[0],
      pvClass,
      innerName,
      index,
      offset: match.index,
      length: match[0].length,
      isBare,
      category: categorizePv(pvClass),
    });
  }

  return results;
}

export function pvIdentityKey(pv: ParsedPv): string {
  if (pv.isBare) return pv.pvClass;
  return `${pv.pvClass}:${pv.innerName || ''}`;
}
