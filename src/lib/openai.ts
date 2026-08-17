import OpenAI from "openai";

let client: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  client ??= new OpenAI();

  return client;
}
