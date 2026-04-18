/**
 * form-rescue: An intelligent, zero-dependency auto-saver for HTML forms.
 */
class Rescue {
  constructor(form, options = {}) {
    if (!form) {
      console.error(
        "Form Rescue: The provided form element or selector does not exist.",
      );
      return;
    }

    this.form = form;
    this.options = {
      ttl: "24h",
      debounce: 300,
      ...options,
    };

    this.storageKey =
      this.options.storageKey ||
      `form-rescue-draft:${window.location.pathname}:${this.form.id || this.form.name || "form"}`;

    // Store bound methods to be able to remove them later.
    this.boundClearDraft = this._clearDraft.bind(this);
    this.boundHandleStorageEvent = this._handleStorageEvent.bind(this);
    this.debouncedSave = this._debounce(
      this._saveDraft.bind(this),
      this.options.debounce,
    );

    this._addEventListeners();
    this._loadDraft();
  }

  static watch(formSelectorOrElement, options) {
    const form =
      typeof formSelectorOrElement === "string"
        ? document.querySelector(formSelectorOrElement)
        : formSelectorOrElement;

    if (form) {
      return new Rescue(form, options);
    } else {
      console.error(
        `Form Rescue: Could not find form with selector "${formSelectorOrElement}".`,
      );
    }
  }

  _addEventListeners() {
    this.form.addEventListener("input", this.debouncedSave);
    this.form.addEventListener("submit", this.boundClearDraft);
    this.form.addEventListener("reset", this.boundClearDraft);
    window.addEventListener("storage", this.boundHandleStorageEvent);
  }

  /**
   * Manually triggers an immediate save of the current form state.
   */
  save() {
    this._saveDraft();
  }

  /**
   * Manually clears the saved draft from localStorage.
   */
  clear() {
    this._clearDraft();
  }

  /**
   * Removes all event listeners and cleans up the instance.
   * This is useful for single-page applications when a component is unmounted.
   */
  destroy() {
    // Cancel any pending debounced save.
    this.debouncedSave.cancel();

    this.form.removeEventListener("input", this.debouncedSave);
    this.form.removeEventListener("submit", this.boundClearDraft);
    this.form.removeEventListener("reset", this.boundClearDraft);
    window.removeEventListener("storage", this.boundHandleStorageEvent);
  }

  _serializeForm() {
    const data = {};
    const elements = this.form.elements;

    for (const element of elements) {
      if (
        !element.name ||
        element.disabled ||
        element.type === "file" ||
        element.hasAttribute("data-no-rescue")
      ) {
        continue;
      }

      switch (element.type) {
        case "checkbox":
          data[element.name] = element.checked;
          break;
        case "radio":
          if (element.checked) {
            data[element.name] = element.value;
          }
          break;
        case "select-multiple":
          data[element.name] = Array.from(element.options)
            .filter((opt) => opt.selected)
            .map((opt) => opt.value);
          break;
        default:
          data[element.name] = element.value;
      }
    }

    // 2. Custom content-rescuable elements
    const customElements = this.form.querySelectorAll("[data-rescue-content]");
    for (const element of customElements) {
      const name = element.getAttribute("data-rescue-content");
      if (name && !element.hasAttribute("data-no-rescue")) {
        data[name] = element.innerHTML;
      }
    }
    return data;
  }

  _saveDraft() {
    const draft = {
      timestamp: Date.now(),
      data: this._serializeForm(),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(draft));

    // Fire the onSave callback if it exists
    if (this.options.onSave) {
      this.options.onSave(draft);
    }
  }

  _loadDraft() {
    const savedDraft = localStorage.getItem(this.storageKey);
    if (!savedDraft) return;

    try {
      const draft = JSON.parse(savedDraft);
      const ttlMs = this._parseTtl(this.options.ttl);

      if (Date.now() - draft.timestamp > ttlMs) {
        this._clearDraft();
        return;
      }

      if (this.options.onDraftFound) {
        this.options.onDraftFound(draft, () => this._restoreForm(draft.data));
      } else {
        this._restoreForm(draft.data);
      }
    } catch (e) {
      console.error("Form Rescue: Failed to parse draft from localStorage.", e);
      this._clearDraft();
    }
  }

  _restoreForm(data) {
    const elements = this.form.elements;
    for (const name in data) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) continue;

      const element = elements[name];
      if (!element) continue;

      // Handle standard form elements
      if (element) {
        let elementsToTrigger = [];

        if (element.constructor === RadioNodeList) {
          for (const radio of element) {
            radio.checked = radio.value === data[name];
            if (radio.checked) elementsToTrigger.push(radio);
          }
        } else {
          switch (element.type) {
            case "checkbox":
              element.checked = data[name];
              break;
            case "select-multiple":
              const values = new Set(data[name]);
              for (const option of element.options) {
                option.selected = values.has(option.value);
              }
              break;
            default:
              element.value = data[name];
          }
          elementsToTrigger.push(element);
        }

        elementsToTrigger.forEach((el) => {
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      // Handle custom content-rescuable elements
      else {
        const customElement = this.form.querySelector(
          `[data-rescue-content="${name}"]`,
        );
        if (customElement) {
          customElement.innerHTML = data[name];
          // Dispatch events for frameworks that might be listening
          customElement.dispatchEvent(new Event("input", { bubbles: true }));
          customElement.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
    }
  }

  _clearDraft() {
    localStorage.removeItem(this.storageKey);
  }

  _handleStorageEvent(event) {
    if (event.key === this.storageKey && event.newValue) {
      try {
        const draft = JSON.parse(event.newValue);
        this._restoreForm(draft.data);
      } catch (e) {
        console.error("Form Rescue: Failed to sync from another tab.", e);
      }
    }
  }

  _debounce(func, delay) {
    let timeout;
    const debounced = function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), delay);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
    };
    return debounced;
  }

  _parseTtl(ttlString) {
    const match = ttlString.match(/^(\d+)([mhd])$/);
    if (!match) return 24 * 60 * 60 * 1000;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      case "d":
        return value * 24 * 60 * 60 * 1000;
      default:
        return value;
    }
  }
}

export default Rescue;
