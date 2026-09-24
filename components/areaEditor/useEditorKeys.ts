import { RefObject, useEffect, useRef } from 'react';

interface EditorKeyOptions {
  // The editor's root: Space inside it is always the pan shortcut
  rootRef: RefObject<HTMLElement | null>;
  undo: () => void;
  redo: () => void;
  hasPolygon: boolean;
  onPolygonBackspace: () => void;
  onPolygonCancel: () => void;
}

/**
 * The Area Editor's keyboard: Ctrl/Cmd+Z (Shift to redo), Backspace/Esc for polygon corners,
 * and Space held to pan. Returns a ref that is true while Space is held.
 */
export const useEditorKeys = ({ rootRef, undo, redo, hasPolygon, onPolygonBackspace, onPolygonCancel }: EditorKeyOptions) => {
  const spaceHeld = useRef(false);
  useEffect(() => {
    // Text entry only — a focused range/checkbox/radio/button input shouldn't swallow Ctrl/Cmd+Z
    const typing = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false;
      if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
      if (t.tagName === 'INPUT') {
        const type = (t as HTMLInputElement).type;
        return type !== 'range' && type !== 'checkbox' && type !== 'radio' && type !== 'button';
      }
      return false;
    };
    // Outside the editor, a focused button/select/input/textarea/contentEditable should still
    // receive Space (e.g. to activate a focused button elsewhere on the page).
    const interactive = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'BUTTON' || t.tagName === 'SELECT' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === ' ') {
        spaceHeld.current = true;
        // Inside the editor, Space is always the pan shortcut — even over a focused toolbar
        // button (which keeps focus after being clicked), so releasing it doesn't re-click that
        // button or discard an in-progress polygon. Outside the editor, don't steal Space from
        // whatever else on the page has focus.
        const insideEditor = rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target);
        if (insideEditor || !interactive(e.target)) e.preventDefault();
        return;
      }
      if (hasPolygon && e.key === 'Backspace') {
        e.preventDefault();
        onPolygonBackspace();
      }
      if (hasPolygon && e.key === 'Escape') {
        e.preventDefault();
        onPolygonCancel();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      spaceHeld.current = false;
      // Same rule as keydown: releasing Space over a focused toolbar button mustn't click it
      const insideEditor = rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target);
      if (insideEditor) e.preventDefault();
    };
    const onBlur = () => {
      spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [rootRef, undo, redo, hasPolygon, onPolygonBackspace, onPolygonCancel]);
  return spaceHeld;
};
