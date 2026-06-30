import { prisma } from '../../config/database';
import { ForbiddenError, UnauthorizedError, ValidationError } from '../../shared/errors';
import { signToken } from './jwt';

const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD ?? 'demo';

export interface DemoLoginDto {
  email: string;
  password: string;
  tenantId?: string;
}

export async function demoLogin(dto: DemoLoginDto) {
  if (!dto.email?.trim()) throw new ValidationError('Email is required');
  if (!dto.password) throw new ValidationError('Password is required');

  if (dto.password !== DEMO_PASSWORD) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const user = await prisma.user.findFirst({
    where: {
      email: dto.email.trim().toLowerCase(),
      isActive: true,
      ...(dto.tenantId ? { tenantId: dto.tenantId } : {}),
    },
    include: { tenant: { select: { id: true, name: true, isActive: true } } },
  });

  if (!user) throw new UnauthorizedError('Invalid email or password');
  if (!user.tenant.isActive) throw new ForbiddenError('Tenant is inactive');

  const token = signToken({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
    },
  };
}
