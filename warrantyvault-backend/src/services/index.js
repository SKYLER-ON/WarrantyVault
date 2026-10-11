import { createProductService } from './products.js';
import { createCenterService } from './centers.js';
import { createClaimService } from './claims.js';

/** ctx = { db, ai, config, now } — injected so tests can swap in a fake database. */
export function createServices(ctx) {
  return {
    products: createProductService(ctx),
    centers: createCenterService(ctx),
    claims: createClaimService(ctx),
  };
}
