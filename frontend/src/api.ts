const API = 'https://onda-backend.pensive-kim.workers.dev';

async function request(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

export const api = {
  get: (path: string, token?: string) => request('GET', path, undefined, token),
  post: (path: string, body: unknown, token?: string) => request('POST', path, body, token),
  patch: (path: string, body: unknown, token?: string) => request('PATCH', path, body, token),
  del: (path: string, token?: string) => request('DELETE', path, undefined, token),
  API_URL: API,
};
