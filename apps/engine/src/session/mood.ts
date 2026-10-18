// The character's mood, derived from a handful of runtime inputs. Pure: the
// caller supplies `now` so expiry windows are testable.

export type Mood = "listening" | "thinking" | "building" | "speaking" | "curious" | "unsure" | "pleased";

export type MoodInputs = {
  buildInFlight: boolean;
  buildStreaming: boolean;
  speaking: boolean;
  lastSpeechWasQuestion: boolean;
  unsureUntil: number;
  pleasedUntil: number;
  addressedUntil: number;
};

export const NEUTRAL_MOOD_INPUTS: MoodInputs = {
  buildInFlight: false,
  buildStreaming: false,
  speaking: false,
  lastSpeechWasQuestion: false,
  unsureUntil: 0,
  pleasedUntil: 0,
  addressedUntil: 0,
};

// speaking > unsure > building > thinking > pleased > curious > listening
export function deriveMood(s: MoodInputs, now: number): Mood {
  if (s.speaking) return "speaking";
  if (now < s.unsureUntil) return "unsure";
  if (s.buildInFlight && s.buildStreaming) return "building";
  if (s.buildInFlight || now < s.addressedUntil) return "thinking";
  if (now < s.pleasedUntil) return "pleased";
  if (s.lastSpeechWasQuestion) return "curious";
  return "listening";
}
