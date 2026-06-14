import { Request, Response } from 'express';
import { AuthenticatedRequest } from '@/modules/auth/auth.middleware';
import { buildDashboardSummary } from '@/modules/dashboard/dashboard.service';

export const getDashboardSummary = async (
    req: Request,
    res: Response,
): Promise<void> => {
    const data = await buildDashboardSummary(req as AuthenticatedRequest);

    res.status(200).json({
        success: true,
        message: 'اطلاعات داشبورد با موفقیت دریافت شد.',
        data,
    });
};