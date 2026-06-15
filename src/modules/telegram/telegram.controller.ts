import { Request, Response } from 'express';
import { telegramTaskRegistrationService } from './telegram-task-registration.service';

export const telegramController = {
    async webhook(req: Request, res: Response) {
        await telegramTaskRegistrationService.handleUpdate(req.body);

        return res.json({
            success: true,
        });
    },
};