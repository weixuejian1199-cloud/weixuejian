/**
 * useTypewriter — 打字机效果 hook
 *
 * 当 target 文本更新时，逐字显示内容（每字约 20ms）
 * 如果新内容比当前显示内容短（说明是新消息），立即重置
 */

import { useState, useEffect, useRef } from "react";

interface UseTypewriterOptions {
  /** 每个字符的延迟（ms），默认 20 */
  charDelay?: number;
  /** 是否启用打字机效果，默认 true */
  enabled?: boolean;
}

export function useTypewriter(
  target: string,
  { charDelay = 20, enabled = true }: UseTypewriterOptions = {}
) {
  const [displayed, setDisplayed] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const targetRef = useRef(target);
  const indexRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      setDisplayed(target);
      return;
    }

    // If target changed to something shorter or completely different, reset
    if (!target.startsWith(targetRef.current) || target.length < targetRef.current.length) {
      // New message — reset and start fresh
      if (timerRef.current) clearTimeout(timerRef.current);
      targetRef.current = target;
      indexRef.current = 0;
      setDisplayed("");
    }

    targetRef.current = target;

    if (target.length === 0) {
      setDisplayed("");
      setIsTyping(false);
      indexRef.current = 0;
      return;
    }

    // If we're already at the end, nothing to do
    if (indexRef.current >= target.length) {
      setDisplayed(target);
      setIsTyping(false);
      return;
    }

    setIsTyping(true);

    const tick = () => {
      const current = targetRef.current;
      if (indexRef.current < current.length) {
        indexRef.current += 1;
        setDisplayed(current.slice(0, indexRef.current));
        timerRef.current = setTimeout(tick, charDelay);
      } else {
        setIsTyping(false);
      }
    };

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(tick, charDelay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [target, charDelay, enabled]);

  return { displayed, isTyping };
}
