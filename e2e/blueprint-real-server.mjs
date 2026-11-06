// Transport-only fakes for the explicitly enabled local full-stack proof.
// The normal dev server still loads the production Netlify router and DB role.
import { isLocalScratchDatabaseUrl } from '../src/verification/scratch-guard.mjs';

if (process.env.BLUEPRINT_REAL_E2E !== '1' || !isLocalScratchDatabaseUrl(process.env.DATABASE_URL)
  || new URL(process.env.DATABASE_URL).username !== 'fundhub_app') {
  throw new Error('Blueprint proof server requires an explicit local fundhub_app scratch database');
}
process.env.ADAPTERS_DRY_RUN = '1';
process.env.DOCUMENT_STORE_PROVIDER = 'memory';
process.env.CORTANA_COMMAS_API_KEY = 'local-blueprint-proof-transport';
process.env.FANBASIS_CHECKOUT_API_BASE = 'https://checkout-transport.example.invalid';
const actualFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'https://checkout-transport.example.invalid' && url.pathname === '/checkout-sessions') {
    const body = JSON.parse(init.body);
    if (!Number.isSafeInteger(body.amount_cents) || body.amount_cents <= 0
      || body.type !== 'onetime_non_reusable' || body.product?.title !== 'Document round'
      || !body.metadata?.link_ref || !body.metadata?.client_id || !body.metadata?.org_id) {
      throw new Error('Unexpected hosted checkout transport request');
    }
    return Response.json({data:{id:'local-session-' + body.metadata.link_ref,
      payment_link:'https://checkout.example.invalid/' + body.metadata.link_ref}});
  }
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) {
    throw new Error('External provider access is disabled in Blueprint local proof');
  }
  return actualFetch(input, init);
};
await import('../scripts/dev-server.mjs');
