import fs from 'fs/promises';
import path from 'path';
import { env } from '@/config/env';

export type AudioTranscriptionStatus =
  | 'not_applicable'
  | 'completed'
  | 'failed';

export type AudioTranscriptionResult = {
  status: AudioTranscriptionStatus;
  text: string;
  error?: string;
  model?: string;
  language?: string;
  transcribedAt?: Date | null;
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  '.flac',
  '.mp3',
  '.mp4',
  '.mpeg',
  '.mpga',
  '.m4a',
  '.ogg',
  '.wav',
  '.webm',
]);

const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 1024 * 1024 * 100;

const getFileExtension = (file: Express.Multer.File): string => {
  return path.extname(file.originalname || file.filename || '').toLowerCase();
};

export const isTranscribableAudioFile = (file?: Express.Multer.File | null): boolean => {
  if (!file) return false;

  const mimeType = String(file.mimetype || '').toLowerCase();
  const extension = getFileExtension(file);

  return (
    mimeType.startsWith('audio/') ||
    mimeType === 'video/webm' ||
    mimeType === 'video/mp4' ||
    SUPPORTED_AUDIO_EXTENSIONS.has(extension)
  );
};

const buildFailure = (error: string): AudioTranscriptionResult => ({
  status: 'failed',
  text: '',
  error,
  model: env.openaiTranscriptionModel,
  language: env.openaiTranscriptionLanguage || undefined,
  transcribedAt: null,
});

const readErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `OpenAI transcription request failed with status ${response.status}.`;

  try {
    const data = (await response.json()) as {
      error?: {
        message?: string;
      };
      message?: string;
    };

    return data?.error?.message || data?.message || fallback;
  } catch {
    try {
      const text = await response.text();
      return text || fallback;
    } catch {
      return fallback;
    }
  }
};

export const transcribeAudioFile = async (
  file?: Express.Multer.File | null,
): Promise<AudioTranscriptionResult> => {
  if (!file || !isTranscribableAudioFile(file)) {
    return {
      status: 'not_applicable',
      text: '',
      model: env.openaiTranscriptionModel,
      language: env.openaiTranscriptionLanguage || undefined,
      transcribedAt: null,
    };
  }

  if (!env.openaiApiKey) {
    return buildFailure('OPENAI_API_KEY is not configured on the backend.');
  }

  if (file.size > MAX_TRANSCRIPTION_FILE_SIZE_BYTES) {
    return buildFailure('Audio file is larger than the allowed transcription size.');
  }

  try {
    const audioBuffer = await fs.readFile(file.path);
    const fileName = file.originalname || file.filename || 'audio.webm';
    const mimeType = file.mimetype || 'application/octet-stream';
    const formData = new FormData();

    formData.append(
      'file',
      new Blob([audioBuffer as any], { type: mimeType }),
      fileName,
    );
    formData.append('model', env.openaiTranscriptionModel);
    formData.append('response_format', 'json');

    if (env.openaiTranscriptionLanguage) {
      formData.append('language', env.openaiTranscriptionLanguage);
    }

    const response = await fetch(`${env.openaiBaseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      return buildFailure(await readErrorMessage(response));
    }

    const data = (await response.json()) as {
      text?: string;
    };

    return {
      status: 'completed',
      text: String(data.text || '').trim(),
      model: env.openaiTranscriptionModel,
      language: env.openaiTranscriptionLanguage || undefined,
      transcribedAt: new Date(),
    };
  } catch (error) {
    return buildFailure(
      error instanceof Error ? error.message : 'Audio transcription failed.',
    );
  }
};
