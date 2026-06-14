import { Request, Response } from 'express';
import { sendDailyWorkAlert } from '@/modules/alerts/daily-work-alert.service';

type AuthRequest = Request & {
    user?: {
        role?: string;
    };
};

const isManager = (req: AuthRequest): boolean => {
    const role = String(req.user?.role || '').toLowerCase();

    return role === 'manager' || role === 'admin';
};

export const sendDailyWorkAlertNow = async (
    req: AuthRequest,
    res: Response,
): Promise<void> => {
    if (!isManager(req)) {
        res.status(403).json({
            success: false,
            message: 'شما دسترسی لازم برای ارسال گزارش مدیریتی را ندارید.',
            code: 'FORBIDDEN',
        });

        return;
    }

    const result = await sendDailyWorkAlert({ trigger: 'manual' });

    if (!result.sent) {
        res.status(400).json({
            success: false,
            message: result.reason || 'گزارش ارسال نشد.',
            code: 'TELEGRAM_ALERT_NOT_SENT',
        });

        return;
    }

    res.status(200).json({
        success: true,
        message: 'گزارش روزانه با موفقیت به تلگرام ارسال شد.',
        data: result,
    });
};