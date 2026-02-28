export interface SipHeader {
  name: string;
  description: string;
  rfc?: string;
}

export const STANDARD_SIP_HEADERS: SipHeader[] = [
  { name: 'Via', description: 'Indicates the transport used for the transaction and identifies the location where the response is to be sent', rfc: 'RFC 3261' },
  { name: 'From', description: 'Indicates the initiator of the request', rfc: 'RFC 3261' },
  { name: 'To', description: 'Specifies the desired logical recipient of the request', rfc: 'RFC 3261' },
  { name: 'Call-ID', description: 'Uniquely identifies a particular invitation or all registrations of a particular client', rfc: 'RFC 3261' },
  { name: 'CSeq', description: 'Serves to order transactions within a dialog, provide a means to uniquely identify transactions', rfc: 'RFC 3261' },
  { name: 'Contact', description: 'Provides a URI whose meaning depends on the type of request or response it is in', rfc: 'RFC 3261' },
  { name: 'Max-Forwards', description: 'Limits the number of hops a request can transit on the way to its destination', rfc: 'RFC 3261' },
  { name: 'Route', description: 'Forces routing for a request through the listed set of proxies', rfc: 'RFC 3261' },
  { name: 'Record-Route', description: 'Inserted by proxies to force future requests to be routed through the proxy', rfc: 'RFC 3261' },
  { name: 'Content-Type', description: 'Indicates the media type of the message body', rfc: 'RFC 3261' },
  { name: 'Content-Length', description: 'Indicates the size of the message body in bytes', rfc: 'RFC 3261' },
  { name: 'Expires', description: 'Gives the relative time after which the message or content expires', rfc: 'RFC 3261' },
  { name: 'Allow', description: 'Lists the set of methods supported by the UA generating the message', rfc: 'RFC 3261' },
  { name: 'Supported', description: 'Enumerates all the extensions supported by the UAC or UAS', rfc: 'RFC 3261' },
  { name: 'Require', description: 'Used by UACs to tell UASes about options that the UAC expects the UAS to support', rfc: 'RFC 3261' },
  { name: 'Proxy-Require', description: 'Used to indicate proxy-sensitive features that must be supported by the proxy', rfc: 'RFC 3261' },
  { name: 'User-Agent', description: 'Contains information about the UAC originating the request', rfc: 'RFC 3261' },
  { name: 'Server', description: 'Contains information about the UAS handling the request', rfc: 'RFC 3261' },
  { name: 'Authorization', description: 'Contains credentials of a UA authenticating itself to a UAS', rfc: 'RFC 3261' },
  { name: 'Proxy-Authorization', description: 'Allows the client to identify itself to a proxy that requires authentication', rfc: 'RFC 3261' },
  { name: 'WWW-Authenticate', description: 'Contains an authentication challenge from a UAS', rfc: 'RFC 3261' },
  { name: 'Proxy-Authenticate', description: 'Contains an authentication challenge from a proxy', rfc: 'RFC 3261' },
  { name: 'Reason', description: 'Indicates why a SIP request was issued or why a provisional response was sent', rfc: 'RFC 3326' },
  { name: 'Diversion', description: 'Conveys information about call diversion/forwarding', rfc: 'RFC 5806' },
  { name: 'P-Asserted-Identity', description: 'Contains an identity of the user proven via authentication within a Trust Domain', rfc: 'RFC 3325' },
  { name: 'P-Preferred-Identity', description: 'Contains an identity the UA wishes to be used for the request', rfc: 'RFC 3325' },
  { name: 'Privacy', description: 'Indicates privacy preferences for the request', rfc: 'RFC 3323' },
  { name: 'Refer-To', description: 'Provides the URI to refer to', rfc: 'RFC 3515' },
  { name: 'Referred-By', description: 'Provides a referrer URI', rfc: 'RFC 3892' },
  { name: 'Replaces', description: 'Indicates that a single dialog identified by the header field is to be replaced', rfc: 'RFC 3891' },
  { name: 'Session-Expires', description: 'Conveys the session interval for a SIP session', rfc: 'RFC 4028' },
  { name: 'Min-SE', description: 'Indicates the minimum session expiration interval', rfc: 'RFC 4028' },
  { name: 'Event', description: 'Indicates the event package to which a subscription or notification pertains', rfc: 'RFC 6665' },
  { name: 'Subscription-State', description: 'Indicates the status of a subscription', rfc: 'RFC 6665' },
  { name: 'Accept', description: 'Indicates which content types are acceptable in the response', rfc: 'RFC 3261' },
  { name: 'Accept-Encoding', description: 'Indicates which content codings are acceptable in the response', rfc: 'RFC 3261' },
  { name: 'Accept-Language', description: 'Indicates which languages are preferred in reason phrases, session descriptions, or status responses', rfc: 'RFC 3261' },
  { name: 'Subject', description: 'Provides a summary or indicates the nature of the call', rfc: 'RFC 3261' },
  { name: 'Priority', description: 'Indicates the urgency of the request as perceived by the client', rfc: 'RFC 3261' },
  { name: 'Date', description: 'Contains the date and time', rfc: 'RFC 3261' },
  { name: 'Retry-After', description: 'Indicates how long the service is expected to be unavailable or when the called party anticipates being available', rfc: 'RFC 3261' },
];

const HEADER_MAP = new Map<string, SipHeader>();
for (const h of STANDARD_SIP_HEADERS) {
  HEADER_MAP.set(h.name.toLowerCase(), h);
}

export function findStandardHeader(name: string): SipHeader | undefined {
  return HEADER_MAP.get(name.toLowerCase());
}
