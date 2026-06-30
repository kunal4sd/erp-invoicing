import { Router } from 'express';
import { z } from 'zod';
import { ValidationError } from '../../shared/errors';
import { demoLogin } from './auth.service';

export const authRouter = Router();

const DemoLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.string().optional(),
});

authRouter.post('/demo-login', async (req, res) => {
  const parsed = DemoLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join('; '));
  }

  const result = await demoLogin({
    email: parsed.data.email.toLowerCase(),
    password: parsed.data.password,
    tenantId: parsed.data.tenantId,
  });

  res.json({ success: true, data: result });
});
