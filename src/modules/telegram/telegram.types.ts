export type TelegramInlineKeyboardButton = {
    text: string;
    callback_data?: string;
};

export type TelegramInlineKeyboardMarkup = {
    inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramReplyKeyboardButton = {
    text: string;
};

export type TelegramReplyKeyboardMarkup = {
    keyboard: Array<Array<TelegramReplyKeyboardButton | string>>;
    resize_keyboard?: boolean;
    one_time_keyboard?: boolean;
    is_persistent?: boolean;
    selective?: boolean;
};

export type TelegramReplyMarkup =
    | TelegramInlineKeyboardMarkup
    | TelegramReplyKeyboardMarkup;

export type TelegramSendMessageOptions = {
    parseMode?: 'HTML' | 'MarkdownV2';
    replyMarkup?: TelegramReplyMarkup;
    disableWebPagePreview?: boolean;
};

export type TelegramUserPayload = {
    id: number;
    is_bot?: boolean;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
};

export type TelegramChatPayload = {
    id: number;
    type: string;
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
};

export type TelegramPhotoSizePayload = {
    file_id: string;
    file_unique_id?: string;
    width?: number;
    height?: number;
    file_size?: number;
};

export type TelegramFileLikePayload = {
    file_id: string;
    file_unique_id?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    duration?: number;
};

export type TelegramMessagePayload = {
    message_id: number;
    from?: TelegramUserPayload;
    chat: TelegramChatPayload;
    date?: number;
    text?: string;
    caption?: string;
    voice?: TelegramFileLikePayload;
    audio?: TelegramFileLikePayload;
    document?: TelegramFileLikePayload;
    video?: TelegramFileLikePayload;
    photo?: TelegramPhotoSizePayload[];
};

export type TelegramCallbackQueryPayload = {
    id: string;
    from: TelegramUserPayload;
    message?: TelegramMessagePayload;
    data?: string;
};

export type TelegramUpdatePayload = {
    update_id: number;
    message?: TelegramMessagePayload;
    callback_query?: TelegramCallbackQueryPayload;
};

export type TelegramFileResponsePayload = {
    file_id: string;
    file_unique_id?: string;
    file_size?: number;
    file_path?: string;
};