import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface HealthResponse {
  status: string;
}

/**
 * Was the untouched Nest CLI scaffold test (`GET /` -> "Hello World!")
 * from before this project had any real routes - AppController never
 * actually had a bare root route, only `GET /health` (see
 * src/app.controller.ts), so this test has been silently failing
 * against reality since day one, just never run to notice. Fixed to
 * test something this app actually has, with the same global prefix
 * the real app applies in main.ts.
 */
describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: ['verify-email', 'reset-password'],
    });
    await app.init();
  });

  it('/api/v1/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as HealthResponse;
        if (body.status !== 'ok')
          throw new Error(`Expected status "ok", got ${JSON.stringify(body)}`);
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
