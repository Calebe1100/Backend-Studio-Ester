import { Request, Response, NextFunction, RequestHandler } from 'express';
import { isHttpError } from './httpError';

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<void>;

/** Encapsula handlers async e mapeia HttpError para JSON. */
export function asyncHandler(fn: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch((err: unknown) => {
      if (isHttpError(err)) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      next(err);
    });
  };
}
