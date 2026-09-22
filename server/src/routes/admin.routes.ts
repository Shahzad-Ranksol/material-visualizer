import { Router } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { adminLogin, listTenants, approveTenant, rejectTenant } from '../controllers/admin.controller.js';

export const adminRouter = Router();

adminRouter.post('/auth/login', adminLogin);
adminRouter.get('/tenants', requireAdminAuth, listTenants);
adminRouter.post('/tenants/:id/approve', requireAdminAuth, approveTenant);
adminRouter.post('/tenants/:id/reject', requireAdminAuth, rejectTenant);
