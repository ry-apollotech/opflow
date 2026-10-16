import { basicAuth, requestJson } from './http.js';
import { closeBody, commentBody, myOpenInVersionFilters, searchFilters, todayFilters, todayRangeFilters, workPackageCreateBody } from './payloads.js';

export const TYPE_NAME = 'User Story';
export const DONE_STATUS = 'Closed';

export function findByName(elements, name, kind) {
  const hit = elements.find((el) => el.name.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`${kind} "${name}" not found. Available: ${elements.map((el) => el.name).join(', ')}`);
  return hit;
}

export function currentSprint(versions) {
  const sprints = versions
    .filter((v) => v.status === 'open')
    .map((v) => ({ v, n: /^Sprint (\d+)$/.exec(v.name)?.[1] }))
    .filter(({ n }) => n !== undefined);
  if (!sprints.length) throw new Error('No open version named "Sprint <N>" in the project');
  return sprints.reduce((a, b) => (Number(b.n) > Number(a.n) ? b : a)).v;
}

export function createOpenProjectClient({ url, apiKey, project }, fetchFn = fetch) {
  const headers = { Authorization: basicAuth('apikey', apiKey) };
  const call = (method, path, body) => requestJson(fetchFn, { method, url: url + path, headers, body });
  const projectPath = `/api/v3/projects/${encodeURIComponent(project)}`;
  const wpPath = (id) => `/api/v3/work_packages/${encodeURIComponent(id)}`;
  const listWorkPackages = async (filters, pageSize = 100) => {
    const res = await call('GET', `${projectPath}/work_packages?filters=${encodeURIComponent(filters)}&pageSize=${pageSize}`);
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

    async findType(name) {
      const res = await call('GET', `${projectPath}/types`);
      return res._embedded.elements.find((el) => el.name.toLowerCase() === name.toLowerCase()) ?? null;
    },

    // Servers without the "search" filter answer 400; that just means no search matches.
    async searchWorkPackages(text) {
      try {
        return await listWorkPackages(searchFilters(text), 10);
      } catch (err) {
        if (err.status !== 400) throw err;
        return [];
      }
    },

    addComment: (id, text) => call('POST', `${wpPath(id)}/activities`, commentBody(text)),

    async listVersions() {
      const res = await call('GET', `${projectPath}/versions?pageSize=500`);
      return res._embedded.elements;
    },

    async listMyOpenInVersion(versionId) {
      const res = await call('GET', `${projectPath}/work_packages?filters=${encodeURIComponent(myOpenInVersionFilters(versionId))}&pageSize=100`);
      const items = res._embedded.elements;
      if (res.total > items.length) {
        throw new Error(`Version ${versionId} has ${res.total} of your open work packages; only ${items.length} were read`);
      }
      return items;
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
