import dns from 'dns/promises';
import { URL } from 'url';
import https from 'https';
import http from 'http';
import net from 'net';

/**
 * Checks if an IPv4 address is in private, loopback, multicast, link-local, or reserved ranges
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const nums = parts.map(Number);
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return false;

  const [a, b, c] = nums;

  // 0.0.0.0/8 (Broadcast/Current network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private)
  if (a === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-Local, AWS / GCP / Azure instance metadata: 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Network benchmark tests)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (Multicast)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in loopback, unique local, or link-local ranges
 */
export function isPrivateIPv6(ip: string): boolean {
  if (!ip.includes(':')) return false;
  const normalized = ip.toLowerCase();

  // IPv4-mapped IPv6 (::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (normalized.startsWith('::ffff:')) {
    const ipv4Part = normalized.substring(7);
    if (net.isIPv4(ipv4Part)) {
      return isPrivateIPv4(ipv4Part);
    }
    return true; // Malformed or unusual IPv4 mapping blocked
  }

  // Unspecified ::
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // Loopback ::1
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Link-local fe80::/10
  if (
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  ) {
    return true;
  }

  // Unique local fc00::/7
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Documentation 2001:db8::/32
  if (normalized.startsWith('2001:db8') || normalized.startsWith('2001:0db8')) return true;

  // Multicast ff00::/8
  if (normalized.startsWith('ff')) return true;

  return false;
}

/**
 * Checks whether an IP (v4 or v6) is restricted
 */
export function isRestrictedIp(ip: string): boolean {
  return isPrivateIPv4(ip) || isPrivateIPv6(ip);
}

export interface SsrfCheckResult {
  valid: boolean;
  code?: 'SSRF_BLOCKED' | 'INVALID_URL' | 'UNSUPPORTED_SCHEME' | 'DNS_FAILED' | 'SITE_UNREACHABLE';
  resolvedIp?: string;
  finalUrl?: string;
  statusCode?: number;
  error?: string;
  warning?: string;
  title?: string;
  favicon?: string;
}

export interface ValidationOptions {
  requireHttps?: boolean;
  maxRedirects?: number;
  timeoutMs?: number;
  allowLoopbackForTesting?: boolean;
  rejectUnauthorized?: boolean;
  checkReachability?: boolean;
}

/**
 * Checks hostname for prohibited internal/local domain names
 */
function isProhibitedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    h.endsWith('.lan') ||
    h.endsWith('.home') ||
    h.endsWith('.corp') ||
    h.endsWith('.invalid')
  );
}

/**
 * Validates a target URL against SSRF vulnerabilities and DNS resolution
 */
export async function validateSsrfUrl(
  urlString: string,
  options: ValidationOptions = {}
): Promise<SsrfCheckResult> {
  const {
    requireHttps = true,
    allowLoopbackForTesting = false,
  } = options;

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, code: 'INVALID_URL', error: 'Invalid URL format.' };
  }

  // Reject credentials in URL (e.g. https://user:pass@domain)
  if (parsed.username || parsed.password) {
    return { valid: false, code: 'INVALID_URL', error: 'URL credentials are not permitted.' };
  }

  // Scheme validation: strictly HTTPS by default
  if (parsed.protocol === 'http:' && !requireHttps) {
    // Allowed only if explicitly permit http
  } else if (parsed.protocol === 'http:' && requireHttps) {
    // If targeting loopback/metadata, flag SSRF first for consistent error code
    const host = parsed.hostname.toLowerCase();
    if (isProhibitedHostname(host) || isRestrictedIp(host)) {
      return {
        valid: false,
        code: 'SSRF_BLOCKED',
        error: 'Access to private, loopback, or cloud metadata IP ranges is blocked.',
      };
    }
    return {
      valid: false,
      code: 'UNSUPPORTED_SCHEME',
      error: 'Insecure HTTP is rejected. HTTPS is required by default for secure Android APK packaging.',
    };
  } else if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      code: 'UNSUPPORTED_SCHEME',
      error: `Unsupported scheme "${parsed.protocol}". Only HTTPS protocol is permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Local or internal domain names check
  if (!allowLoopbackForTesting && isProhibitedHostname(hostname)) {
    return {
      valid: false,
      code: 'SSRF_BLOCKED',
      error: 'Access to local or internal domain names is blocked.',
    };
  }

  // Direct IP address in URL check
  if (!allowLoopbackForTesting && (isPrivateIPv4(hostname) || isPrivateIPv6(hostname))) {
    return {
      valid: false,
      code: 'SSRF_BLOCKED',
      error: 'Access to private, loopback, or metadata IP ranges is blocked.',
    };
  }

  // Resolve hostname via DNS
  try {
    const lookup = await dns.lookup(hostname, { all: true });
    if (!lookup || lookup.length === 0) {
      return {
        valid: false,
        code: 'DNS_FAILED',
        error: `Could not resolve hostname "${hostname}".`,
      };
    }

    for (const record of lookup) {
      const isBlocked =
        record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address);

      if (isBlocked && !allowLoopbackForTesting) {
        return {
          valid: false,
          code: 'SSRF_BLOCKED',
          resolvedIp: record.address,
          error: `Security Alert: Hostname "${hostname}" resolved to restricted IP ${record.address}.`,
        };
      }
    }

    return {
      valid: true,
      resolvedIp: lookup[0].address,
    };
  } catch (err: any) {
    return {
      valid: false,
      code: 'DNS_FAILED',
      error: `DNS resolution failed for hostname "${hostname}": ${err.message}`,
    };
  }
}

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Web2APK/1.0';

export const PROBE_HEADERS: Record<string, string> = {
  'User-Agent': BROWSER_USER_AGENT,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Dest': 'document',
  'Upgrade-Insecure-Requests': '1',
};

interface HopProbeResult {
  action: 'success' | 'redirect' | 'error';
  statusCode?: number;
  location?: string;
  title?: string;
  warning?: string;
  code?: 'SITE_UNREACHABLE' | 'SSRF_BLOCKED';
  error?: string;
}

function probeSingleMethod(
  method: 'HEAD' | 'GET',
  parsed: URL,
  resolvedIp: string,
  timeoutMs: number,
  rejectUnauthorized: boolean
): Promise<HopProbeResult> {
  return new Promise<HopProbeResult>((resolve) => {
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const port = parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80;

    const headers: Record<string, string> = {
      ...PROBE_HEADERS,
      Host: parsed.host,
    };

    if (method === 'GET') {
      headers['Range'] = 'bytes=0-8192';
    }

    const reqOptions: https.RequestOptions = {
      hostname: parsed.hostname,
      port,
      path: parsed.pathname + parsed.search,
      method,
      headers,
      timeout: timeoutMs,
      rejectUnauthorized,
      lookup: (_hostname, options, callback) => {
        const cb = typeof options === 'function' ? options : callback;
        const opts = typeof options === 'object' && options ? options : {};
        const family = net.isIP(resolvedIp);
        if (opts.all) {
          cb(null, [{ address: resolvedIp, family: family || 4 }]);
        } else {
          cb(null, resolvedIp, family || 4);
        }
      },
    };

    let settled = false;
    const safeResolve = (resObj: HopProbeResult) => {
      if (!settled) {
        settled = true;
        resolve(resObj);
      }
    };

    const req = transport.request(reqOptions, (res) => {
      const statusCode = res.statusCode || 0;

      // Check for redirects (301, 302, 303, 307, 308)
      if ([301, 302, 303, 307, 308].includes(statusCode) && res.headers.location) {
        res.resume();
        safeResolve({
          action: 'redirect',
          location: res.headers.location,
          statusCode,
        });
        return;
      }

      if (method === 'HEAD') {
        res.resume();
        if (statusCode >= 200 && statusCode < 400) {
          safeResolve({ action: 'success', statusCode });
          return;
        }

        // Return status code so caller can attempt fallback GET probe
        safeResolve({
          action: 'error',
          statusCode,
          code: 'SITE_UNREACHABLE',
          error: `HEAD request returned HTTP status: ${statusCode}`,
        });
        return;
      }

      // Method is GET
      let bodyData = '';
      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        bodyData += chunk;
        if (bodyData.length >= 8192) {
          res.destroy(); // Safely limit data stream to prevent buffering large payloads
        }
      });

      const finishGet = () => {
        let title: string | undefined;
        const titleMatch = bodyData.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch && titleMatch[1]) {
          title = titleMatch[1].trim();
        }

        if (statusCode >= 200 && statusCode < 400) {
          safeResolve({ action: 'success', statusCode, title });
          return;
        }

        // Status 4xx or 5xx from a verified public IP
        const statusName = http.STATUS_CODES[statusCode] || 'Status';
        let warning = `Target website returned HTTP ${statusCode} (${statusName}). Build will proceed.`;
        if (statusCode === 503) {
          warning = `Target website returned HTTP 503 (Service Unavailable / CDN Protection). Android WebView will connect directly from device.`;
        } else if (statusCode === 403) {
          warning = `Target website returned HTTP 403 (Forbidden / WAF Protection). Android WebView will connect directly from device.`;
        }

        safeResolve({
          action: 'success',
          statusCode,
          title,
          warning,
        });
      };

      res.on('end', finishGet);
      res.on('close', finishGet);
    });

    req.on('timeout', () => {
      req.destroy();
      safeResolve({
        action: 'error',
        code: 'SITE_UNREACHABLE',
        error: `Connection to ${parsed.hostname} timed out after ${timeoutMs}ms.`,
      });
    });

    req.on('error', (err: any) => {
      safeResolve({
        action: 'error',
        code: 'SITE_UNREACHABLE',
        error: `Target website is unreachable: ${err.message}`,
      });
    });

    req.end();
  });
}

async function probeHopWithFallback(
  parsed: URL,
  resolvedIp: string,
  timeoutMs: number,
  rejectUnauthorized: boolean
): Promise<HopProbeResult> {
  // Try HEAD probe first
  const headResult = await probeSingleMethod('HEAD', parsed, resolvedIp, timeoutMs, rejectUnauthorized);

  if (headResult.action === 'success' || headResult.action === 'redirect') {
    return headResult;
  }

  // If HEAD failed with an HTTP status code (such as 503, 405, 400, 403, 500, etc.)
  // OR if HEAD failed, retry with a lightweight GET probe
  const getResult = await probeSingleMethod('GET', parsed, resolvedIp, timeoutMs, rejectUnauthorized);
  if (getResult.action === 'success' || getResult.action === 'redirect') {
    return getResult;
  }

  // If GET also failed, check if either HEAD or GET received an HTTP status code from the server
  const reportedStatus = getResult.statusCode || headResult.statusCode;
  if (reportedStatus) {
    const statusName = http.STATUS_CODES[reportedStatus] || 'Status';
    return {
      action: 'success',
      statusCode: reportedStatus,
      warning: reportedStatus === 503
        ? 'Target website returned HTTP 503 (Service Unavailable / CDN Protection). Android WebView will connect directly from device.'
        : `Target website returned HTTP ${reportedStatus} (${statusName}). Build will proceed.`,
    };
  }

  // Genuine network/connection failure
  return getResult.error ? getResult : headResult;
}

/**
 * Validates a target URL with reachability, DNS validation, and redirect inspection.
 * Enforces network-level egress restrictions to prevent SSRF at every redirect hop.
 * NEVER executes arbitrary website code.
 */
export async function validateUrlReachability(
  initialUrl: string,
  options: ValidationOptions = {}
): Promise<SsrfCheckResult> {
  const maxRedirects = options.maxRedirects ?? 5;
  const timeoutMs = options.timeoutMs ?? 5000;
  const allowLoopback = options.allowLoopbackForTesting ?? false;
  const rejectUnauthorized = options.rejectUnauthorized !== false;

  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (redirectCount <= maxRedirects) {
    // 1. Validate syntax and SSRF on current hop URL
    const hopCheck = await validateSsrfUrl(currentUrl, {
      ...options,
      requireHttps: !allowLoopback, // In local test servers, allow http if allowLoopback
    });

    if (!hopCheck.valid) {
      return hopCheck;
    }

    const parsed = new URL(currentUrl);
    const resolvedIp = hopCheck.resolvedIp!;

    // 2. Perform safe network check with IP pinned connection (prevents DNS rebinding)
    const hopResult = await probeHopWithFallback(
      parsed,
      resolvedIp,
      timeoutMs,
      rejectUnauthorized
    );

    if (hopResult.action === 'success') {
      const host = new URL(currentUrl).hostname.replace(/^www\./, '');
      const domainName = host.split('.')[0] || 'App';
      const defaultTitle = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      const title = hopResult.title || `${defaultTitle} Web Application`;

      return {
        valid: true,
        resolvedIp,
        finalUrl: currentUrl,
        statusCode: hopResult.statusCode,
        title,
        favicon: `https://www.google.com/s2/favicons?domain=${host}&sz=128`,
        warning: hopResult.warning,
      };
    }

    if (hopResult.action === 'error') {
      return {
        valid: false,
        code: hopResult.code,
        resolvedIp,
        error: hopResult.error,
      };
    }

    if (hopResult.action === 'redirect') {
      redirectCount++;
      if (redirectCount > maxRedirects) {
        return {
          valid: false,
          code: 'SITE_UNREACHABLE',
          error: `Exceeded maximum redirect limit of ${maxRedirects}.`,
        };
      }

      if (!hopResult.location) {
        return {
          valid: false,
          code: 'INVALID_URL',
          error: 'Target returned redirect status without Location header.',
        };
      }

      // Resolve redirect target URL relative to current hop
      let nextUrl: string;
      try {
        nextUrl = new URL(hopResult.location, currentUrl).toString();
      } catch {
        return {
          valid: false,
          code: 'INVALID_URL',
          error: `Target returned invalid redirect Location header: "${hopResult.location}".`,
        };
      }

      // Check the redirect destination for SSRF violations immediately
      const nextParsed = new URL(nextUrl);
      const nextHost = nextParsed.hostname.toLowerCase();

      // Enforce scheme on redirect
      if (nextParsed.protocol !== 'https:' && nextParsed.protocol !== 'http:') {
        return {
          valid: false,
          code: 'SSRF_BLOCKED',
          error: `Security Alert: Redirect to unsupported scheme "${nextParsed.protocol}" is blocked.`,
        };
      }

      // Prohibited hostnames or restricted IPs (localhost, 127.0.0.1, 169.254.169.254, private ranges)
      if (isProhibitedHostname(nextHost) || isRestrictedIp(nextHost)) {
        return {
          valid: false,
          code: 'SSRF_BLOCKED',
          error: `Security Alert: Redirect destination "${nextUrl}" targets restricted IP or hostname (SSRF blocked).`,
        };
      }

      // Resolve DNS of redirect hop to detect DNS-based SSRF
      try {
        const lookup = await dns.lookup(nextHost, { all: true });
        for (const record of lookup) {
          if (isRestrictedIp(record.address)) {
            return {
              valid: false,
              code: 'SSRF_BLOCKED',
              error: `Security Alert: Redirect destination "${nextHost}" resolved to restricted IP ${record.address}.`,
            };
          }
        }
      } catch {
        return {
          valid: false,
          code: 'DNS_FAILED',
          error: `DNS resolution failed for redirect target "${nextHost}".`,
        };
      }

      currentUrl = nextUrl;
    }
  }

  return {
    valid: false,
    code: 'SITE_UNREACHABLE',
    error: `Exceeded maximum redirect limit of ${maxRedirects}.`,
  };
}
