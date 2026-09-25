import { Router, Request, Response } from 'express';
import {
  login,
  refresh,
  logout,
  createPasswordResetCode,
  verifyPasswordResetCode,
  resetPassword,
} from '../services/authService';
import { OTP_TTL_MINUTES, sendPasswordResetCode } from '../lib/otp';
import { isValidBrPhone } from '../lib/phone';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { identifier?: string, email?: string, phone?: string, password: string }
 * `identifier` aceita e-mail ou telefone. `email` e `phone` seguem aceitos.
 * Response: { accessToken, refreshToken, expiresIn, user }
 */
router.post('/login', async (req: Request, res: Response) => {
  const body = req.body ?? {};
  const identifier = String(body.identifier ?? body.email ?? body.phone ?? '').trim();
  const password = body.password;

  if (!identifier || !password) {
    res.status(400).json({ error: 'E-mail ou telefone e senha são obrigatórios' });
    return;
  }

  if (!identifier.includes('@') && !isValidBrPhone(identifier)) {
    res.status(400).json({ error: 'Informe um e-mail ou telefone válido.' });
    return;
  }

  try {
    const result = await login(identifier, password);
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
 * Body: { phone: string }
 * Envia um código de 6 dígitos por WhatsApp (com fallback por SMS).
 * Response: 200 (sempre, sem revelar se o celular existe)
 */
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { phone } = req.body ?? {};

  if (!phone) {
    res.status(400).json({ error: 'Celular é obrigatório' });
    return;
  }

  // Resposta sempre igual para não revelar se o celular está cadastrado
  const genericResponse = {
    message: 'Se o celular estiver cadastrado, você receberá um código em instantes.',
    expiresInMinutes: OTP_TTL_MINUTES,
  };

  try {
    const result = await createPasswordResetCode(phone);
    if (result) {
      await sendPasswordResetCode(phone, result.code);
    }
    res.status(200).json(genericResponse);
  } catch (err) {
    console.error('[auth] Falha ao enviar código de recuperação:', err);
    res.status(200).json(genericResponse);
  }
});

/**
 * POST /api/auth/verify-reset-code
 * Body: { phone: string, code: string }
 * Response: { resetToken, expiresIn } — usado no POST /reset-password
 */
router.post('/verify-reset-code', async (req: Request, res: Response) => {
  const { phone, code } = req.body ?? {};

  if (!phone || !code) {
    res.status(400).json({ error: 'Celular e código são obrigatórios' });
    return;
  }

  try {
    const result = await verifyPasswordResetCode(phone, code);
    res.status(200).json(result);
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message: string };
    res.status(e.statusCode ?? 500).json({ error: e.message });
  }
});

/**
 * POST /api/auth/reset-password
 * Body: { token: string, password: string }
 */
router.post('/reset-password', async (req: Request, res: Response) => {
  const { token, password } = req.body ?? {};

  if (!token || !password) {
    res.status(400).json({ error: 'Token e nova senha são obrigatórios' });
    return;
  }

  try {
    await resetPassword(token, password);
    res.status(200).json({ message: 'Senha atualizada com sucesso.' });
  } catch (err: unknown) {
    const e = err as { statusCode?: number; message: string };
    res.status(e.statusCode ?? 500).json({ error: e.message });
  }
});

export default router;
