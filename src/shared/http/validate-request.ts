import { NextFunction, Request, Response } from 'express';
import Joi from 'joi';
import { AppError } from '@/shared/http/app-error';

interface RequestValidationSchema {
  body?: Joi.Schema;
  params?: Joi.Schema;
  query?: Joi.Schema;
}

function formatJoiErrors(error: Joi.ValidationError) {
  return error.details.map((detail) => ({
    path: detail.path.join('.'),
    message: detail.message,
  }));
}

export function validateRequest(schema: RequestValidationSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schema.params) {
        const { error, value } = schema.params.validate(req.params, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        });

        if (error) {
          throw new AppError(
            'پارامترهای درخواست معتبر نیستند.',
            400,
            'VALIDATION_ERROR',
            formatJoiErrors(error),
          );
        }

        req.params = value;
      }

      if (schema.query) {
        const { error, value } = schema.query.validate(req.query, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        });

        if (error) {
          throw new AppError(
            'پارامترهای جستجو معتبر نیستند.',
            400,
            'VALIDATION_ERROR',
            formatJoiErrors(error),
          );
        }

        Object.assign(req.query, value);
      }

      if (schema.body) {
        const { error, value } = schema.body.validate(req.body, {
          abortEarly: false,
          stripUnknown: true,
          convert: true,
        });

        if (error) {
          throw new AppError(
            'اطلاعات ارسالی معتبر نیستند.',
            400,
            'VALIDATION_ERROR',
            formatJoiErrors(error),
          );
        }

        req.body = value;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}