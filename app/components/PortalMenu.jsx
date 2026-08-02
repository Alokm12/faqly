import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";

/**
 * Shared row-actions menu.
 *
 * Lifted out of app._index.jsx so the FAQ list and the Categories list use
 * one implementation instead of two that drift apart. Both pages render the
 * same "More options ▾" trigger and the same dropdown.
 *
 * WHY A PORTAL: the menu was originally rendering inside each table row
 * (position: absolute relative to that row), and Polaris's <s-table-row> /
 * <s-table> likely apply `overflow: hidden` or each row creates its own
 * stacking context — either way the dropdown was getting clipped by, or
 * tucked behind, the next row. Rendering into document.body with fixed
 * coordinates sidesteps all of it; the menu is no longer a descendant of the
 * table at all.
 */

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';

const MENU_ITEM_STYLE = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 14px",
  fontFamily: FONT_STACK,
  fontSize: "13px",
  color: "#1f2937",
  background: "none",
  border: "none",
  cursor: "pointer",
  textDecoration: "none",
};

function MoreOptionsButton({ children, buttonRef, ...rest }) {
  return (
    <button
      type="button"
      ref={buttonRef}
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        borderRadius: "8px",
        border: "1px solid rgba(17, 24, 39, 0.15)",
        background: "#fff",
        fontSize: "13px",
        fontWeight: 500,
        color: "#1f2937",
        cursor: "pointer",
      }}
    >
      {children}
      <span style={{ fontSize: "10px" }}>▾</span>
    </button>
  );
}

export function PortalMenu({ items, label = "More options" }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, right: 0 });
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (
        buttonRef.current &&
        !buttonRef.current.contains(e.target) &&
        menuRef.current &&
        !menuRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // The menu is positioned once, in fixed coordinates, so any scroll or
  // resize leaves it floating away from the button that opened it. Closing
  // is the honest response — repositioning mid-scroll would chase the row
  // around the screen, and this is a menu, not a tooltip.
  useEffect(() => {
    if (!open) return undefined;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Runs after the portal has mounted, so menuRef is populated.
  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open]);

  const toggleOpen = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((o) => !o);
  };

  // Escape closes and hands focus back to the trigger. Without the second
  // half, closing the menu drops focus onto <body> and a keyboard user has
  // to tab from the top of the page to get back to where they were.
  const handleKeyDown = (event) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      {/* The ref and the handler live on the button itself. They used to be
          on a wrapping <div>, which worked only because a keyboard
          activation of the inner button happens to bubble a click event —
          accidental, and invisible to any audit. */}
      <MoreOptionsButton
        buttonRef={buttonRef}
        onClick={toggleOpen}
        onKeyDown={handleKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </MoreOptionsButton>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            // Focus moves into the menu when it opens — that is what a
            // menu is expected to do, it is what makes the Escape handler
            // below reachable from the keyboard, and it is what lets Tab
            // walk the items instead of continuing past them into the page.
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            style={{
              position: "fixed",
              top: coords.top,
              right: coords.right,
              background: "#fff",
              border: "1px solid rgba(17,24,39,0.1)",
              borderRadius: "8px",
              boxShadow: "0 8px 24px rgba(17,24,39,0.16)",
              minWidth: "180px",
              fontFamily: FONT_STACK,
              zIndex: 9999,
              overflow: "hidden",
            }}
          >
            {items.map((item, i) => (
              <button
                key={item.label ?? i}
                type="button"
                role="menuitem"
                style={{
                  ...MENU_ITEM_STYLE,
                  ...(item.destructive ? { color: "#DC2626" } : {}),
                  ...(i > 0 && item.destructive
                    ? { borderTop: "1px solid rgba(17,24,39,0.06)" }
                    : {}),
                }}
                onClick={() => {
                  setOpen(false);
                  // `item.href` used to render a raw <a>. Inside the embedded
                  // admin that swaps the iframe's location without the shop /
                  // host / embedded query params the loader needs, so
                  // authenticate.admin() couldn't resolve the session and the
                  // click appeared to do nothing. Routing through React Router
                  // keeps the SPA — and the session — intact.
                  if (item.href) {
                    navigate(item.href);
                  } else {
                    item.onClick();
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
