export function mockFetch(responses) {
  const queue = [...responses];
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body === undefined ? undefined : JSON.parse(init.body),
    });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch: ${init.method} ${url}`);
    const { status = 200, json } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (json === undefined ? '' : JSON.stringify(json)),
    };
  };
  fn.calls = calls;
  return fn;
}
