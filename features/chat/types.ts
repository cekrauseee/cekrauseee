export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatActionResult =
  | {
      ok: true;
      message: ChatMessage;
    }
  | {
      ok: false;
      error: string;
    };
