export function allowedClientOrigins(origin = process.env.CLIENT_ORIGIN || 'http://localhost:5173', environment = process.env.NODE_ENV) {
  const origins = [origin];
  if (environment !== 'production') {
    const url = new URL(origin);
    // Only alias an explicitly configured loopback host, keeping its scheme and port.
    if (url.origin === origin && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1'].includes(url.hostname)) {
      url.hostname = url.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
      origins.push(url.origin);
    }
  }
  return origins;
}
