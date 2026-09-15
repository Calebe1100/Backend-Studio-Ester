import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import domainRoutes from './routes/domain';
import publicRoutes from './routes/public';

export function createApp() {
  const app = express();

  // FRONTEND_URL pode ser uma URL ou várias separadas por vírgula
  const allowedOrigins = [
    ...(process.env.FRONTEND_URL ?? '').split(',').map((s) => s.trim()),
    'https://app-studio-ester-rodrigues.vercel.app',
    'https://app-studio-ester.vercel.app',
    'https://studio-ester.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
  ].filter(Boolean) as string[];

  function isAllowedOrigin(origin: string): boolean {
    if (allowedOrigins.includes(origin)) return true;
    // Preview deploys da Vercel (ex: app-studio-ester-rodrigues-git-....vercel.app)
    try {
      const host = new URL(origin).hostname;
      return (
        host.endsWith('.vercel.app') &&
        (host.startsWith('app-studio-ester') || host.startsWith('studio-ester'))
      );
    } catch {
      return false;
    }
  }

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permite requisições sem origin (ex: Postman, Railway health checks)
        // callback(null, false) em vez de Error — Error vira 500 sem headers CORS
        if (!origin || isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    })
  );
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Rotas
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
