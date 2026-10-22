import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
export default function ResponseMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown
        remarkPlugins={plugins}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, src }) => (
            <a href={src} target="_blank" rel="noopener noreferrer">
              {alt || 'Imagem'}
            </a>
          ),
          table: ({ children }) => (
            <div className="assistant-table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
