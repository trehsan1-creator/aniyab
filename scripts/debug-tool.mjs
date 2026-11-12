// ESM harness: import tsx's TS loader, then probe tools directly.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// stub server-only before anything imports it
const Module = require('node:module');
const orig = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return orig.call(this, request, parent, isMain);
};
Module.syncBuiltinESMExports?.();

require('tsx/cjs');
const { executeTool } = require('../lib/agent/tools.ts');
const { findOrCreateCustomer } = require('../lib/db/store.ts');

(async () => {
  const c = await findOrCreateCustomer({ authUserId: 'dev-tool-test' });
  const ctx = { customerId: c.id, conversationId: 'x', deviceId: 'dev-tool-test' };
  const cases = [
    ['quote_newspaper_ad', { docType: 'phone', newspaper: 'hamshahri', size: 'medium', days: 3, highlighted: true, publishDate: '۱۴۰۴/۰۸/۲۵', itemName: 'گوشی موبایل', place: 'مترو ونک' }],
    ['lookup_registry', { nationalId: '0499370899' }],
    ['get_report_status', {}],
    ['request_found_post', {}],
  ];
  for (const [name, args] of cases) {
    const r = await executeTool(name, args, ctx);
    console.log(name, '→', JSON.stringify(r).slice(0, 360));
  }
})();
