import { Router } from 'express';
import { asyncHandler } from '../lib/asyncHandler';
import * as clients from '../services/clientsService';

const router = Router();

/**
 * POST /api/public/clients/register
 * Body: { name, phone, email, password }
 * Cria conta de acesso (role=cliente) + perfil de cliente.
 */
router.post(
  '/clients/register',
  asyncHandler(async (req, res) => {
    const { client } = await clients.registerClientAccess(req.body ?? {});
    res.status(201).json({
      message: 'Conta criada com sucesso. Faça login para continuar.',
      client: {
        id: client.id,
        name: client.name,
        phone: client.phone,
        email: client.email,
      },
    });
  }),
);

export default router;
