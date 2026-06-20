import React, { useCallback, useEffect, useRef, useState } from "react";
import { loadFromChrome, saveToChrome } from "../../utils/chrome-storage";
import { CAPTURE_MODE_STORAGE_KEY, isCaptureMode, type CaptureMode } from "../../constants/capture";
import { FolderView } from "./FolderView";
import { SettingsView } from "./SettingsView";
import { MemoryMenuContent } from "./MemoryMenuContent";
import { LanguageProvider, useTranslation } from "../../i18n/LanguageContext";
import { ThemeProvider, useTheme } from "../../i18n/ThemeContext";
import { getThemeTokens } from "../../ui/theme";
import { getCaptureModeTone } from "../../ui/captureModeTone";
import type { LangCode } from "../../i18n/translations";
import { inferSessionIdFromUrl } from "../../utils/session-url";
import type { GetCaptureModeResponse, StatusUpdate } from "../../types/messages";
import { APP_DISPLAY_NAME } from "../../constants/branding";
import {
  safeRuntimeGetURL,
  safeRuntimeOnMessage,
  safeRuntimeSendMessage,
  safeStorageOnChanged,
} from "../../utils/extension-context";

// ── SVG Icons ──────────────────────────────────────────────────────────────────

const SunIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const XIcon = () => (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const GearIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// ── Constants ──────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 420;

const THEME_TRANSITION_CSS = `
.aim-panel * {
  transition-property: background-color, color, border-color, box-shadow;
  transition-duration: 0.25s;
  transition-timing-function: ease;
}
@keyframes aimPanelFadeIn {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0)  scale(1); }
}
.aim-panel-enter {
  animation: aimPanelFadeIn 0.28s cubic-bezier(0.4, 0, 0.2, 1) both;
}
`;
const MARGIN = 16;
const LOGO_SIZE = 60;

// ── Hooks & Small Components ───────────────────────────────────────────────────

function useViewportClamp() {
  const [bounds, setBounds] = useState({ width: PANEL_WIDTH, height: 560 });
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setBounds({
        width: Math.min(PANEL_WIDTH, w - MARGIN * 2),
        height: Math.min(Math.floor(h * 0.85), h - MARGIN * 2),
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return bounds;
}


function clampLogoTop(top: number) {
  const vh = window.innerHeight;
  return Math.max(0, Math.min(top, vh - LOGO_SIZE));
}

function clampPanelPosition(
  left: number,
  top: number,
  width: number,
  height: number,
) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    left: Math.max(0, Math.min(left, vw - width)),
    top: Math.max(0, Math.min(top, vh - height)),
  };
}

let externalOpenRef: (() => void) | null = null;

export function openMemoryPanelExternally() {
  externalOpenRef?.();
}

function useEscape(panelOpen: boolean, onClose: () => void) {
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [panelOpen, onClose]);
}

// ── Inner Component ────────────────────────────────────────────────────────────

function useThemeTransitionStyle() {
  useEffect(() => {
    const id = "aim-theme-transition-style";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = THEME_TRANSITION_CSS;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
}

type PanelView = "menu" | "folder" | "settings";
const PANEL_VIEWS: readonly string[] = ["menu", "folder", "settings"];
const STORAGE_PANEL_OPEN = "ai-memory-panel-open";
const STORAGE_PANEL_VIEW = "ai-memory-panel-view";

function isValidPanelView(v: unknown): v is PanelView {
  return typeof v === "string" && PANEL_VIEWS.includes(v);
}

function FloatingMemoryPanelInner() {
  useThemeTransitionStyle();
  const { t, lang, setLang, langNames, langCodes } = useTranslation();
  const { theme, toggleTheme } = useTheme();
  const tk = getThemeTokens(theme);
  const [logoHidden, setLogoHidden] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>("menu");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("auto");
  const captureModeTone = getCaptureModeTone(captureMode, tk);
  const persistedRef = useRef(false);
  const [logoHovered, setLogoHovered] = useState(false);
  const [logoTop, setLogoTop] = useState(() => clampLogoTop(100));
  const [panelPos, setPanelPos] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
    didMove: false,
  });
  const panelDragRef = useRef({
    active: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0,
  });
  const { width: panelMaxWidth, height: panelMaxHeight } = useViewportClamp();

  useEffect(() => {
    safeRuntimeSendMessage<GetCaptureModeResponse>({ type: "GET_CAPTURE_MODE" }, (response) => {
      if (response?.payload?.mode) setCaptureMode(response.payload.mode);
    });
    const messageHandler = (message: unknown) => {
      const update = message as StatusUpdate;
      if (update?.type === "STATUS_UPDATE" && update.payload.captureMode) {
        setCaptureMode(update.payload.captureMode);
      }
    };
    const storageHandler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      const next = changes[CAPTURE_MODE_STORAGE_KEY]?.newValue;
      if (isCaptureMode(next)) setCaptureMode(next);
    };
    const removeMessageListener = safeRuntimeOnMessage(messageHandler);
    const removeStorageListener = safeStorageOnChanged(storageHandler);
    return () => {
      removeMessageListener();
      removeStorageListener();
    };
  }, []);

  const openGraph = useCallback(() => {
    const sessionId =
      typeof window !== "undefined"
        ? inferSessionIdFromUrl(window.location.href)
        : undefined;
    safeRuntimeSendMessage({ type: "REQUEST_DOM_SYNC_NOW" }, () => {
      window.setTimeout(() => {
        safeRuntimeSendMessage(
          { type: "OPEN_MEMORY_GRAPH", payload: { sessionId } },
          () => {
            setPanelOpen(false);
          },
        );
      }, 250);
    });
  }, []);

  // Restore panel state on mount
  useEffect(() => {
    void (async () => {
      const open = await loadFromChrome(
        STORAGE_PANEL_OPEN,
        (v): v is boolean => typeof v === "boolean",
      );
      const view = await loadFromChrome(STORAGE_PANEL_VIEW, isValidPanelView);
      if (open !== null) setPanelOpen(open);
      if (view !== null) setPanelView(view);
      persistedRef.current = true;
    })();
  }, []);

  // Persist panel state on change
  useEffect(() => {
    if (!persistedRef.current) return;
    void saveToChrome(STORAGE_PANEL_OPEN, panelOpen);
  }, [panelOpen]);

  useEffect(() => {
    if (!persistedRef.current) return;
    void saveToChrome(STORAGE_PANEL_VIEW, panelView);
  }, [panelView]);

  const closePanel = useCallback(() => setPanelOpen(false), []);
  const openPanel = useCallback(() => {
    setLogoHidden(false);
    setPanelOpen(true);
    setPanelPos((prev) => {
      if (prev !== null) return prev;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return clampPanelPosition(
        vw - MARGIN - panelMaxWidth,
        vh - MARGIN - panelMaxHeight,
        panelMaxWidth,
        panelMaxHeight,
      );
    });
  }, [panelMaxWidth, panelMaxHeight]);

  useEscape(panelOpen, closePanel);

  useEffect(() => {
    externalOpenRef = openPanel;
    return () => {
      if (externalOpenRef === openPanel) externalOpenRef = null;
    };
  }, [openPanel]);

  useEffect(() => {
    const onResize = () => {
      setLogoTop((top) => clampLogoTop(top));
      setPanelPos((p) =>
        p
          ? clampPanelPosition(
              p.left,
              p.top,
              panelRef.current?.offsetWidth ?? panelMaxWidth,
              panelRef.current?.offsetHeight ?? panelMaxHeight,
            )
          : null,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [panelMaxWidth, panelMaxHeight]);

  const onLogoMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startTop = logoTop;
      dragRef.current = {
        active: true,
        didMove: false,
        startX: 0,
        startY,
        startLeft: 0,
        startTop,
      };

      const onMove = (moveEvent: MouseEvent) => {
        dragRef.current.didMove = true;
        setLogoTop(clampLogoTop(startTop + (moveEvent.clientY - startY)));
      };
      const onUp = () => {
        dragRef.current.active = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [logoTop],
  );

  const getDefaultPanelPosition = useCallback(() => {
    const w = panelRef.current?.offsetWidth ?? panelMaxWidth;
    const h = panelRef.current?.offsetHeight ?? panelMaxHeight;
    return clampPanelPosition(
      window.innerWidth - MARGIN - w,
      window.innerHeight - MARGIN - h,
      w,
      h,
    );
  }, [panelMaxWidth, panelMaxHeight]);

  const onPanelHeaderMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      const defaultPos = getDefaultPanelPosition();
      const currentLeft = panelPos?.left ?? defaultPos.left;
      const currentTop = panelPos?.top ?? defaultPos.top;
      panelDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        startLeft: currentLeft,
        startTop: currentTop,
      };
      const onMove = (moveEvent: MouseEvent) => {
        const { startX, startY, startLeft, startTop } = panelDragRef.current;
        const w = panelRef.current?.offsetWidth ?? panelMaxWidth;
        const h = panelRef.current?.offsetHeight ?? panelMaxHeight;
        const next = clampPanelPosition(
          startLeft + (moveEvent.clientX - startX),
          startTop + (moveEvent.clientY - startY),
          w,
          h,
        );
        setPanelPos(next);
      };
      const onUp = () => {
        panelDragRef.current.active = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelPos, getDefaultPanelPosition, panelMaxWidth, panelMaxHeight],
  );

  if (logoHidden) return null;

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 2147483647,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        fontSize: 13,
      }}
    >
      {/* Logo: fixed on right edge, only when panel is closed */}
      {!panelOpen && (
        <div
          style={{
            position: "fixed",
            right: MARGIN,
            top: logoTop,
            width: LOGO_SIZE,
            height: LOGO_SIZE,
            borderRadius: 16,
            backgroundColor:
              theme === "dark"
                ? "rgba(28,28,30,0.92)"
                : "rgba(255,255,255,0.92)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow:
              theme === "dark"
                ? "0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)"
                : "0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(60,60,67,0.10)",
            cursor: "grab",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseDown={onLogoMouseDown}
          onMouseEnter={() => setLogoHovered(true)}
          onMouseLeave={() => setLogoHovered(false)}
          onClick={() => {
            if (!dragRef.current.didMove) openPanel();
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && openPanel()}
          title={APP_DISPLAY_NAME}
        >
          <img
            src={safeRuntimeGetURL("assets/icon.png") ?? ""}
            alt={APP_DISPLAY_NAME}
            width={36}
            height={36}
            style={{ display: "block", pointerEvents: "none", borderRadius: 8 }}
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              const next = img?.nextElementSibling as HTMLElement | null;
              if (img) img.style.display = "none";
              if (next) next.style.display = "flex";
            }}
          />
          <span
            style={{
              display: "none",
              alignItems: "center",
              justifyContent: "center",
              width: 36,
              height: 36,
              borderRadius: 8,
              backgroundColor: tk.accent,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
            }}
            aria-hidden
          >
            M
          </span>
          {logoHovered && (
            <button
              type="button"
              aria-label="Hide logo"
              onClick={(e) => {
                e.stopPropagation();
                setLogoHidden(true);
              }}
              style={{
                position: "absolute",
                top: -5,
                right: -5,
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: `1px solid ${tk.border}`,
                background:
                  theme === "dark"
                    ? "rgba(44,44,46,0.95)"
                    : "rgba(255,255,255,0.95)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: tk.textMuted,
                boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
              }}
            >
              <XIcon />
            </button>
          )}
        </div>
      )}

      {/* Panel: draggable overlay */}
      {panelOpen &&
        (() => {
          const pos = panelPos ?? clampPanelPosition(
            window.innerWidth - MARGIN - panelMaxWidth,
            window.innerHeight - MARGIN - panelMaxHeight,
            panelMaxWidth,
            panelMaxHeight,
          );
          return (
            <div
              ref={panelRef}
              role="dialog"
              aria-label={`${APP_DISPLAY_NAME} panel`}
              className="aim-panel aim-panel-enter"
              style={{
                position: "fixed",
                left: pos.left,
                top: pos.top,
                zIndex: 2147483647,
                width: panelMaxWidth,
                maxWidth: panelMaxWidth,
                maxHeight: panelMaxHeight,
                backgroundColor:
                  theme === "dark"
                    ? "rgba(28,28,30,0.94)"
                    : "rgba(242,242,247,0.94)",
                backdropFilter: "blur(24px) saturate(180%)",
                WebkitBackdropFilter: "blur(24px) saturate(180%)",
                borderRadius: 16,
                boxShadow:
                  theme === "dark"
                    ? "0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)"
                    : "0 8px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(60,60,67,0.10)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                transition:
                  "background-color 0.25s ease, box-shadow 0.25s ease",
              }}
            >
              {/* Header */}
              <div
                role="presentation"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  borderBottom: `1px solid ${tk.separator}`,
                  backgroundColor:
                    theme === "dark"
                      ? "rgba(44,44,46,0.70)"
                      : "rgba(255,255,255,0.60)",
                  cursor: "grab",
                  flexShrink: 0,
                  transition:
                    "background-color 0.25s ease, border-color 0.25s ease",
                }}
                onMouseDown={onPanelHeaderMouseDown}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginLeft: 4,
                  }}
                >
                  {/* Drag handle decoration — 3 cols × 2 rows of dots (horizontal) */}
                  <svg
                    width="14"
                    height="8"
                    viewBox="0 0 14 8"
                    fill="none"
                    style={{
                      flexShrink: 0,
                      opacity: 0.65,
                      pointerEvents: "none",
                      color: tk.textMuted,
                    }}
                  >
                    <circle cx="1.5" cy="1.5" r="1.5" fill="currentColor" />
                    <circle cx="7" cy="1.5" r="1.5" fill="currentColor" />
                    <circle cx="12.5" cy="1.5" r="1.5" fill="currentColor" />
                    <circle cx="1.5" cy="6.5" r="1.5" fill="currentColor" />
                    <circle cx="7" cy="6.5" r="1.5" fill="currentColor" />
                    <circle cx="12.5" cy="6.5" r="1.5" fill="currentColor" />
                  </svg>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 14,
                        color: tk.text,
                        letterSpacing: "-0.02em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {APP_DISPLAY_NAME}
                    </span>
                    <span
                      title={t.autoSaveMemory}
                      style={{
                        borderRadius: 999,
                        backgroundColor: captureModeTone.backgroundColor,
                        color: captureModeTone.color,
                        border: `1px solid ${captureModeTone.borderColor}`,
                        boxShadow: `0 0 0 3px ${captureModeTone.ringColor}`,
                        padding: "3px 8px",
                        fontSize: 11,
                        lineHeight: 1,
                        fontWeight: 750,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {captureMode === "auto" ? t.captureModeAuto : t.captureModeManual}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    style={{
                      width: 30,
                      height: 30,
                      padding: 0,
                      borderRadius: 8,
                      border: `1px solid ${tk.border}`,
                      backgroundColor: tk.btnBg,
                      color: tk.textMuted,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title={theme === "light" ? t.themeDark : t.themeLight}
                  >
                    {theme === "light" ? <MoonIcon /> : <SunIcon />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanelView("settings")}
                    style={{
                      width: 30,
                      height: 30,
                      padding: 0,
                      borderRadius: 8,
                      border: `1px solid ${tk.border}`,
                      backgroundColor: tk.btnBg,
                      color: tk.textMuted,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    title={t.settings}
                  >
                    <GearIcon />
                  </button>
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as LangCode)}
                    style={{
                      fontSize: 11,
                      padding: "4px 6px",
                      borderRadius: 8,
                      border: `1px solid ${tk.border}`,
                      backgroundColor: tk.inputBg,
                      color: tk.text,
                      cursor: "pointer",
                      outline: "none",
                      minWidth: 80,
                      fontFamily: "inherit",
                    }}
                    title={t.language}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {langCodes.map((code) => (
                      <option key={code} value={code}>
                        {langNames[code]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Close panel"
                    onClick={closePanel}
                    style={{
                      width: 28,
                      height: 28,
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: tk.textMuted,
                      padding: 0,
                      borderRadius: 6,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        tk.text;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.color =
                        tk.textMuted;
                    }}
                  >
                    <XIcon />
                  </button>
                </div>
              </div>

              {/* Content — sliding two-slot layout */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: panelMaxWidth * 2,
                    height: "100%",
                    transform:
                      panelView === "menu"
                        ? "translateX(0)"
                        : `translateX(-${panelMaxWidth}px)`,
                    transition: "transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  {/* Slot 0: Menu */}
                  <div
                    style={{
                      width: panelMaxWidth,
                      flexShrink: 0,
                      overflowY: "auto",
                      overflowX: "hidden",
                      maxHeight: panelMaxHeight - 52,
                      opacity: panelView === "menu" ? 1 : 0,
                      transition:
                        "opacity 0.22s ease, background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
                    }}
                  >
                    <div
                      style={{
                        padding: "12px 16px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 10,
                      }}
                    >
                      <MemoryMenuContent
                        onOpenGraph={openGraph}
                        onOpenFolder={() => setPanelView("folder")}
                      />
                    </div>
                  </div>

                  {/* Slot 1: Detail views — all rendered, visibility toggled to prevent flash during slide-back */}
                  <div
                    style={{
                      width: panelMaxWidth,
                      flexShrink: 0,
                      position: "relative",
                      maxHeight: panelMaxHeight - 52,
                      opacity: panelView !== "menu" ? 1 : 0,
                      transition:
                        "opacity 0.22s ease, background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease",
                    }}
                  >
                    <div
                      style={{
                        display: panelView === "folder" ? "block" : "none",
                        height: "100%",
                        overflowY: "auto",
                        overflowX: "hidden",
                      }}
                    >
                      <FolderView
                        onBack={() => setPanelView("menu")}
                        width={panelMaxWidth}
                      />
                    </div>
                    <div
                      style={{
                        display: panelView === "settings" ? "block" : "none",
                        height: "100%",
                        overflowY: "auto",
                        overflowX: "hidden",
                      }}
                    >
                      <SettingsView
                        onBack={() => setPanelView("menu")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}

export function FloatingMemoryPanel() {
  return (
    <LanguageProvider>
      <ThemeProvider>
        <FloatingMemoryPanelInner />
      </ThemeProvider>
    </LanguageProvider>
  );
}
