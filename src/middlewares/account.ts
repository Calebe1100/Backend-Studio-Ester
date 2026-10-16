import { Request, Response, NextFunction } from 'express';
import { loadLiveAccount } from '../services/professionalAccessService';

/**
 * Substitui o papel do JWT pelo papel gravado no banco e anexa a concessão vigente.
 * Assim conceder ou revogar vale na mesma requisição, sem esperar o token expirar.
 */
export async function attachLiveAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  const account = await loadLiveAccount(req.user.salonId, req.user.sub);
  if (!account?.active) {
    res.status(401).json({ error: 'Usuário inativo ou removido' });
    return;
  }

  req.user.role = account.role;
  req.account = account;
  next();
}
