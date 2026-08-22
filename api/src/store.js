/**
 * Where reports go once the Drive has produced them.
 *
 * Production: one Azure Table, `reports`, a single partition, row keys that
 * sort newest-first so "recent" is a prefix scan and a permalink is a point
 * read. Local: the same interface over a Map, so nothing needs an account.
 *
 * What is stored: the report the page renders, the mode, the vector, the
 * scenario (calculate mode) and `log2Odds`, a single number for the
 * improbability so history can be compared across the two probability forms.
 * Nothing about who pressed the button.
 */
import { randomBytes } from 'node:crypto';

const PARTITION = 'report';
const TABLE = 'reports';

/** 2^53 minus now, base36: later reports sort first. */
const invertedStamp = (now) => (Number.MAX_SAFE_INTEGER - now).toString(36).padStart(11, '0');

/** A new id. Time-ordered prefix, then four random characters. */
export function newId(now = Date.now()) {
  const suffix = randomBytes(3).toString('base64url').replace(/[^a-z0-9]/gi, '').slice(0, 4).padEnd(4, 'x');
  return `${invertedStamp(now)}${suffix.toLowerCase()}`;
}

/** One number for "how improbable": log2 of the odds against. */
export function log2Odds(probability) {
  if (probability?.exponent > 0) return probability.exponent;
  if (probability?.mantissa > 1) return Math.log2(probability.mantissa);
  return 0;
}

const summarise = (report) => ({
  id: report.id,
  mode: report.mode,
  event: report.event,
  probability: report.probability,
  log2Odds: log2Odds(report.probability),
  stamp: report.stamp,
  date: report.date,
});

/** @returns {Store} */
export function createMemoryStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async put(report) {
      rows.set(report.id, structuredClone(report));
    },
    async get(id) {
      const r = rows.get(id);
      return r ? structuredClone(r) : null;
    },
    async recent(limit = 20) {
      return [...rows.keys()].sort().slice(0, limit).map((id) => summarise(rows.get(id)));
    },
  };
}

/**
 * @param {string} connectionString an Azure Storage connection string
 *   (`UseDevelopmentStorage=true` for Azurite)
 * @returns {Promise<Store>}
 */
export async function createTableStore(connectionString) {
  const { TableClient } = await import('@azure/data-tables');
  const client = TableClient.fromConnectionString(connectionString, TABLE, { allowInsecureConnection: true });
  await client.createTable().catch((err) => {
    if (err?.statusCode !== 409) throw err;
  });

  return {
    kind: 'table',
    async put(report) {
      await client.createEntity({
        partitionKey: PARTITION,
        rowKey: report.id,
        mode: report.mode,
        vector: report.vector ?? '',
        scenario: report.scenario ?? '',
        event: report.event,
        exponent: report.probability.exponent ?? 0,
        mantissa: report.probability.mantissa ?? 0,
        log2Odds: log2Odds(report.probability),
        stamp: report.stamp,
        date: report.date,
        report: JSON.stringify(report),
      });
    },
    async get(id) {
      try {
        const entity = await client.getEntity(PARTITION, id);
        return JSON.parse(entity.report);
      } catch (err) {
        if (err?.statusCode === 404) return null;
        throw err;
      }
    },
    async recent(limit = 20) {
      const out = [];
      const iter = client.listEntities({
        queryOptions: {
          filter: `PartitionKey eq '${PARTITION}'`,
          select: ['rowKey', 'mode', 'event', 'exponent', 'mantissa', 'log2Odds', 'stamp', 'date'],
        },
      });
      for await (const e of iter) {
        out.push({
          id: e.rowKey,
          mode: e.mode,
          event: e.event,
          probability: e.exponent > 0 ? { exponent: e.exponent } : { mantissa: e.mantissa },
          log2Odds: e.log2Odds,
          stamp: e.stamp,
          date: e.date,
        });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}

/** Table Storage if configured, memory otherwise. */
export async function defaultStore() {
  const conn = process.env.TABLES_CONNECTION_STRING;
  if (conn) return createTableStore(conn);
  process.stderr.write('store: TABLES_CONNECTION_STRING is not set, history is in memory only\n');
  return createMemoryStore();
}

/**
 * @typedef {object} Store
 * @property {string} kind
 * @property {(report: any) => Promise<void>} put
 * @property {(id: string) => Promise<any|null>} get
 * @property {(limit?: number) => Promise<any[]>} recent
 */
