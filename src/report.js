export function summarize(wp) {
  return {
    id: wp.id,
    subject: wp.subject,
    status: wp._links?.status?.title ?? 'Unknown',
    updatedAt: wp.updatedAt,
  };
}

export function groupByStatus(items) {
  const groups = {};
  for (const item of items) (groups[item.status] ??= []).push(item);
  return groups;
}

export function formatGroups(groups) {
  const names = Object.keys(groups);
  if (!names.length) return 'No work packages updated today.';
  return names
    .map((name) => [`${name}:`, ...groups[name].map((item) => `  #${item.id} ${item.subject}`)].join('\n'))
    .join('\n\n');
}
