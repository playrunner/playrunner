import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './verify-token';
import './auth.types'; // Ensure types are augmented

export const requireAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  let token = '';
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token && typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res
      .status(401)
      .json({ error: 'Missing token in Authorization header or query' });
    return;
  }

  try {
    const authUser = await verifyToken(token);
    req.authUser = authUser;
    next();
  } catch (error: any) {
    console.error('Token verification failed:', error.message);
    res.status(401).json({ error: 'Unauthorized', details: error.message });
  }
};
