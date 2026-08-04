import 'dotenv/config';
import { DataSource } from 'typeorm';
import { resolveDatabaseConfig } from './config/resolve-db-config.util';

/**
 * Used only by the TypeORM CLI (`npm run migration:*`) — the running app
 * itself still uses `autoLoadEntities: true` via `DatabaseModule`'s
 * `TypeOrmModule.forRootAsync`, which doesn't work with the standalone CLI
 * (it relies on Nest's DI to discover entities registered via
 * `TypeOrmModule.forFeature()` across every module). This DataSource globs
 * the same `*.entity.ts` files directly instead.
 */
const dbConfig = resolveDatabaseConfig();

export default new DataSource({
  type: 'postgres',
  host: dbConfig.host,
  port: dbConfig.port,
  username: dbConfig.username,
  password: dbConfig.password,
  database: dbConfig.name,
  ssl: (process.env.DB_SSL ?? 'false') === 'true' ? { rejectUnauthorized: false } : false,
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
  synchronize: false, // migrations only, deliberately — this is the whole point of this file existing
});
