import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import protectedRoutes from './routes/protected';

export function createApp() {
  const app = express();

  const allowedOrigins = [
    process.env.FRONTEND_URL,   // ex: https://ana-ester.vercel.app
    'http://localhost:3000',
  ].filter(Boolean) as string[];

  app.use(
    cors({
      origin: (origin, callback) => {
        // Permite requisições sem origin (ex: Postman, Railway health checks)
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS: origin não permitida — ${origin}`));
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
