export function isOriginAllowed(request: Request, url: URL): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const isAllowedHost =
      originUrl.hostname === '127.0.0.1' || originUrl.hostname === 'localhost';
    const isSamePort = originUrl.port === url.port;
    return isAllowedHost && isSamePort;
  } catch {
    return false;
  }
}
