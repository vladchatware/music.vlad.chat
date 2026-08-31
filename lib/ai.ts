import { PRODUCTION_DJ_INSTRUCTIONS } from "./dj/agentInstructions";

const url = process.env.SITE_URL;

export const speech = async (text: string) => {
  const payload = await fetch(`${url}/api/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  return payload.blob();
};

export const ask = async (text: string) => {
  const payload = await fetch(`${url}/api/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  return payload.json();
};

export const transcribe = async (blob: Blob) => {
  const body = new FormData();
  body.append("file", blob, "file.webm");
  const payload = await fetch(`${url}/api/audio/transcriptions`, {
    method: "POST",
    body,
  });
  return payload.json();
};

// Kept as public alias for existing chat route and evaluation scripts.
export const systemMessage = PRODUCTION_DJ_INSTRUCTIONS;

export const DEFAULT_REVIBE_PROMPT =
  "Play hidden gems from my likes or similar tracks, matching frutiger aero.";
