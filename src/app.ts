import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import protectedRoutes from './routes/protected';

export function createApp() {
  const app = express();

  // FRONTEND_URL pode ser uma URL ou várias separadas por vírgula
  const allowedOrigins = [
    ...(process.env.FRONTEND_URL ?? '').split(',').map((s) => s.trim()),
    'https://app-studio-ester-rodrigues.vercel.app',
    'https://app-studio-ester.vercel.app',
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permite requisições sem origin (ex: Postman, Railway health checks)
        // callback(null, false) em vez de Error — Error vira 500 sem headers CORS
        if (!origin || allowedOrigins.includes(origin)) {
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
  app.use('/api', protectedRoutes);

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
