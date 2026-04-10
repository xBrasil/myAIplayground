import { useCallback, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { useI18n } from '../lib/i18n';

const LANG_EXTENSIONS: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', java: 'java',
  csharp: 'cs', cpp: 'cpp', c: 'c', go: 'go', rust: 'rs',
  ruby: 'rb', php: 'php', swift: 'swift', kotlin: 'kt',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', yaml: 'yml', xml: 'xml', toml: 'toml',
  sql: 'sql', shell: 'sh', bash: 'sh', powershell: 'ps1',
  markdown: 'md', tex: 'tex', latex: 'tex', r: 'r',
  dockerfile: 'dockerfile', makefile: 'makefile',
};

function getExtension(language: string): string {
  return LANG_EXTENSIONS[language.toLowerCase()] || language.toLowerCase() || 'txt';
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  const handleDownload = useCallback(() => {
    const ext = getExtension(language);
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [code, language]);

  return (
    <div className="code-block-wrapper">
      <div className="code-block-toolbar">
        {language && <span className="code-block-lang">{language}</span>}
        <div className="code-block-actions">
          <button type="button" className="code-block-btn" onClick={() => void handleCopy()}>
            {copied ? t('codeBlock.copied') : t('codeBlock.copy')}
          </button>
          <button type="button" className="code-block-btn" onClick={handleDownload}>
            {t('codeBlock.download')}
          </button>
        </div>
      </div>
      <pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
    </div>
  );
}

interface MarkdownContentProps {
  content: string;
}

export default function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre({ children }) {
            // Extract code element from pre
            if (children && typeof children === 'object' && 'type' in (children as any)) {
              const child = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>;
              if (child.type === 'code') {
                const className = child.props.className || '';
                const lang = className.replace('language-', '');
                const code = String(child.props.children).replace(/\n$/, '');
                return <CodeBlock code={code} language={lang} />;
              }
            }
            return <pre>{children}</pre>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
