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
  { pvClass: 'rUl', template: '$rUl', description: 'Username length in Request URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'rz', template: '$rz', description: 'URI scheme of Request URI (sip, sips, tel, etc.)', category: 'sip_uri', isBare: true, isReadOnly: true },
  // From header
  { pvClass: 'fu', template: '$fu', description: 'From URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fU', template: '$fU', description: 'From URI username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fd', template: '$fd', description: 'From URI domain', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fn', template: '$fn', description: 'From display name', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'ft', template: '$ft', description: 'From tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fUl', template: '$fUl', description: 'From URI username length', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'fti', template: '$fti', description: 'Initial From tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  // To header
  { pvClass: 'tu', template: '$tu', description: 'To URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tU', template: '$tU', description: 'To URI username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'td', template: '$td', description: 'To URI domain', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tn', template: '$tn', description: 'To display name', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tt', template: '$tt', description: 'To tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tUl', template: '$tUl', description: 'To URI username length', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tti', template: '$tti', description: 'Initial To tag', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'tts', template: '$tts', description: 'Secondary To tag', category: 'sip_uri', isBare: true, isReadOnly: true },
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
  { pvClass: 'rmid', template: '$rmid', description: 'SIP request method as integer ID', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'csb', template: '$csb', description: 'CSeq header body (number and method)', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'rv', template: '$rv', description: 'SIP message version', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'mt', template: '$mt', description: 'SIP message type (1=request, 2=reply)', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'mi', template: '$mi', description: 'SIP message unique ID (Kamailio internal)', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'cl', template: '$cl', description: 'Content-Length header value', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'bs', template: '$bs', description: 'Body size', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'ctu', template: '$ctu', description: 'Contact URI', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'cts', template: '$cts', description: 'Contact star flag (1 if Contact is *)', category: 'message', isBare: true, isReadOnly: true },
  { pvClass: 'mbu', template: '$mbu', description: 'SIP message buffer (updated with changes)', category: 'message', isBare: true, isReadOnly: true },
  // Network
  { pvClass: 'si', template: '$si', description: 'Source IP address', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'sp', template: '$sp', description: 'Source port', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Ri', template: '$Ri', description: 'Received IP address (local)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Rp', template: '$Rp', description: 'Received port (local)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Rn', template: '$Rn', description: 'Received socket name (local)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Ru', template: '$Ru', description: 'Received (local) full URI', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'Rut', template: '$Rut', description: 'Received (local) full URI with transport', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'RAi', template: '$RAi', description: 'Advertised IP address', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'RAp', template: '$RAp', description: 'Advertised port', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'RAu', template: '$RAu', description: 'Advertised URI', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'RAut', template: '$RAut', description: 'Advertised URI with transport', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'pr', template: '$pr', description: 'Protocol (UDP, TCP, TLS, etc.)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'proto', template: '$proto', description: 'Transport protocol (text)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'prid', template: '$prid', description: 'Transport protocol ID (integer)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'siz', template: '$siz', description: 'Source IP address (sanitized for IPv6)', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'su', template: '$su', description: 'Source address as SIP URI', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'sut', template: '$sut', description: 'Source address as SIP URI with transport', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'sas', template: '$sas', description: 'Source address as socket string', category: 'network', isBare: true, isReadOnly: true },
  { pvClass: 'conid', template: '$conid', description: 'TCP/TLS connection ID', category: 'network', isBare: true, isReadOnly: true },
  // Destination
  { pvClass: 'du', template: '$du', description: 'Destination URI', category: 'sip_uri', isBare: true, isReadOnly: false },
  { pvClass: 'dd', template: '$dd', description: 'Domain of destination URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'dp', template: '$dp', description: 'Port of destination URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'dP', template: '$dP', description: 'Transport of destination URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'ds', template: '$ds', description: 'Destination set', category: 'sip_uri', isBare: true, isReadOnly: true },
  // Original R-URI
  { pvClass: 'ou', template: '$ou', description: 'Original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'oU', template: '$oU', description: 'Username of original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'oUl', template: '$oUl', description: 'Username length of original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'od', template: '$od', description: 'Domain of original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'op', template: '$op', description: 'Port of original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'oP', template: '$oP', description: 'Transport of original Request-URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  // Auth headers
  { pvClass: 'au', template: '$au', description: 'Authorization username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'ad', template: '$ad', description: 'Authorization realm (domain)', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'aU', template: '$aU', description: 'Proxy-Authorization username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'ar', template: '$ar', description: 'Authorization realm', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'adu', template: '$adu', description: 'Authorization digest URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'aa', template: '$aa', description: 'Authorization algorithm', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Au', template: '$Au', description: 'URI of Authorization header', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'AU', template: '$AU', description: 'Username from Authorization header URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  // P-headers
  { pvClass: 'ai', template: '$ai', description: 'P-Asserted-Identity URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'pu', template: '$pu', description: 'P-Preferred-Identity URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'pU', template: '$pU', description: 'P-Preferred-Identity username', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'pd', template: '$pd', description: 'P-Preferred-Identity domain', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'pn', template: '$pn', description: 'P-Preferred-Identity display name', category: 'sip_uri', isBare: true, isReadOnly: true },
  // Diversion
  { pvClass: 'di', template: '$di', description: 'Diversion header URI', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'dip', template: '$dip', description: 'Diversion privacy parameter', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'dir', template: '$dir', description: 'Diversion reason parameter', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'dic', template: '$dic', description: 'Diversion counter parameter', category: 'other', isBare: true, isReadOnly: true },
  // Other SIP headers
  { pvClass: 're', template: '$re', description: 'Remote-Party-ID URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'rt', template: '$rt', description: 'Refer-To URI', category: 'sip_uri', isBare: true, isReadOnly: true },
  { pvClass: 'route_uri', template: '$route_uri', description: 'URI from first Route header', category: 'sip_uri', isBare: true, isReadOnly: true },
  // Branch
  { pvClass: 'bf', template: '$bf', description: 'Branch flags', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'br', template: '$br', description: 'Branch', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'bR', template: '$bR', description: 'Branch (R-URI)', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'bF', template: '$bF', description: 'Branch flags (hex)', category: 'other', isBare: true, isReadOnly: false },
  // Flags
  { pvClass: 'mf', template: '$mf', description: 'Message flags (decimal)', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'mF', template: '$mF', description: 'Message flags (hex)', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'sf', template: '$sf', description: 'Script flags (decimal)', category: 'other', isBare: true, isReadOnly: false },
  { pvClass: 'sF', template: '$sF', description: 'Script flags (hex)', category: 'other', isBare: true, isReadOnly: false },
  // Time
  { pvClass: 'Ts', template: '$Ts', description: 'Current timestamp (unix epoch)', category: 'time', isBare: true, isReadOnly: true },
  { pvClass: 'Tf', template: '$Tf', description: 'Current time formatted', category: 'time', isBare: true, isReadOnly: true },
  { pvClass: 'Tb', template: '$Tb', description: 'Startup timestamp (unix epoch)', category: 'time', isBare: true, isReadOnly: true },
  { pvClass: 'TS', template: '$TS', description: 'Unix timestamp as string', category: 'time', isBare: true, isReadOnly: true },
  { pvClass: 'TF', template: '$TF', description: 'Formatted timestamp (YYYY-MM-DD HH:MM:SS)', category: 'time', isBare: true, isReadOnly: true },
  // Return code
  { pvClass: 'rc', template: '$rc', description: 'Return code of last function', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'retcode', template: '$retcode', description: 'Return code of last function', category: 'other', isBare: true, isReadOnly: true },
  // Forced socket
  { pvClass: 'fs', template: '$fs', description: 'Forced send socket', category: 'network', isBare: true, isReadOnly: false },
  { pvClass: 'fsn', template: '$fsn', description: 'Forced send socket name', category: 'network', isBare: true, isReadOnly: false },
  // Process/server
  { pvClass: 'pp', template: '$pp', description: 'Process PID', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'sid', template: '$sid', description: 'Server ID', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'sruid', template: '$sruid', description: 'Server unique ID', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'ruid', template: '$ruid', description: 'Record unique ID', category: 'other', isBare: true, isReadOnly: true },
  // Misc
  { pvClass: 'RANDOM', template: '$RANDOM', description: 'Random number', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'hu', template: '$hu', description: 'URL hash value', category: 'other', isBare: true, isReadOnly: true },
  // Escape characters
  { pvClass: 'Eb', template: '$Eb', description: 'Backslash character (\\)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'En', template: '$En', description: 'Newline character (\\n)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Er', template: '$Er', description: 'Carriage return character (\\r)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Et', template: '$Et', description: 'Tab character (\\t)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Es', template: '$Es', description: 'Space character', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Ec', template: '$Ec', description: 'Colon character (:)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Eq', template: '$Eq', description: 'Double-quote character (")', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Ek', template: '$Ek', description: 'Back-tick character (`)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Ei', template: '$Ei', description: 'Pipe character (|)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Ej', template: '$Ej', description: 'Comma character (,)', category: 'other', isBare: true, isReadOnly: true },
  { pvClass: 'Ev', template: '$Ev', description: 'Vertical tab character', category: 'other', isBare: true, isReadOnly: true },
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
