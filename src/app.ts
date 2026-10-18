import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import domainRoutes from './routes/domain';
import publicRoutes from './routes/public';
import platformRoutes from './routes/platform';
import { loadTenantOrigins, originAllowed, staticOrigins } from './lib/corsOrigins';

export function createApp() {
  const app = express();
  const fixedOrigins = staticOrigins();

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permite requisições sem origin (ex: Postman, Railway health checks)
        // callback(null, false) em vez de Error — Error vira 500 sem headers CORS
        if (!origin) {
          callback(null, true);
          return;
        }
        loadTenantOrigins()
          .then((tenantOrigins) => {
            callback(null, originAllowed(origin, tenantOrigins, fixedOrigins));
          })
          .catch(() => {
            callback(null, originAllowed(origin, [], fixedOrigins));
          });
      },
      credentials: true,
    })
  );
  app.use(express.json());

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
