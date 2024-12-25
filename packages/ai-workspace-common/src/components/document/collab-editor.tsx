import { useEffect, useMemo, useRef } from 'react';
import wordsCount from 'words-count';
import { useTranslation } from 'react-i18next';
import { CanvasNodeType } from '@refly/openapi-schema';
import {
  CollabEditorCommand,
  CollabGenAIMenuSwitch,
  CollabGenAIBlockMenu,
} from '@refly-packages/ai-workspace-common/components/editor/components/advanced-editor';
import {
  EditorRoot,
  EditorContent,
  EditorInstance,
} from '@refly-packages/ai-workspace-common/components/editor/core/components';

import {
  configureHighlightJs,
  ImageResizer,
  handleCommandNavigation,
} from '@refly-packages/ai-workspace-common/components/editor/core/extensions';
import {
  defaultExtensions,
  Placeholder,
} from '@refly-packages/ai-workspace-common/components/editor/components/extensions';
import { createUploadFn } from '@refly-packages/ai-workspace-common/components/editor/components/image-upload';
import { configureSlashCommand } from '@refly-packages/ai-workspace-common/components/editor/components/slash-command';
import Collaboration from '@tiptap/extension-collaboration';
import { useThrottledCallback } from 'use-debounce';
import { handleImageDrop, handleImagePaste } from '@refly-packages/ai-workspace-common/components/editor/core/plugins';
import { getHierarchicalIndexes, TableOfContents } from '@tiptap-pro/extension-table-of-contents';

import { getClientOrigin } from '@refly-packages/utils/url';
import { useDocumentStore, useDocumentStoreShallow } from '@refly-packages/ai-workspace-common/stores/document';
import '@refly-packages/ai-workspace-common/modules/content-selector/styles/content-selector.scss';
import classNames from 'classnames';
import { useContentSelectorStore } from '@refly-packages/ai-workspace-common/modules/content-selector/stores/content-selector';
import { useContextPanelStore } from '@refly-packages/ai-workspace-common/stores/context-panel';
import { genUniqueId } from '@refly-packages/utils/id';
import { useSelectionContext } from '@refly-packages/ai-workspace-common/modules/selection-menu/use-selection-context';
import { useDocumentContext } from '@refly-packages/ai-workspace-common/context/document';
import { useCanvasControl } from '@refly-packages/ai-workspace-common/hooks/use-canvas-control';
import { editorEmitter } from '@refly-packages/utils/event-emitter/editor';

export const CollaborativeEditor = ({ docId }: { docId: string }) => {
  const { t } = useTranslation();
  const lastCursorPosRef = useRef<number>();

  const { provider, ydoc } = useDocumentContext();

  const documentStore = useDocumentStoreShallow((state) => ({
    activeDocumentId: state.activeDocumentId,
    currentDocument: state.documentStates[docId]?.currentDocument,
    setHasEditorSelection: state.setHasEditorSelection,
    updateDocumentCharsCount: state.updateDocumentCharsCount,
    updateDocumentSaveStatus: state.updateDocumentSaveStatus,
    updateTocItems: state.updateTocItems,
    updateLastCursorPosRef: state.updateLastCursorPosRef,
    setActiveDocumentId: state.setActiveDocumentId,
  }));

  const contextPanelStore = useContextPanelStore((state) => ({
    updateBeforeSelectionNoteContent: state.updateBeforeSelectionNoteContent,
    updateAfterSelectionNoteContent: state.updateAfterSelectionNoteContent,
    updateCurrentSelectionContent: state.updateCurrentSelectionContent,
  }));

  const editorRef = useRef<EditorInstance>();

  const { showContentSelector, scope } = useContentSelectorStore((state) => ({
    showContentSelector: state.showContentSelector,
    scope: state.scope,
  }));

  const createPlaceholderExtension = () => {
    return Placeholder.configure({
      placeholder: ({ node }) => {
        const defaultPlaceholder = t('knowledgeBase.canvas.editor.placeholder.default', {
          defaultValue: "Write something, or press 'space' for AI, '/' for commands",
        });

        switch (node.type.name) {
          case 'heading':
            return t('editor.placeholder.heading', {
              level: node.attrs.level,
              defaultValue: `Heading ${node.attrs.level}`,
            });
          case 'paragraph':
            return defaultPlaceholder;
          case 'codeBlock':
          case 'orderedList':
          case 'bulletList':
          case 'listItem':
          case 'taskList':
          case 'taskItem':
            return '';
          default:
            return defaultPlaceholder;
        }
      },
      includeChildren: true,
    });
  };

  const { addToContext, selectedText } = useSelectionContext({
    containerClass: 'ai-note-editor-content-container',
  });

  const buildNodeData = (text: string) => {
    const { currentDocument } = useDocumentStore.getState().documentStates[docId];

    return {
      id: genUniqueId(),
      type: 'document' as CanvasNodeType,
      position: { x: 0, y: 0 },
      data: {
        entityId: currentDocument?.docId ?? '',
        title: currentDocument?.title ?? 'Selected Content',
        metadata: {
          contentPreview: text,
          selectedContent: text,
          xPath: genUniqueId(),
          sourceEntityId: currentDocument?.docId ?? '',
          sourceEntityType: 'document',
          sourceType: 'documentSelection',
          url: getClientOrigin(),
        },
      },
    };
  };

  const handleAddToContext = (text: string) => {
    const node = buildNodeData(text);

    addToContext(node);
  };

  const uploadFn = useMemo(() => createUploadFn({ entityId: docId, entityType: 'document' }), [docId]);

  const extensions = useMemo(
    () => [
      ...defaultExtensions,
      configureSlashCommand({
        entityId: docId,
        entityType: 'document',
      }),
      createPlaceholderExtension(),
      Collaboration.configure({
        document: ydoc,
      }),
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        onUpdate(content) {
          documentStore.updateTocItems(docId, content);
        },
      }),
    ],
    [ydoc, docId],
  );

  // Apply Codeblock Highlighting on the HTML from editor.getHTML()
  const highlightCodeblocks = async (content: string) => {
    const hljs = await configureHighlightJs();
    const doc = new DOMParser().parseFromString(content, 'text/html');
    doc.querySelectorAll('pre code').forEach((el) => {
      // @ts-ignore
      // https://highlightjs.readthedocs.io/en/latest/api.html?highlight=highlightElement#highlightelement
      hljs.highlightElement(el);
    });
    return new XMLSerializer().serializeToString(doc);
  };

  const { setNodeDataByEntity } = useCanvasControl();

  const debouncedUpdates = useThrottledCallback(async (editor: EditorInstance) => {
    if (provider.status !== 'connected') {
      console.log('document server is not connected, skip update node data');
      return;
    }

    const markdown = editor.storage.markdown.getMarkdown();

    setNodeDataByEntity(
      {
        entityId: docId,
        type: 'document',
      },
      {
        contentPreview: markdown?.slice(0, 1000),
      },
    );

    documentStore.updateDocumentCharsCount(docId, wordsCount(markdown));
    documentStore.updateDocumentSaveStatus(docId, 'Saved');
  }, 100);

  useEffect(() => {
    return () => {
      editorRef.current?.destroy();
    };
  }, [docId]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }
    const editor = editorRef.current;

    const updateSelection = () => {
      const { state } = editor.view;
      const { from, to } = state.selection;
      documentStore.setHasEditorSelection(from !== to);
    };

    // Update initial state
    updateSelection();

    // Listen for selection changes
    editor.on('selectionUpdate', updateSelection);
    editor.on('blur', updateSelection);
    editor.on('focus', updateSelection);

    return () => {
      editor.off('selectionUpdate', updateSelection);
      editor.off('blur', updateSelection);
      editor.off('focus', updateSelection);
    };
  }, [editorRef.current]);

  const readOnly = documentStore?.currentDocument?.readOnly ?? false;

  useEffect(() => {
    if (editorRef.current && !readOnly) {
      const editor = editorRef.current;

      editor.on('blur', () => {
        lastCursorPosRef.current = editor?.view?.state?.selection?.$head?.pos;

        const { state } = editor?.view || {};
        const { selection } = state || {};
        const { doc } = editor?.state || {};
        const { from, to } = selection || {};

        const getMarkdownSlice = (start: number, end: number) => {
          const slice = doc.slice(start, end);
          return editor.storage.markdown.serializer.serialize(slice.content);
        };

        const prevSelectionContent = getMarkdownSlice(0, from);
        const afterSelectionContent = getMarkdownSlice(to, editor?.state?.doc?.content?.size);
        const selectedContent = getMarkdownSlice(from, to);

        documentStore.updateLastCursorPosRef(docId, lastCursorPosRef.current);
        contextPanelStore.updateCurrentSelectionContent(selectedContent);
        contextPanelStore.updateBeforeSelectionNoteContent(prevSelectionContent);
        contextPanelStore.updateAfterSelectionNoteContent(afterSelectionContent);
      });
    }
  }, [editorRef.current, readOnly]);

  useEffect(() => {
    const insertBelow = (content: string) => {
      const editor = editorRef.current;
      if (!editor) {
        console.warn('editor is not initialized');
        return;
      }

      const isFocused = editor.isFocused;
      const { activeDocumentId } = useDocumentStore.getState();

      if (activeDocumentId !== docId) {
        return;
      }

      if (isFocused) {
        // Insert at current cursor position when focused
        lastCursorPosRef.current = editor?.view?.state?.selection?.$head?.pos;
        editor?.commands?.insertContentAt?.(lastCursorPosRef.current, content);
      } else if (lastCursorPosRef.current) {
        // Insert at last known cursor position
        editor
          ?.chain()
          .focus(lastCursorPosRef.current)
          .insertContentAt(
            {
              from: lastCursorPosRef.current,
              to: lastCursorPosRef.current,
            },
            content,
          )
          .run();
      } else {
        // Insert at the bottom of the document
        const docSize = editor?.state?.doc?.content?.size ?? 0;
        editor?.chain().focus(docSize).insertContentAt(docSize, content).run();
      }
    };

    editorEmitter.on('insertBelow', insertBelow);

    return () => {
      editorEmitter.off('insertBelow', insertBelow);
      documentStore.setActiveDocumentId(null);
    };
  }, []);

  useEffect(() => {
    if (editorRef.current) {
      const editor = editorRef.current;

      if (readOnly) {
        // ensure we sync the content just before setting the editor to readonly
        provider.forceSync();
      }
      editor.setOptions({ editable: !readOnly });
    }
  }, [editorRef.current, readOnly]);

  // Handle editor focus/blur to manage active document
  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const editor = editorRef.current;

    const handleFocus = () => {
      documentStore.setActiveDocumentId(docId);
    };

    const handleBlur = () => {
      // Don't clear activeDocumentId on blur to maintain last active state
      // Only update if user switches to another document
    };

    editor.on('focus', handleFocus);
    editor.on('blur', handleBlur);

    // Set initial active document if editor is focused
    if (editor.isFocused) {
      documentStore.setActiveDocumentId(docId);
    }

    return () => {
      editor.off('focus', handleFocus);
      editor.off('blur', handleBlur);
    };
  }, [docId, documentStore.setActiveDocumentId, editorRef.current, readOnly]);

  // Handle component unmount
  useEffect(() => {
    return () => {
      // Only clear activeDocumentId if this document was the active one
      useDocumentStore.getState().activeDocumentId === docId && documentStore.setActiveDocumentId(undefined);
    };
  }, [docId]);

  return (
    <div
      className={classNames('w-full', 'ai-note-editor-content-container', {
        'refly-selector-mode-active': showContentSelector,
        'refly-block-selector-mode': scope === 'block',
        'refly-inline-selector-mode': scope === 'inline',
      })}
    >
      <div className="w-full h-full">
        <EditorRoot>
          <EditorContent
            extensions={extensions}
            onCreate={({ editor }) => {
              editorRef.current = editor;
              documentStore.setActiveDocumentId(docId);
            }}
            editable={!readOnly}
            className="w-full h-full border-muted sm:rounded-lg"
            editorProps={{
              handleDOMEvents: {
                keydown: (_view, event) => handleCommandNavigation(event),
              },
              handlePaste: (view, event) => handleImagePaste(view, event, uploadFn),
              handleDrop: (view, event, _slice, moved) => handleImageDrop(view, event, moved, uploadFn),
              attributes: {
                class: 'prose prose-md prose-headings:font-title font-default focus:outline-none max-w-full',
                'data-doc-id': docId,
              },
            }}
            onUpdate={({ editor }) => {
              debouncedUpdates(editor);
              documentStore.updateDocumentSaveStatus(docId, 'Unsaved');
            }}
            slotAfter={<ImageResizer />}
          >
            <CollabEditorCommand entityId={docId} entityType="document" />
            <CollabGenAIMenuSwitch
              contentSelector={{
                text: t('knowledgeBase.context.addToContext'),
                handleClick: () => handleAddToContext(selectedText),
              }}
            />
            <CollabGenAIBlockMenu />
          </EditorContent>
        </EditorRoot>
      </div>
    </div>
  );
};
