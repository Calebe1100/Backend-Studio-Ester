import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import domainRoutes from './routes/domain';
import publicRoutes from './routes/public';
import platformRoutes from './routes/platform';
import { loadTenantOrigins, originAllowed, staticOrigins } from './lib/corsOrigins';

const TENANT_ORIGIN_WAIT_MS = 2_000;

/** O preflight não pode esperar um banco lento: o app desiste da chamada em 12s. */
function loadTenantOriginsBounded(): Promise<string[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), TENANT_ORIGIN_WAIT_MS);
    loadTenantOrigins()
      .then((origins) => {
        clearTimeout(timer);
        resolve(origins);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve([]);
      });
  });
}

export function createApp() {
  const app = express();
  const fixedOrigins = staticOrigins();

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permite requisições sem origin (ex: Postman, Railway health checks)
        // callback(null, false) em vez de Error — Error vira 500 sem headers CORS
        if (!origin || originAllowed(origin, [], fixedOrigins)) {
          callback(null, true);
          return;
        }
        loadTenantOriginsBounded().then((tenantOrigins) => {
          callback(null, originAllowed(origin, tenantOrigins, fixedOrigins));
        });
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Rotas. Plataforma antes do domínio para a chave não passar pelo JWT do salão.
  app.use('/api/platform', platformRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api', domainRoutes);

  // Handler de erros genérico
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: 'Erro interno do servidor' });
    }
  );

  return app;
}
