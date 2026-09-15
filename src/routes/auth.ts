import { Router, Request, Response } from 'express';
import { login, refresh, logout, createPasswordResetToken } from '../services/authService';
import { sendPasswordResetEmail } from '../lib/mailer';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email: string, password: string }
 * Response: { accessToken, refreshToken, expiresIn, user }
 */
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    res.status(400).json({ error: 'E-mail e senha são obrigatórios' });
    return;
  }

  try {
    const result = await login(email, password);
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message: string };
    res.status(e.statusCode ?? 500).json({ error: e.message });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken: string }
 * Response: { accessToken, refreshToken, expiresIn }
 */
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body ?? {};

  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken é obrigatório' });
    return;
  }

  try {
    const result = await refresh(refreshToken);
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message: string; name?: string };
    const status = e.statusCode ?? (e.name === 'TokenExpiredError' ? 401 : 500);
    res.status(status).json({ error: e.message });
  }
});

/**
 * POST /api/auth/logout
 * Body: { refreshToken: string }
 * Response: 204 No Content
 */
router.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken } = req.body ?? {};

  if (!refreshToken) {
    res.status(400).json({ error: 'refreshToken é obrigatório' });
    return;
  }

  try {
    await logout(refreshToken);
    res.status(204).send();
  } catch {
    res.status(204).send(); // Logout é idempotente
  }
});

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 * Response: 200 (sempre, sem revelar se e-mail existe)
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body ?? {};

  if (!email) {
    res.status(400).json({ error: 'E-mail é obrigatório' });
    return;
  }

  try {
    const result = await createPasswordResetToken(email);
    if (result) {
      await sendPasswordResetEmail(email, result.token);
    }
    // Resposta sempre igual para não revelar se o e-mail existe
    res.status(200).json({ message: 'Se o e-mail existir, você receberá as instruções.' });
  } catch {
    res.status(200).json({ message: 'Se o e-mail existir, você receberá as instruções.' });
  }
});

export default router;
