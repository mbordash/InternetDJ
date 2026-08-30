import React, { useMemo, useState } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';

/**
 * The body field for writing and editing articles.
 *
 * Same editor the forum uses, so there is one thing to learn on the site rather
 * than two, but configured for articles: the toolbar offers headings, which a
 * forum post has no use for.
 *
 * The toolbar deliberately offers exactly what survives sanitizeArticleHtml in
 * backend/utils/articleHtml.js and nothing more. A button whose output the
 * server strips on save is worse than a missing button, because the writer sees
 * their formatting apply, saves, and finds it gone with no explanation.
 *
 * That is also why there is no image button. Quill inserts a pasted or uploaded
 * image as a base64 data: URI, and the sanitiser allows only http and https on
 * an img, so every inline image would vanish on save. Article artwork goes
 * through the artwork field instead. Existing images are kept - 'image' is in
 * the formats list even though it is not on the toolbar - so opening one of the
 * 763 archive articles that has pictures in the body does not strip them.
 */

const TOOLBAR = [
    [{ header: [2, 3, 4, false] }],
    ['bold', 'italic', 'underline'],
    ['blockquote', 'code-block'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['link'],
    ['clean'],
];

// 'image' and 'code' have no toolbar button but are listed so that markup
// already in an article is preserved rather than flattened on load.
const FORMATS = [
    'header', 'bold', 'italic', 'underline', 'blockquote',
    'code-block', 'code', 'list', 'bullet', 'link', 'image',
];

/**
 * Markup the sanitiser keeps but Quill cannot represent.
 *
 * This is the whole reason the HTML mode exists. Quill rebuilds a document from
 * the formats it knows, so anything it cannot model is dropped the moment the
 * editor loads - silently, before the writer has typed anything. 216 of the
 * archive articles use a horizontal rule as a section break, and opening one in
 * the visual editor and pressing save would quietly delete it.
 *
 * So a document containing any of these opens in HTML mode instead, with a note
 * saying why. Switching to visual editing is still offered, because sometimes
 * losing a rule is an acceptable price for not hand-editing markup, but it is
 * now a choice rather than an accident.
 */
const RICH_UNSAFE = /<\s*(hr|figure|figcaption)\b/i;

const QUILL_EMPTY = /^\s*(<p>(\s|<br\s*\/?>|&nbsp;)*<\/p>\s*)+$/i;

const ArticleBodyEditor = ({
    value,
    onChange,
    placeholder,
    minHeightClass = 'min-h-[24rem]',
    label = 'Article body',
    id,
}) => {
    const unsafeForRich = useMemo(() => RICH_UNSAFE.test(value || ''), [value]);
    // Evaluated once per mounted document. Parents give this component a `key`
    // tied to the article so that selecting a different one re-decides rather
    // than carrying the previous article's mode across.
    const [mode, setMode] = useState(unsafeForRich ? 'html' : 'rich');
    const [dismissed, setDismissed] = useState(false);

    const modules = useMemo(() => ({ toolbar: TOOLBAR }), []);

    const handleRichChange = (html) => {
        // Quill represents an empty document as <p><br></p>. Passed straight
        // through, that is a non-empty string, so a required check passes and
        // the article saves with a paragraph of nothing in it.
        onChange(QUILL_EMPTY.test(html) ? '' : html);
    };

    return (
        // A group rather than a plain div, and named, because the thing being
        // labelled is a contenteditable with a toolbar rather than a form
        // control. A <label> around this would have nothing to point at: labels
        // forward their click to the first labelable element inside them, and
        // there is not one here.
        <div role="group" aria-label={label}>
            <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                    type="button"
                    onClick={() => setMode('rich')}
                    className={`retro-btn px-4 py-1.5 text-xs ${mode === 'rich' ? 'retro-btn--hot' : ''}`}
                >
                    Visual
                </button>
                <button
                    type="button"
                    onClick={() => setMode('html')}
                    className={`retro-btn px-4 py-1.5 text-xs ${mode === 'html' ? 'retro-btn--hot' : ''}`}
                >
                    HTML
                </button>
            </div>

            {unsafeForRich && !dismissed && (
                <p className="retro-mono text-lg text-amber-300 mb-2">
                    &gt; This one uses a horizontal rule or a figure, which the visual editor
                    cannot keep. Editing as HTML so nothing is lost.{' '}
                    <button
                        type="button"
                        onClick={() => { setDismissed(true); setMode('rich'); }}
                        className="text-cyan-300 underline"
                    >
                        Use the visual editor anyway
                    </button>
                </p>
            )}

            {mode === 'rich' ? (
                <div className={`retro-quill ${minHeightClass}`}>
                    <ReactQuill
                        id={id}
                        theme="snow"
                        value={value || ''}
                        onChange={handleRichChange}
                        modules={modules}
                        formats={FORMATS}
                        placeholder={placeholder}
                    />
                </div>
            ) : (
                <textarea
                    id={id}
                    className={`retro-input w-full px-3 py-2 font-mono ${minHeightClass}`}
                    value={value || ''}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                />
            )}
        </div>
    );
};

export default ArticleBodyEditor;
