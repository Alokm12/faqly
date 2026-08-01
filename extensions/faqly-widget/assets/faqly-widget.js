// Faqly FAQ Widget — storefront rendering script.
//
// Accordion implementation notes:
// Native <details>/<summary> can't be smoothly height-animated across
// browsers (the open/close is instant), so this version uses a button +
// animated wrapper div instead, with max-height/opacity transitions
// driven by JS reading the content's natural scrollHeight. Only one item
// stays open at a time within a given category list — opening a new one
// closes whichever was previously open in that same list.
//
// Security note — read before editing renderAnswer/appendInline:
// This file deliberately contains NO innerHTML assignment. Answers are
// merchant-authored free text that renders on every product page, so a
// stored <script> here would execute in every shopper's browser. The
// previous version built an HTML string and escaped it first, which was
// correct but only by convention — reordering two lines turned it into
// stored XSS with nothing to catch it. Markdown is now applied by
// *constructing DOM nodes*: merchant text only ever reaches the page via
// createTextNode/textContent, so it is structurally incapable of being
// parsed as markup. Keep it that way. If you need a new inline style,
// add a tag to the INLINE_TAGS switch — never go back to string
// concatenation.

(function () {
  // Formatting is a client-side cost paid on every product-page view.
  // Past this length the lazy-quantifier scan below is no longer worth
  // the main-thread time (and is the only place a pathological answer
  // could cause backtracking), so very long answers render as plain
  // text rather than blocking paint.
  var MAX_MARKDOWN_LENGTH = 20000;
  var MAX_INLINE_DEPTH = 3;

  // Merchant-supplied category colors are written into a CSS custom
  // property. Custom properties accept nearly any token stream, so an
  // unvalidated value can smuggle url(...) into whatever property
  // consumes it — an outbound request from every product page. The admin
  // form validates hex, but backup imports are arbitrary uploaded JSON,
  // so the storefront validates independently. 3- and 6-digit only.
  var HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

  var idCounter = 0;

  function safeColor(value) {
    if (typeof value !== "string") return "";
    var trimmed = value.trim();
    return HEX_COLOR.test(trimmed) ? trimmed : "";
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Applies the inline subset — **bold**, __underline__, *italic* — by
   * appending real elements and text nodes to `parent`.
   *
   * A single left-to-right alternation replaces the old three sequential
   * .replace() passes. Besides removing the HTML string, it fixes the
   * crossed-tag bug those passes had: "__a**b__c**" used to emit
   * <u>a<strong>b</u>c</strong> — invalid nesting that each browser
   * silently repaired into something the merchant didn't write. One scan
   * can't cross tags; overlapping markers now render as literal text,
   * which is at least the same everywhere.
   *
   * The ***bold italic*** branch is listed first and is not redundant:
   * without it the ** branch wins, leaving a stray "*" in the output.
   * The old code got this shape only as a side effect of the browser
   * repairing <strong><em>x</strong></em>.
   *
   * The regex is created per call because it carries /g state and this
   * function recurses.
   */
  function appendInline(parent, str, depth) {
    var pattern = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*/g;
    var cursor = 0;
    var match;

    while ((match = pattern.exec(str)) !== null) {
      if (match.index > cursor) {
        parent.appendChild(
          document.createTextNode(str.slice(cursor, match.index)),
        );
      }

      var tag = "em";
      var content = match[4];
      var wrapInEm = false;
      if (match[1] !== undefined) {
        tag = "strong";
        content = match[1];
        wrapInEm = true;
      } else if (match[2] !== undefined) {
        tag = "strong";
        content = match[2];
      } else if (match[3] !== undefined) {
        tag = "u";
        content = match[3];
      }

      var node = document.createElement(tag);
      var target = node;
      if (wrapInEm) {
        target = document.createElement("em");
        node.appendChild(target);
      }
      if (depth < MAX_INLINE_DEPTH) {
        appendInline(target, content, depth + 1);
      } else {
        target.appendChild(document.createTextNode(content));
      }
      parent.appendChild(node);
      cursor = pattern.lastIndex;
    }

    if (cursor < str.length) {
      parent.appendChild(document.createTextNode(str.slice(cursor)));
    }
  }

  /**
   * Renders a small, safe subset of markdown as a DocumentFragment:
   * **bold**, __underline__, *italic*, "- " bullets and "1. " numbered
   * lists. Blank lines become <br>, everything else a <p> — same output
   * as the previous string builder, minus the string.
   */
  function renderAnswer(text) {
    var frag = document.createDocumentFragment();
    var source = typeof text === "string" ? text : String(text || "");

    if (source.length > MAX_MARKDOWN_LENGTH) {
      var plain = document.createElement("p");
      plain.textContent = source;
      frag.appendChild(plain);
      return frag;
    }

    var list = null;
    var listTag = null;

    source.split("\n").forEach(function (line) {
      var bulletMatch = line.match(/^-\s+(.*)/);
      var numberedMatch = line.match(/^\d+\.\s+(.*)/);
      var wantedTag = bulletMatch ? "ul" : numberedMatch ? "ol" : null;

      if (wantedTag) {
        if (listTag !== wantedTag) {
          list = document.createElement(wantedTag);
          listTag = wantedTag;
          frag.appendChild(list);
        }
        var li = document.createElement("li");
        appendInline(li, (bulletMatch || numberedMatch)[1], 0);
        list.appendChild(li);
        return;
      }

      list = null;
      listTag = null;

      if (line.trim() === "") {
        frag.appendChild(document.createElement("br"));
        return;
      }

      var p = document.createElement("p");
      appendInline(p, line, 0);
      frag.appendChild(p);
    });

    return frag;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderMessage(container, message) {
    clear(container);
    container.appendChild(el("p", "faqly-widget__empty", message));
  }

  function closeItem(item) {
    var wrap = item.querySelector(".faqly-item__answer-wrap");
    var button = item.querySelector(".faqly-item__question");
    wrap.style.maxHeight = "0px";
    wrap.style.opacity = "0";
    wrap.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
    item.classList.remove("faqly-item--open");
  }

  function openItem(item) {
    var wrap = item.querySelector(".faqly-item__answer-wrap");
    var inner = wrap.querySelector(".faqly-item__answer");
    var button = item.querySelector(".faqly-item__question");
    wrap.style.maxHeight = inner.scrollHeight + 40 + "px";
    wrap.style.opacity = "1";
    wrap.removeAttribute("aria-hidden");
    button.setAttribute("aria-expanded", "true");
    item.classList.add("faqly-item--open");
  }

  function renderAccordionItem(faq, list) {
    var item = el("div", "faqly-item");

    // Screen readers need the button and the panel it controls wired
    // together explicitly — the visual nesting means nothing to them.
    idCounter += 1;
    var buttonId = "faqly-q-" + idCounter;
    var panelId = "faqly-a-" + idCounter;

    var button = el("button", "faqly-item__question");
    button.type = "button";
    button.id = buttonId;
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panelId);
    button.appendChild(document.createTextNode(faq.question));
    var icon = el("span", "faqly-item__icon");
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    var wrap = el("div", "faqly-item__answer-wrap");
    wrap.id = panelId;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-labelledby", buttonId);
    wrap.setAttribute("aria-hidden", "true");
    wrap.style.maxHeight = "0px";
    wrap.style.opacity = "0";
    var answer = el("div", "faqly-item__answer");
    answer.appendChild(renderAnswer(faq.answer));
    wrap.appendChild(answer);

    button.addEventListener("click", function () {
      var isOpen = item.classList.contains("faqly-item--open");
      // Close any other open item in this same list first (single-open).
      list.querySelectorAll(".faqly-item--open").forEach(function (openItemEl) {
        if (openItemEl !== item) closeItem(openItemEl);
      });
      if (isOpen) {
        closeItem(item);
      } else {
        openItem(item);
      }
    });

    item.appendChild(button);
    item.appendChild(wrap);
    return item;
  }

  function renderCategorySection(category, showHeading) {
    var section = el("div", "faqly-category");
    section.setAttribute("data-faqly-category-section", category.key);
    var color = safeColor(category.color);
    if (color) {
      section.style.setProperty("--faqly-category-color", color);
    }

    if (showHeading) {
      var header = el("div", "faqly-category__header");
      if (category.icon) {
        header.appendChild(el("span", "faqly-category__icon", category.icon));
      }
      header.appendChild(el("h3", "faqly-category__title", category.name));
      section.appendChild(header);
    }

    var list = el("div", "faqly-category__list");
    category.faqs.forEach(function (faq) {
      list.appendChild(renderAccordionItem(faq, list));
    });
    section.appendChild(list);

    return section;
  }

  function renderPills(widgetEl, categories, onSelect, allTabLabel) {
    var pillsEl = widgetEl.querySelector("[data-faqly-pills]");
    clear(pillsEl);

    if (categories.length <= 1) {
      pillsEl.style.display = "none";
      // Still need a default filter key even with the bar hidden.
      return categories.length === 1 ? categories[0].key : "__all__";
    }
    pillsEl.style.display = "flex";

    function makePill(label, key, icon, color) {
      var pill = el("button", "faqly-pill", "");
      pill.type = "button";
      var safe = safeColor(color);
      if (safe) pill.style.setProperty("--faqly-pill-color", safe);
      if (icon) pill.appendChild(el("span", "faqly-pill__icon", icon));
      pill.appendChild(el("span", "faqly-pill__label", label));
      pill.addEventListener("click", function () {
        pillsEl.querySelectorAll(".faqly-pill").forEach(function (p) {
          p.classList.remove("faqly-pill--active");
          p.setAttribute("aria-pressed", "false");
        });
        pill.classList.add("faqly-pill--active");
        pill.setAttribute("aria-pressed", "true");
        onSelect(key);
      });
      return pill;
    }

    // If the merchant cleared the "All" tab label on purpose, don't
    // render an empty pill at all — an empty button still takes up
    // padding-driven space (a blank white oval), which looked like a
    // rendering bug rather than "hidden by design".
    var hasAllTab = allTabLabel && allTabLabel.trim() !== "";
    var defaultActiveKey = hasAllTab ? "__all__" : categories[0].key;

    if (hasAllTab) {
      var allPill = makePill(allTabLabel, "__all__", "", "");
      allPill.classList.add("faqly-pill--active");
      allPill.setAttribute("aria-pressed", "true");
      pillsEl.appendChild(allPill);
    }

    categories.forEach(function (category, index) {
      var pill = makePill(
        category.name,
        category.key,
        category.icon,
        category.color,
      );
      // With no "All" tab, the first category tab is the default view —
      // mark it active so the page never loads with every tab looking
      // unselected (which read as a bug, not an intentional "show all"
      // state).
      var isDefault = !hasAllTab && index === 0;
      if (isDefault) pill.classList.add("faqly-pill--active");
      pill.setAttribute("aria-pressed", isDefault ? "true" : "false");
      pillsEl.appendChild(pill);
    });

    return defaultActiveKey;
  }

  /**
   * Reads a data-attribute, falling back to a default ONLY when the
   * attribute is genuinely absent (null) — not when it's present but
   * empty. This matters because `attr || fallback` (the previous
   * approach) treats an empty string as falsy and silently restores the
   * default, which broke merchants intentionally clearing a text field
   * (e.g. to hide the "All" tab's label) in the Theme Editor.
   */
  function readTextSetting(widgetEl, attrName, fallback) {
    var value = widgetEl.getAttribute(attrName);
    return value !== null ? value : fallback;
  }

  /**
   * The block's Liquid renders fine on its own, so when faqly-widget.css
   * fails to load the widget just appears unstyled with no clue why. This
   * checks a property the stylesheet definitely sets (.faqly-widget has a
   * max-width) and says so in the console instead of leaving it a mystery.
   */
  function warnIfStylesheetMissing(widgetEl) {
    if (!window.getComputedStyle) return;
    var maxWidth = window.getComputedStyle(widgetEl).maxWidth;
    if (maxWidth === "none" || maxWidth === "") {
      console.warn(
        "[Faqly] faqly-widget.css did not load — the widget will render " +
          "unstyled. Check the stylesheet request in the Network tab; the " +
          "extension's assets/ folder is most likely not deployed.",
      );
    }
  }

  function initWidget(widgetEl) {
    warnIfStylesheetMissing(widgetEl);
    var listEl = widgetEl.querySelector("[data-faqly-list]");
    var productId = widgetEl.getAttribute("data-product-id");
    var collectionIds = widgetEl.getAttribute("data-collection-ids");
    var emptyText = readTextSetting(
      widgetEl,
      "data-empty-text",
      "No FAQs available for this page yet.",
    );
    var loadingText = readTextSetting(widgetEl, "data-loading-text", "Loading FAQs…");
    var allTabLabel = readTextSetting(widgetEl, "data-all-tab-label", "All");
    var creditText = readTextSetting(widgetEl, "data-credit-text", "Powered by Faqly");
    var showCreditTheme = widgetEl.getAttribute("data-show-credit") !== "false";

    var params = new URLSearchParams();
    if (productId) params.set("product_id", productId);
    if (collectionIds) params.set("collection_ids", collectionIds);

    renderMessage(listEl, loadingText);

    fetch("/apps/faqly/faqs?" + params.toString())
      .then(function (response) {
        if (!response.ok) throw new Error("Faqly: request failed");
        return response.json();
      })
      .then(function (data) {
        var categories = (data && data.categories) || [];
        var poweredByVisible = data && data.poweredByVisible !== false;
        var showCredit = poweredByVisible && showCreditTheme;

        if (categories.length === 0) {
          renderMessage(listEl, emptyText);
          return;
        }

        function renderAll(filterKey) {
          clear(listEl);
          var toShow =
            filterKey === "__all__"
              ? categories
              : categories.filter(function (c) {
                  return c.key === filterKey;
                });
          var showHeadings = toShow.length > 1;
          toShow.forEach(function (category) {
            listEl.appendChild(renderCategorySection(category, showHeadings));
          });
          if (showCredit) {
            listEl.appendChild(el("p", "faqly-widget__credit", creditText));
          }
        }

        var defaultKey = renderPills(widgetEl, categories, renderAll, allTabLabel);
        renderAll(defaultKey);
      })
      .catch(function (error) {
        // Previously this rendered emptyText, so a dead proxy, a 500, or
        // malformed JSON all looked identical to "this page has no FAQs" —
        // which is what made the last outage hard to place. The shopper now
        // gets a message that says something went wrong, and the real cause
        // goes to the console for whoever is debugging.
        console.error("[Faqly] Could not load FAQs from /apps/faqly/faqs:", error);
        renderMessage(
          listEl,
          "FAQs couldn't be loaded right now. Please refresh the page.",
        );
      });
  }

  document.querySelectorAll("[data-faqly-widget]").forEach(initWidget);
})();
