import { basicAuth, requestJson } from './http.js';

export const MAX_MESSAGE = 32000;

export function validateMessage(message) {
  const text = message.trim();
  if (!text) throw new Error('Message is empty');
  if (text.length > MAX_MESSAGE) {
    throw new Error(`Message is ${text.length} characters; Talk allows at most ${MAX_MESSAGE}`);
  }
  return text;
}

export function createTalkClient({ url, user, appPassword, room }, fetchFn = fetch) {
  const headers = { 'OCS-APIRequest': 'true', Authorization: basicAuth(user, appPassword) };
  const base = `${url}/ocs/v2.php/apps/spreed/api`;
  const token = encodeURIComponent(room);

  return {
    async roomInfo() {
      const res = await requestJson(fetchFn, { url: `${base}/v4/room/${token}`, headers });
      return res.ocs.data;
    },

    async postMessage(message) {
      const text = validateMessage(message);
      const res = await requestJson(fetchFn, {
        method: 'POST',
        url: `${base}/v1/chat/${token}`,
        headers,
        body: { message: text },
      });
      return res.ocs.data;
    },
  };
}
