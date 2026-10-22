import { json, type RequestHandler } from '@sveltejs/kit';
import { existsSync } from 'node:fs';
import { readRecentRuns } from '../../../lib/server/history';
import { isOriginAllowed } from '../../../lib/server/origin';
import type { HistoryRunItem } from '../../../lib/history-format';

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isOriginAllowed(request, url)) {
    return json({ error: 'Forbidden origin' }, { status: 403 });
  }

  const runs = await readRecentRuns(20);
  const items: HistoryRunItem[] = runs.map((run) => {
    let logExists = false;
    if (run.logFile) {
      try {
        logExists = existsSync(run.logFile);
      } catch {
        logExists = false;
      }
    }
    return {
      ...run,
      logExists,
    };
  });

  return json(items);
};
