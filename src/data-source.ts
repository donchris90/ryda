import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Used only by the TypeORM CLI (`npm run migration:*`) — the running app
 * itself still uses `autoLoadEntities: true` via `DatabaseModule`'s
 * `TypeOrmModule.forRootAsync`, which doesn't work with the standalone CLI
 * (it relies on Nest's DI to discover entities registered via
 * `TypeOrmModule.forFeature()` across every module). This DataSource globs
 * the same `*.entity.ts` files directly instead.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  database: process.env.DB_NAME ?? 'ryda',
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
  synchronize: false, // migrations only, deliberately — this is the whole point of this file existing
});
