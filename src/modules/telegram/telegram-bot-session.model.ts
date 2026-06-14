import mongoose, { Document, Model, Types } from 'mongoose';

export enum TelegramBotSessionStep {
    IDLE = 'idle',
    AWAITING_PROJECT = 'awaiting_project',
    AWAITING_DESCRIPTION = 'awaiting_description',
    AWAITING_ATTACHMENT = 'awaiting_attachment',
}

export interface TelegramBotSessionDocument extends Document {
    telegramUserId: string;
    telegramChatId: string;
    telegramUsername: string;
    linkedUserId: Types.ObjectId | null;
    step: TelegramBotSessionStep;
    selectedProjectId: Types.ObjectId | null;
    selectedProjectTitle: string;
    lastProjectNoteId: Types.ObjectId | null;
    pendingDescription: string;
    createdAt: Date;
    updatedAt: Date;
}

const telegramBotSessionSchema = new mongoose.Schema<TelegramBotSessionDocument>(
    {
        telegramUserId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        telegramChatId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },
        telegramUsername: {
            type: String,
            default: '',
            trim: true,
        },
        linkedUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },
        step: {
            type: String,
            enum: Object.values(TelegramBotSessionStep),
            default: TelegramBotSessionStep.IDLE,
            index: true,
        },
        selectedProjectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            default: null,
            index: true,
        },
        selectedProjectTitle: {
            type: String,
            default: '',
            trim: true,
        },
        lastProjectNoteId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ProjectProgressNote',
            default: null,
        },
        pendingDescription: {
            type: String,
            default: '',
            trim: true,
            maxlength: 3000,
        },
    },
    {
        timestamps: true,
    },
);

telegramBotSessionSchema.index(
    { telegramUserId: 1, telegramChatId: 1 },
    { unique: true },
);

export const TelegramBotSession =
    (mongoose.models.TelegramBotSession as Model<TelegramBotSessionDocument>) ||
    mongoose.model<TelegramBotSessionDocument>(
        'TelegramBotSession',
        telegramBotSessionSchema,
    );

export default TelegramBotSession;