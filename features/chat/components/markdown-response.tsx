import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const WORD_INTERVAL_MS = 36;

type RevealStyle = CSSProperties & { "--word-delay": string };

function revealChildren(
  children: ReactNode,
  counter: { current: number },
): ReactNode {
  if (typeof children === "string") {
    return children.split(/(\s+)/).map((part, index) => {
      if (!part || /^\s+$/.test(part)) return part;

      const delay = counter.current * WORD_INTERVAL_MS;
      counter.current += 1;

      return (
        <span
          className="word-reveal"
          style={{ "--word-delay": `${delay}ms` } as RevealStyle}
          key={`${counter.current}-${index}`}
        >
          {part}
        </span>
      );
    });
  }

  if (Array.isArray(children)) {
    return children.map((child) => revealChildren(child, counter));
  }

  return children;
}

export function MarkdownResponse({ content }: { content: string }) {
  const counter = { current: 0 };
  const reveal = (children: ReactNode) => revealChildren(children, counter);

  return (
    <div className="response">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {reveal(children)}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote>{reveal(children)}</blockquote>
          ),
          code: ({ children, className }) => (
            <code className={className}>{reveal(children)}</code>
          ),
          em: ({ children }) => <em>{reveal(children)}</em>,
          h1: ({ children }) => <h1>{reveal(children)}</h1>,
          h2: ({ children }) => <h2>{reveal(children)}</h2>,
          h3: ({ children }) => <h3>{reveal(children)}</h3>,
          h4: ({ children }) => <h4>{reveal(children)}</h4>,
          li: ({ children }) => <li>{reveal(children)}</li>,
          p: ({ children }) => <p>{reveal(children)}</p>,
          strong: ({ children }) => <strong>{reveal(children)}</strong>,
          td: ({ children }) => <td>{reveal(children)}</td>,
          th: ({ children }) => <th>{reveal(children)}</th>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
