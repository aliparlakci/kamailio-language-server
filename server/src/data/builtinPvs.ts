export interface BuiltinPvDef {
  pvClass: string;
  template: string;
  description: string;
  category: string;
  isBare: boolean;
  isReadOnly: boolean;
}

export const BUILTIN_PVS: BuiltinPvDef[] = [
  // SIP URI
  { pvClass: 'ru', template: '$ru', description: 'Request URI', category: 'sip_uri', isBare: true, isReadOnly: false },
  { pvClass: 'rU', template: '$rU', description: 'Username in Request URI', category: 'sip_uri', isBare: true, isReadOnly: false },
  { pvClass: 'rd', template: '$rd', description: 'Domain in Request URI', category: 'sip_uri', isBare: true, isReadOnly: false },
  { pvClass: 'rp', template: '$rp', description: 'Port in Request URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'rP', template: '$rP', description: 'Transport protocol of Request URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  // From header
  { pvClass: 'fu', template: '$fu', description: 'From URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fU', template: '$fU', description: 'From URI username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fd', template: '$fd', description: 'From URI domain', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fn', template: '$fn', description: 'From display name', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'ft', template: '$ft', description: 'From tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  // To header
  { pvClass: 'tu', template: '$tu', description: 'To URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tU', template: '$tU', description: 'To URI username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'td', template: '$td', description: 'To URI domain', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tn', template: '$tn', description: 'To display name', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tt', template: '$tt', description: 'To tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  // Call/Message
  { pvClass: 'ci', template: '$ci', description: 'Call-ID header value', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'cs', template: '$cs', description: 'CSeq number', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'rm', template: '$rm', description: 'SIP request method', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'rs', template: '$rs', description: 'SIP reply status code', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'rr', template: '$rr', description: 'SIP reply reason phrase', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'rb', template: '$rb', description: 'SIP message body', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'ml', template: '$ml', description: 'SIP message length', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'mb', template: '$mb', description: 'SIP message buffer', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'ct', template: '$ct', description: 'Contact header', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'cT', template: '$cT', description: 'Content-Type header', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'ua', template: '$ua', description: 'User-Agent header value', category: 'message', isBare: true, isReadOnly: true },
  // Network
  { pvClass: 'si', template: '$si', description: 'Source IP address', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'sp', template: '$sp', description: 'Source port', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Ri', template: '$Ri', description: 'Received IP address (local)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Rp', template: '$Rp', description: 'Received port (local)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'pr', template: '$pr', description: 'Protocol (UDP, TCP, TLS, etc.)', category: 'network', isBare: true, isReadOnly: true },
  // Destination
  { pvClass: 'du', template: '$du', description: 'Destination URI', category: 'sip_uri', isBare: true, isReadOnly: false },
  // Branch
  { pvClass: 'bf', template: '$bf', description: 'Branch flags', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'br', template: '$br', description: 'Branch', category: 'other', isBare: true, isReadOnly: false },
  // Time
  { pvClass: 'Ts', template: '$Ts', description: 'Current timestamp (unix epoch)', category: 'time', isBare: true, isReadOnly: true },
  { pvClass: 'Tf', template: '$Tf', description: 'Current time formatted', category: 'time', isBare: true, isReadOnly: true },
  // Return code
  { pvClass: 'rc', template: '$rc', description: 'Return code of last function', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'retcode', template: '$retcode', description: 'Return code of last function', category: 'other', isBare: true, isReadOnly: true },
  // Parenthesized (class) PVs — these are templates, not bare
  { pvClass: 'var', template: '$var(name)', description: 'Script private variable', category: 'script_var', isBare: false, isReadOnly: false },
  { pvClass: 'avp', template: '$avp(name)', description: 'Attribute-Value Pair', category: 'avp', isBare: false, isReadOnly: false },
  { pvClass: 'xavp', template: '$xavp(name)', description: 'Extended AVP (supports nesting with =>)', category: 'avp', isBare: false, isReadOnly: false },
  { pvClass: 'xavu', template: '$xavu(name)', description: 'Extended AVP (unique, single value)', category: 'avp', isBare: false, isReadOnly: false },
  { pvClass: 'xavi', template: '$xavi(name)', description: 'Extended AVP (case insensitive)', category: 'avp', isBare: false, isReadOnly: false },
  { pvClass: 'shv', template: '$shv(name)', description: 'Shared memory variable', category: 'shared_var', isBare: false, isReadOnly: false },
  { pvClass: 'hdr', template: '$hdr(name)', description: 'SIP header value', category: 'sip_header', isBare: false, isReadOnly: true },
  { pvClass: 'hdrc', template: '$hdrc(name)', description: 'SIP header count', category: 'sip_header', isBare: false, isReadOnly: true },
  { pvClass: 'sht', template: '$sht(table=>key)', description: 'Hash table entry (htable module)', category: 'htable', isBare: false, isReadOnly: false },
  { pvClass: 'dlg_var', template: '$dlg_var(name)', description: 'Dialog variable', category: 'dialog_var', isBare: false, isReadOnly: false },
  // Transaction
  { pvClass: 'T', template: '$T(name)', description: 'Transaction pseudo-variable (e.g., reply_code, reply_reason)', category: 'transaction', isBare: false, isReadOnly: true },
  { pvClass: 'TV', template: '$TV(name)', description: 'Timestamp value (s=seconds, u=microseconds, sn/un=with nanoseconds)', category: 'time', isBare: false, isReadOnly: true },
];

export const BUILTIN_PV_CLASSES = new Set(BUILTIN_PVS.map((pv) => pv.pvClass));

/** Known inner names for builtin parenthesized PV classes with fixed options. */
export const BUILTIN_PV_INNER_NAMES: Map<string, Array<{ name: string; description: string }>> = new Map([
  ['T', [
    { name: 'id_index', description: 'Internal transaction index ($null if no transaction)' },
    { name: 'id_label', description: 'Internal transaction label ($null if no transaction)' },
    { name: 'id_index_n', description: 'Internal transaction index (creates transaction if needed)' },
    { name: 'id_label_n', description: 'Internal transaction label (creates transaction if needed)' },
    { name: 'reply_code', description: 'Transaction reply status code' },
    { name: 'reply_reason', description: 'Transaction reply reason phrase' },
    { name: 'reply_last', description: 'Most recently received response code' },
    { name: 'reply_type', description: '1 for locally generated replies, 0 otherwise' },
    { name: 'branch_index', description: 'Current branch index' },
    { name: 'ruid', description: 'Internal location ruid field for current branch' },
  ]],
  ['TV', [
    { name: 's', description: 'Seconds since epoch (cached per SIP message)' },
    { name: 'u', description: 'Microseconds since epoch (cached per SIP message)' },
    { name: 'sn', description: 'Seconds at current moment (not cached)' },
    { name: 'un', description: 'Microseconds corresponding to $TV(sn) moment' },
    { name: 'Sn', description: 'String seconds.microseconds at current moment (not cached)' },
    { name: 'Sm', description: 'String monotonic counter (always increases)' },
  ]],
]);

export const BUILTIN_BARE_PVS = new Map(
  BUILTIN_PVS.filter((pv) => pv.isBare).map((pv) => [pv.pvClass, pv])
);
