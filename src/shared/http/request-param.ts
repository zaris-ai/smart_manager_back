import { Request } from 'express';
import { AppError } from '@/shared/http/app-error';

export function getRequiredStringParam(req: Request, name: string): string {
    const value = req.params[name];

    if (Array.isArray(value)) {
        if (value.length === 1 && typeof value[0] === 'string' && value[0].trim()) {
            return value[0];
        }

        throw new AppError(
            `پارامتر ${name} معتبر نیست.`,
            400,
            'INVALID_ROUTE_PARAM',
        );
    }

    if (typeof value !== 'string' || !value.trim()) {
        throw new AppError(
            `پارامتر ${name} الزامی است.`,
            400,
            'MISSING_ROUTE_PARAM',
        );
    }

    return value;
}