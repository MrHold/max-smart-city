import { buildApp } from './app';

const port = Number(process.env.API_PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN ?? true;

const app = buildApp({ logger: true, corsOrigin });

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
