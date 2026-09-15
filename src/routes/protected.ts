/**
 * Rotas de exemplo para demonstrar proteção por JWT e papel.
 * As rotas reais (profissionais, clientes, serviços, agenda) seguirão este padrão.
 */
import { Router, Request, Response } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth';

const router = Router();

/** GET /api/me — retorna dados do usuário autenticado */
router.get('/me', verifyToken, (req: Request, res: Response) => {
  res.json({ user: req.user });
});

/** GET /api/dashboard — apenas dono */
router.get('/dashboard', verifyToken, requireRole('dono'), (req: Request, res: Response) => {
  res.json({ message: 'Dashboard do backoffice', user: req.user });
});

/** GET /api/agenda — dono, recepção e profissional */
router.get(
  '/agenda',
  verifyToken,
  requireRole('dono', 'recepcao', 'profissional'),
  (req: Request, res: Response) => {
    res.json({ message: 'Agenda do dia', user: req.user });
  }
);

export default router;
