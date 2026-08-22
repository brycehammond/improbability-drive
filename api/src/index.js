import { app } from '@azure/functions';
import { createDriveHandler, createRecentHandler, createReportHandler, defaultClient } from './drive.js';
import { defaultStore } from './store.js';

const store = await defaultStore();
const client = defaultClient();

app.http('drive', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'drive',
  handler: createDriveHandler({ client, store }),
});

app.http('report', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'reports/{id}',
  handler: createReportHandler({ store }),
});

app.http('recent', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recent',
  handler: createRecentHandler({ store }),
});
