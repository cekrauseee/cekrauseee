"use server";

import { getOpenAIClient } from "@/lib/openai";

import type { ChatActionResult, ChatMessage } from "./types";

const SYSTEM_INSTRUCTIONS =
  "Reply helpfully in the language of the user's latest message.";

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const messages: ChatMessage[] = [];

  for (const valueMessage of value) {
    if (
      typeof valueMessage !== "object" ||
      valueMessage === null ||
      !("role" in valueMessage) ||
      !("content" in valueMessage) ||
      (valueMessage.role !== "user" && valueMessage.role !== "assistant") ||
      typeof valueMessage.content !== "string"
    ) {
      return null;
    }

    messages.push({
      role: valueMessage.role,
      content: valueMessage.content,
    });
  }

  if (messages.at(-1)?.role !== "user") {
    return null;
  }

  return messages;
}

export async function sendMessage(
  messages: ChatMessage[],
): Promise<ChatActionResult> {
  const validatedMessages = parseMessages(messages);

  if (!validatedMessages) {
    return {
      ok: false,
      error: "The conversation is invalid.",
    };
  }

  try {
    const response = await getOpenAIClient().responses.create({
      model: "gpt-5.6-luna",
      instructions: SYSTEM_INSTRUCTIONS,
      input: validatedMessages,
      reasoning: { effort: "none" },
      store: false,
      stream: false,
      tools: [],
    });

    if (!response.output_text.trim()) {
      return {
        ok: false,
        error: "No response was generated. Please try again.",
      };
    }

    return {
      ok: true,
      message: {
        role: "assistant",
        content: response.output_text,
      },
    };
  } catch {
    return {
      ok: false,
      error: "Unable to send the message right now. Please try again.",
    };
  }
}
