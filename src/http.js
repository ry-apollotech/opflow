export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
}

export function describeError(data, text) {
  if (data?.errorIdentifier) return `${data.errorIdentifier}: ${data.message}`;
  if (data?.ocs?.meta?.message) return data.ocs.meta.message;
  if (data?.message) return data.message;
  return (text || '').slice(0, 200) || 'no response body';
}

export async function requestJson(fetchFn, { method = 'GET', url, headers = {}, body }) {
  const hasBody = body !== undefined;
  const res = await fetchFn(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    throw new HttpError(`${method} ${new URL(url).pathname} -> ${res.status}: ${describeError(data, text)}`, res.status);
  }
  return data;
}
