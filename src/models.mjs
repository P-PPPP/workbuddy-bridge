import fs from 'node:fs/promises';
import path from 'node:path';
import { APP } from './common.mjs';

// An ACP initialization snapshot can lag the installed product catalog. These
// are configured candidates, not proof of account entitlement or execution.
export async function installedModels() {
  try {
    const file = path.join(APP, 'resources', 'app.asar.unpacked', 'cli', 'product.json');
    const stat = await fs.stat(file);
    if (stat.size > 4 * 1024 * 1024) return [];
    const config = JSON.parse(await fs.readFile(file, 'utf8'));
    return (Array.isArray(config.models) ? config.models : [])
      .filter(m => typeof m.id === 'string' && m.supportsToolCall === true && !m.disabled)
      .map(m => ({ modelId: m.id, name: m.name ?? m.id, source: 'installed_product_config', account_availability: 'not_verified' }));
  } catch { return []; }
}
