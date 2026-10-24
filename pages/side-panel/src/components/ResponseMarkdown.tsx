import { memo } from 'react';
import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];
// Module constants: a new `components` object per render made react-markdown re-parse the whole answer each time
const components: ComponentProps<typeof ReactMarkdown>['components'] = {
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
};

function ResponseMarkdown({ content }: { content: string }) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ResponseMarkdown);
