import fs from "fs/promises";
import path from "path";
import { env } from "@/config/env";

export type AudioTranscriptionStatus =
  | "not_applicable"
  | "completed"
  | "failed";

export type AudioTranscriptionResult = {
  status: AudioTranscriptionStatus;
  text: string;
  error?: string;
  model?: string;
  language?: string;
  transcribedAt?: Date | null;
};

export type TranscribableAudioInput = {
  path: string;
  originalname?: string;
  filename?: string;
  mimetype?: string;
  size?: number;
};

export type ProjectFileTranscriptionFields = {
  transcriptionStatus: AudioTranscriptionStatus;
  transcriptionText: string;
  transcriptionError: string;
  transcriptionModel: string;
  transcriptionLanguage: string;
  transcribedAt: Date | null;
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".flac",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpga",
  ".m4a",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".webm",
]);

const TELEGRAM_AUDIO_KINDS = new Set(["voice", "audio"]);
const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 1024 * 1024 * 100;

export const isTranscribableAudioMeta = (input: {
  mimeType?: string;
  fileName?: string;
  kind?: string;
}): boolean => {
  const mimeType = String(input.mimeType || "").toLowerCase();
  const extension = path.extname(input.fileName || "").toLowerCase();
  const kind = String(input.kind || "").toLowerCase();

  return (
    TELEGRAM_AUDIO_KINDS.has(kind) ||
    mimeType.startsWith("audio/") ||
    mimeType === "video/webm" ||
    mimeType === "video/mp4" ||
    SUPPORTED_AUDIO_EXTENSIONS.has(extension)
  );
};

export const isTranscribableAudioFile = (
  file?: Express.Multer.File | null,
): boolean => {
  if (!file) return false;

  return isTranscribableAudioMeta({
    mimeType: file.mimetype,
    fileName: file.originalname || file.filename,
  });
};

const buildFailure = (error: string): AudioTranscriptionResult => ({
  status: "failed",
  text: "",
  error,
  model: env.openaiTranscriptionModel,
  language: env.openaiTranscriptionLanguage || undefined,
  transcribedAt: null,
});

const buildNotApplicable = (): AudioTranscriptionResult => ({
  status: "not_applicable",
  text: "",
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

export const toProjectFileTranscriptionFields = (
  result: AudioTranscriptionResult,
): ProjectFileTranscriptionFields => {
  return {
    transcriptionStatus: result.status,
    transcriptionText: result.text || "",
    transcriptionError: result.error || "",
    transcriptionModel: result.model || env.openaiTranscriptionModel || "",
    transcriptionLanguage:
      result.language || env.openaiTranscriptionLanguage || "",
    transcribedAt: result.transcribedAt || null,
  };
};

export const transcribeAudioPath = async (
  input?: TranscribableAudioInput | null,
): Promise<AudioTranscriptionResult> => {
  if (!input) return buildNotApplicable();

  const fileName =
    input.originalname || input.filename || path.basename(input.path);
  const mimeType = input.mimetype || "application/octet-stream";

  if (
    !isTranscribableAudioMeta({
      mimeType,
      fileName,
    })
  ) {
    return buildNotApplicable();
  }

  if (!env.openaiApiKey) {
    return buildFailure("OPENAI_API_KEY is not configured on the backend.");
  }

  const fileSize =
    typeof input.size === "number" && Number.isFinite(input.size) && input.size > 0
      ? input.size
      : (await fs.stat(input.path)).size;

  if (fileSize > MAX_TRANSCRIPTION_FILE_SIZE_BYTES) {
    return buildFailure(
      "Audio file is larger than the allowed transcription size.",
    );
  }

  try {
    const audioBuffer = await fs.readFile(input.path);
    const formData = new FormData();

    formData.append(
      "file",
      new Blob([audioBuffer as any], { type: mimeType }),
      fileName,
    );
    formData.append("model", env.openaiTranscriptionModel);
    formData.append("response_format", "json");

    if (env.openaiTranscriptionLanguage) {
      formData.append("language", env.openaiTranscriptionLanguage);
    }

    const response = await fetch(`${env.openaiBaseUrl}/audio/transcriptions`, {
      method: "POST",
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
      status: "completed",
      text: String(data.text || "").trim(),
      model: env.openaiTranscriptionModel,
      language: env.openaiTranscriptionLanguage || undefined,
      transcribedAt: new Date(),
    };
  } catch (error) {
    return buildFailure(
      error instanceof Error ? error.message : "Audio transcription failed.",
    );
  }
};

export const transcribeAudioFile = async (
  file?: Express.Multer.File | null,
): Promise<AudioTranscriptionResult> => {
  if (!file || !isTranscribableAudioFile(file)) {
    return buildNotApplicable();
  }

  return transcribeAudioPath({
    path: file.path,
    originalname: file.originalname,
    filename: file.filename,
    mimetype: file.mimetype,
    size: file.size,
  });
};
