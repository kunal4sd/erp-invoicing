import { Router } from 'express';
import {
  getJournalEntriesHandler,
  getJournalEntryHandler,
  createGLAccountHandler,
  listGLAccountsHandler,
} from './gl.controller';

export const glRouter = Router();

glRouter.get('/', getJournalEntriesHandler);
glRouter.get('/:id', getJournalEntryHandler);

// GL Accounts sub-resource (mounted on /api/gl-accounts in app.ts)
export { createGLAccountHandler, listGLAccountsHandler };
