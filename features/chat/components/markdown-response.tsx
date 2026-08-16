import { Fragment, memo, useEffect, useMemo, useState } from "react";
import type { Root } from "hast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const REVEAL_INTERVAL_MS = 20;
const WORDS_PER_TICK = 2;

type RevealNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: RevealNode[];
};

function rehypeWordReveal() {
  return (tree: Root) => {
    let wordIndex = 0;

    const transformChildren = (parent: RevealNode) => {
      if (!parent.children) return;

      parent.children = parent.children.flatMap((child) => {
        if (child.type !== "text" || child.value === undefined) {
          if (child.tagName === "br" || child.tagName === "hr") {
            child.properties = {
              ...child.properties,
              dataRevealAtWord: wordIndex,
            };
          }

          transformChildren(child);
          return [child];
        }

        const parts = child.value.match(/\s*\S+|\s+$/g) ?? [];

        return parts.map<RevealNode>((part) => {
          if (/^\s+$/.test(part)) {
            return {
              type: "element",
              tagName: "span",
              properties: {
                dataWordIndex: wordIndex,
              },
              children: [{ type: "text", value: part }],
            };
          }

          const currentWordIndex = wordIndex;
          wordIndex += 1;

          return {
            type: "element",
            tagName: "span",
            properties: {
              dataWordIndex: currentWordIndex,
            },
            children: [{ type: "text", value: part }],
          };
        });
      });
    };

    transformChildren(tree as RevealNode);
  };
}

type MarkdownResponseProps = {
  content: string;
  onRevealComplete?: () => void;
};

function MarkdownResponseComponent({
  content,
  onRevealComplete,
}: MarkdownResponseProps) {
  const estimatedWordCount = useMemo(
    () => content.match(/\S+/g)?.length ?? 1,
    [content],
  );
  const [prefersReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [visibleWordCount, setVisibleWordCount] = useState(() =>
    prefersReducedMotion ? Number.MAX_SAFE_INTEGER : 1,
  );

  useEffect(() => {
    if (prefersReducedMotion) return;

    const interval = window.setInterval(() => {
      setVisibleWordCount((current) => {
        const next = current + WORDS_PER_TICK;

        if (next >= estimatedWordCount) {
          window.clearInterval(interval);
          return Number.MAX_SAFE_INTEGER;
        }

        return next;
      });
    }, REVEAL_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [estimatedWordCount, prefersReducedMotion]);

  useEffect(() => {
    if (visibleWordCount === Number.MAX_SAFE_INTEGER) {
      onRevealComplete?.();
    }
  }, [onRevealComplete, visibleWordCount]);

  return (
    <div className="response">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeWordReveal]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          br: ({ node }) => {
            const revealAtWord = node?.properties.dataRevealAtWord;

            if (
              typeof revealAtWord === "number" &&
              revealAtWord > visibleWordCount
            ) {
              return null;
            }

            return <br />;
          },
          hr: ({ node }) => {
            const revealAtWord = node?.properties.dataRevealAtWord;

            if (
              typeof revealAtWord === "number" &&
              revealAtWord > visibleWordCount
            ) {
              return null;
            }

            return <hr />;
          },
          span: ({ children, node }) => {
            const wordIndex = node?.properties.dataWordIndex;

            if (
              typeof wordIndex === "number" &&
              wordIndex >= visibleWordCount
            ) {
              return null;
            }

            return <Fragment>{children}</Fragment>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownResponse = memo(MarkdownResponseComponent);
