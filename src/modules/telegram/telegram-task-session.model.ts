import { Schema, model, Document, Types } from 'mongoose';

export type TelegramTaskSessionStep =
    | 'select_project'
    | 'select_manager'
    | 'enter_task'
    | 'optional_file';

export type TelegramTaskSessionDocument = Document & {
    chatId: string;
    telegramUserId?: string;
    actorUserId: Types.ObjectId;
    step: TelegramTaskSessionStep;
    selectedProjectId?: Types.ObjectId;
    selectedManagerId?: Types.ObjectId;
    taskTitle?: string;
    taskDescription?: string;
    createdAt: Date;
    updatedAt: Date;
};

const telegramTaskSessionSchema = new Schema<TelegramTaskSessionDocument>(
    {
        chatId: {
            type: String,
            required: true,
            index: true,
        },
        telegramUserId: {
            type: String,
            index: true,
        },
        actorUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        step: {
            type: String,
            enum: ['select_project', 'select_manager', 'enter_task', 'optional_file'],
            required: true,
        },
        selectedProjectId: {
            type: Schema.Types.ObjectId,
            ref: 'Project',
        },
        selectedManagerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        taskTitle: {
            type: String,
            trim: true,
        },
        taskDescription: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    },
);

telegramTaskSessionSchema.index({ chatId: 1, actorUserId: 1 }, { unique: true });

const TelegramTaskSession = model<TelegramTaskSessionDocument>(
    'TelegramTaskSession',
    telegramTaskSessionSchema,
);

export default TelegramTaskSession;