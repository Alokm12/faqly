// Faqly FAQ Widget — storefront rendering script.
//
// Accordion implementation notes:
// Native <details>/<summary> can't be smoothly height-animated across
// browsers (the open/close is instant), so this version uses a button +
// animated wrapper div instead, with max-height/opacity transitions
// driven by JS reading the content's natural scrollHeight. Only one item
// stays open at a time within a given category list — opening a new one
// closes whichever was previously open in that same list.

(function () {
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Renders a small, safe subset of markdown: **bold**, *italic*, and
   * "- " bullet lines. HTML is escaped FIRST, so any literal <, >, &, or
   * quote characters in a merchant's answer can never be interpreted as
   * markup — only our own bold/italic/underline/bullet syntax (applied
   * into real tags. This is the same reason the answer stays plain text
   * in the database rather than storing raw HTML from a rich-text editor.
   */
  function renderMarkdownLite(text) {
    var escaped = escapeHtml(text || "");
    var lines = escaped.split("\n");
    var html = "";
    var listMode = null; // null | "ul" | "ol"

    function closeList() {
      if (listMode) {
        html += listMode === "ul" ? "</ul>" : "</ol>";
        listMode = null;
      }
    }

    lines.forEach(function (line) {
      var bulletMatch = line.match(/^-\s+(.*)/);
      var numberedMatch = line.match(/^\d+\.\s+(.*)/);

      if (bulletMatch) {
        if (listMode !== "ul") {
          closeList();
          html += "<ul>";
          listMode = "ul";
        }
        html += "<li>" + inlineFormat(bulletMatch[1]) + "</li>";
      } else if (numberedMatch) {
        if (listMode !== "ol") {
          closeList();
          html += "<ol>";
          listMode = "ol";
        }
        html += "<li>" + inlineFormat(numberedMatch[1]) + "</li>";
      } else {
        closeList();
        if (line.trim() === "") {
          html += "<br>";
        } else {
          html += "<p>" + inlineFormat(line) + "</p>";
        }
      }
    });
    closeList();
    return html;
  }

  function inlineFormat(str) {
    return str
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<u>$1</u>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderMessage(container, message) {
    container.innerHTML = "";
    container.appendChild(el("p", "faqly-widget__empty", message));
  }

  function closeItem(item) {
    var wrap = item.querySelector(".faqly-item__answer-wrap");
    var button = item.querySelector(".faqly-item__question");
    wrap.style.maxHeight = "0px";
    wrap.style.opacity = "0";
    button.setAttribute("aria-expanded", "false");
    item.classList.remove("faqly-item--open");
  }

  function openItem(item) {
    var wrap = item.querySelector(".faqly-item__answer-wrap");
    var inner = wrap.querySelector(".faqly-item__answer");
    var button = item.querySelector(".faqly-item__question");
    wrap.style.maxHeight = inner.scrollHeight + 40 + "px";
    wrap.style.opacity = "1";
    button.setAttribute("aria-expanded", "true");
    item.classList.add("faqly-item--open");
  }

  function renderAccordionItem(faq, list) {
    var item = el("div", "faqly-item");

    var button = el("button", "faqly-item__question");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.appendChild(document.createTextNode(faq.question));
    var icon = el("span", "faqly-item__icon");
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    var wrap = el("div", "faqly-item__answer-wrap");
    wrap.style.maxHeight = "0px";
    wrap.style.opacity = "0";
    var answer = el("div", "faqly-item__answer");
    answer.innerHTML = renderMarkdownLite(faq.answer);
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
    if (category.color) {
      section.style.setProperty("--faqly-category-color", category.color);
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
    pillsEl.innerHTML = "";

    if (categories.length <= 1) {
      pillsEl.style.display = "none";
      // Still need a default filter key even with the bar hidden.
      return categories.length === 1 ? categories[0].key : "__all__";
    }
    pillsEl.style.display = "flex";

    function makePill(label, key, icon, color) {
      var pill = el("button", "faqly-pill", "");
      pill.type = "button";
      if (color) pill.style.setProperty("--faqly-pill-color", color);
      if (icon) pill.appendChild(el("span", "faqly-pill__icon", icon));
      pill.appendChild(el("span", "faqly-pill__label", label));
      pill.addEventListener("click", function () {
        pillsEl.querySelectorAll(".faqly-pill").forEach(function (p) {
          p.classList.remove("faqly-pill--active");
        });
        pill.classList.add("faqly-pill--active");
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
      pillsEl.appendChild(allPill);
    }

    categories.forEach(function (category, index) {
      var pill = makePill(category.name, category.key, category.icon, category.color);
      // With no "All" tab, the first category tab is the default view —
      // mark it active so the page never loads with every tab looking
      // unselected (which read as a bug, not an intentional "show all"
      // state).
      if (!hasAllTab && index === 0) {
        pill.classList.add("faqly-pill--active");
      }
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
          listEl.innerHTML = "";
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
