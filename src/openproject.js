import { basicAuth, requestJson } from './http.js';
import { closeBody, todayFilters, todayRangeFilters, workPackageCreateBody } from './payloads.js';

export function findByName(elements, name, kind) {
  const hit = elements.find((el) => el.name.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`${kind} "${name}" not found. Available: ${elements.map((el) => el.name).join(', ')}`);
  return hit;
}

export function createOpenProjectClient({ url, apiKey, project }, fetchFn = fetch) {
  const headers = { Authorization: basicAuth('apikey', apiKey) };
  const call = (method, path, body) => requestJson(fetchFn, { method, url: url + path, headers, body });
  const projectPath = `/api/v3/projects/${encodeURIComponent(project)}`;
  const wpPath = (id) => `/api/v3/work_packages/${encodeURIComponent(id)}`;
  const listWorkPackages = async (filters) => {
    const res = await call('GET', `${projectPath}/work_packages?filters=${encodeURIComponent(filters)}&pageSize=100`);
    return res._embedded.elements;
  };

  return {
    me: () => call('GET', '/api/v3/users/me'),
    project: () => call('GET', projectPath),

    async resolveType(name) {
      const res = await call('GET', `${projectPath}/types`);
      return findByName(res._embedded.elements, name, 'Type');
    },

    async resolveStatus(name) {
      const res = await call('GET', '/api/v3/statuses');
      return findByName(res._embedded.elements, name, 'Status');
    },

    createWorkPackage: (task, ids) => call('POST', `${projectPath}/work_packages`, workPackageCreateBody(task, ids)),

    getWorkPackage: (id) => call('GET', wpPath(id)),

    async closeWorkPackage(id, statusId) {
      for (let attempt = 1; ; attempt++) {
        const wp = await call('GET', wpPath(id));
        try {
          return await call('PATCH', wpPath(id), closeBody(wp.lockVersion, statusId));
        } catch (err) {
          if (err.status !== 409 || attempt >= 2) throw err;
        }
      }
    },

    async listUpdatedToday(today) {
      try {
        return await listWorkPackages(todayFilters());
      } catch (err) {
        if (err.status !== 400) throw err;
        return listWorkPackages(todayRangeFilters(today));
      }
    },
  };
}
