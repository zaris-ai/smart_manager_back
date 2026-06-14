import Joi from 'joi';

const usernameSchema = Joi.string()
    .trim()
    .lowercase()
    .min(3)
    .max(50)
    .required()
    .messages({
        'any.required': 'نام کاربری الزامی است.',
        'string.empty': 'نام کاربری الزامی است.',
        'string.min': 'نام کاربری باید حداقل ۳ کاراکتر باشد.',
        'string.max': 'نام کاربری نباید بیشتر از ۵۰ کاراکتر باشد.',
    });

export const loginSchema = {
    body: Joi.object({
        username: usernameSchema,

        password: Joi.string().min(8).max(128).required().messages({
            'any.required': 'رمز عبور الزامی است.',
            'string.empty': 'رمز عبور الزامی است.',
            'string.min': 'رمز عبور باید حداقل ۸ کاراکتر باشد.',
            'string.max': 'رمز عبور نباید بیشتر از ۱۲۸ کاراکتر باشد.',
        }),
    }),
};

export const refreshTokenSchema = {
    body: Joi.object({
        refreshToken: Joi.string().trim().required().messages({
            'any.required': 'توکن تمدید الزامی است.',
            'string.empty': 'توکن تمدید الزامی است.',
        }),
    }),
};

export const logoutSchema = {
    body: Joi.object({
        refreshToken: Joi.string().trim().required().messages({
            'any.required': 'توکن تمدید الزامی است.',
            'string.empty': 'توکن تمدید الزامی است.',
        }),
    }),
};