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
    wrap.style.maxHeight = inner.scrollHeight + 24 + "px";
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
    var answer = el("div", "faqly-item__answer", faq.answer);
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

  function renderCategorySection(category) {
    var section = el("div", "faqly-category");
    section.setAttribute("data-faqly-category-section", category.key);
    if (category.color) {
      section.style.setProperty("--faqly-category-color", category.color);
    }

    var header = el("div", "faqly-category__header");
    if (category.icon) {
      header.appendChild(el("span", "faqly-category__icon", category.icon));
    }
    header.appendChild(el("h3", "faqly-category__title", category.name));
    section.appendChild(header);

    var list = el("div", "faqly-category__list");
    category.faqs.forEach(function (faq) {
      list.appendChild(renderAccordionItem(faq, list));
    });
    section.appendChild(list);

    return section;
  }

  function renderPills(widgetEl, categories, onSelect) {
    var pillsEl = widgetEl.querySelector("[data-faqly-pills]");
    pillsEl.innerHTML = "";

    if (categories.length <= 1) {
      pillsEl.style.display = "none";
      return;
    }
    pillsEl.style.display = "flex";

    function makePill(label, key, icon) {
      var pill = el("button", "faqly-pill", "");
      pill.type = "button";
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

    var allPill = makePill("All", "__all__", "");
    allPill.classList.add("faqly-pill--active");
    pillsEl.appendChild(allPill);

    categories.forEach(function (category) {
      pillsEl.appendChild(makePill(category.name, category.key, category.icon));
    });
  }

  function initWidget(widgetEl) {
    var listEl = widgetEl.querySelector("[data-faqly-list]");
    var productId = widgetEl.getAttribute("data-product-id");
    var collectionIds = widgetEl.getAttribute("data-collection-ids");
    var emptyText =
      widgetEl.getAttribute("data-empty-text") ||
      "No FAQs available for this page yet.";

    var params = new URLSearchParams();
    if (productId) params.set("product_id", productId);
    if (collectionIds) params.set("collection_ids", collectionIds);

    renderMessage(listEl, "Loading FAQs…");

    fetch("/apps/faqly/faqs?" + params.toString())
      .then(function (response) {
        if (!response.ok) throw new Error("Faqly: request failed");
        return response.json();
      })
      .then(function (data) {
        var categories = (data && data.categories) || [];

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
          toShow.forEach(function (category) {
            listEl.appendChild(renderCategorySection(category));
          });
        }

        renderPills(widgetEl, categories, renderAll);
        renderAll("__all__");
      })
      .catch(function () {
        renderMessage(listEl, emptyText);
      });
  }

  document.querySelectorAll("[data-faqly-widget]").forEach(initWidget);
})();
