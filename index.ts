/**
 * Configuration options for the Rescue instance.
 */
export interface RescueOptions {
  /** Time-to-live for the draft (e.g., '30m', '24h', '7d'). Defaults to '24h'. */
  ttl?: string;
  /** Delay in milliseconds before saving the draft after an input event. Defaults to 300. */
  debounce?: number;
  /** Custom local storage key. Defaults to a generated key based on the URL and form ID. */
  storageKey?: string;
  /** Callback triggered when an existing draft is found upon initialization. */
  onDraftFound?: (draft: Draft, restore: () => void) => void;
  /** Callback triggered immediately after a draft is successfully saved. */
  onSave?: (draft: Draft) => void;
  /** If true, clears the draft automatically on the native 'submit' event. Defaults to true. */
  clearOnSubmit?: boolean;
  /** Optional callback for AJAX submissions. Prevents default, awaits the Promise, and clears the draft only on success. */
  onAjaxSubmit?: (event: Event) => Promise<any>;
}

/**
 * Represents the serialized key-value form data.
 */
export interface DraftData {
  [key: string]: any;
}

/**
 * Represents a saved form draft, including its timestamp and data.
 */
export interface Draft {
  /** The timestamp (in milliseconds) when the draft was saved. */
  timestamp: number;
  /** The serialized form data. */
  data: DraftData;
}

/**
 * form-rescue: An intelligent, zero-dependency auto-saver for HTML forms.
 *
 * This class acts as a safety net, automatically persisting form data to `localStorage`
 * and recovering it across page reloads or accidental tab closures.
 */
class Rescue {
  private form!: HTMLFormElement;
  private options!: Required<
    Omit<RescueOptions, 'onDraftFound' | 'onSave' | 'storageKey' | 'onAjaxSubmit'>
  > &
    RescueOptions;
  private storageKey!: string;
  private boundClearDraft!: () => void;
  private boundHandleStorageEvent!: (event: StorageEvent) => void;
  private boundHandleSubmit!: (event: Event) => void;
  private debouncedSave!: ((...args: any[]) => void) & { cancel: () => void };

  /**
   * Initializes a new Rescue instance.
   * @param form - The HTML form element to monitor.
   * @param options - Configuration options for the Rescue instance.
   */
  constructor(form: HTMLFormElement, options: RescueOptions = {}) {
    if (!form) {
      console.error('Form Rescue: The provided form element or selector does not exist.');
      return;
    }

    this.form = form;
    this.options = {
      ttl: '24h',
      debounce: 300,
      clearOnSubmit: true,
      ...options,
    };

    this.storageKey =
      this.options.storageKey ||
      `form-rescue-draft:${window.location.pathname}:${this.form.id || this.form.name || 'form'}`;

    // Store bound methods to be able to remove them later.
    this.boundClearDraft = this._clearDraft.bind(this) as () => void;
    this.boundHandleStorageEvent = this._handleStorageEvent.bind(this) as (
      event: StorageEvent,
    ) => void;
    this.boundHandleSubmit = this._handleSubmit.bind(this) as (event: Event) => void;
    this.debouncedSave = this._debounce(
      this._saveDraft.bind(this) as () => void,
      this.options.debounce,
    );

    this._addEventListeners();
    this._loadDraft();
  }

  /**
   * Utility method to easily find a form and initialize `form-rescue` on it.
   *
   * @param formSelectorOrElement - A CSS selector string matching the form, or the HTMLFormElement itself.
   * @param options - Configuration options for the instance.
   * @returns The newly created Rescue instance, or undefined if the form could not be found.
   */
  static watch(
    formSelectorOrElement: string | HTMLFormElement,
    options?: RescueOptions,
  ): Rescue | undefined {
    const form: HTMLFormElement | null =
      typeof formSelectorOrElement === 'string'
        ? document.querySelector(formSelectorOrElement)
        : formSelectorOrElement;

    if (form) {
      return new Rescue(form, options);
    } else {
      console.error(`Form Rescue: Could not find form with selector "${formSelectorOrElement}".`);
    }
  }

  private _addEventListeners() {
    this.form.addEventListener('input', this.debouncedSave);
    this.form.addEventListener('submit', this.boundHandleSubmit);
    this.form.addEventListener('reset', this.boundClearDraft);
    window.addEventListener('storage', this.boundHandleStorageEvent);
  }

  /**
   * Manually triggers an immediate save of the current form state.
   * Bypasses the standard debounce delay.
   */
  save() {
    this._saveDraft();
  }

  /**
   * Manually clears the saved draft from `localStorage`.
   */
  clear() {
    this._clearDraft();
  }

  /**
   * Removes all event listeners and cleans up the instance.
   * Essential for preventing memory leaks in single-page applications (SPAs)
   * when the form component is unmounted or destroyed.
   */
  destroy() {
    // Cancel any pending debounced save.
    this.debouncedSave.cancel();

    this.form.removeEventListener('input', this.debouncedSave);
    this.form.removeEventListener('submit', this.boundHandleSubmit);
    this.form.removeEventListener('reset', this.boundClearDraft);
    window.removeEventListener('storage', this.boundHandleStorageEvent);
  }

  private _handleSubmit(event: Event) {
    if (this.options.onAjaxSubmit) {
      event.preventDefault();
      Promise.resolve(this.options.onAjaxSubmit(event))
        .then(() => this.clear())
        .catch(() => {
          // AJAX failed, do nothing and keep the draft
        });
    } else if (this.options.clearOnSubmit) {
      this.clear();
    }
  }

  private _serializeForm() {
    const data: DraftData = {};
    const elements = this.form.elements;

    for (const element of Array.from(elements)) {
      const el = element as HTMLInputElement;
      if (!el.name || el.disabled || el.type === 'file' || el.hasAttribute('data-no-rescue')) {
        continue;
      }

      switch (el.type) {
        case 'checkbox':
          data[el.name] = el.checked;
          break;
        case 'radio':
          if (el.checked) {
            data[el.name] = el.value;
          }
          break;
        case 'select-multiple':
          data[el.name] = Array.from((element as HTMLSelectElement).options)
            .filter((opt) => opt.selected)
            .map((opt) => opt.value);
          break;
        default:
          data[el.name] = el.value;
      }
    }

    // 2. Custom content-rescuable elements
    const customElements = this.form.querySelectorAll('[data-rescue-content]');
    for (const element of customElements) {
      const name = element.getAttribute('data-rescue-content');
      if (name && !element.hasAttribute('data-no-rescue')) {
        data[name] = element.innerHTML;
      }
    }
    return data;
  }

  private _saveDraft() {
    const draft: Draft = {
      timestamp: Date.now(),
      data: this._serializeForm(),
    };
    localStorage.setItem(this.storageKey, JSON.stringify(draft));

    // Fire the onSave callback if it exists
    if (this.options.onSave) {
      this.options.onSave(draft);
    }
  }

  private _loadDraft() {
    const savedDraft = localStorage.getItem(this.storageKey);
    if (!savedDraft) return;

    try {
      const draft: Draft = JSON.parse(savedDraft);
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
      console.error('Form Rescue: Failed to parse draft from localStorage.', e);
      this._clearDraft();
    }
  }

  private _restoreForm(data: DraftData) {
    const elements = this.form.elements;
    for (const name in data) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) continue;

      const element = elements.namedItem(name);

      // Handle standard form elements
      if (element instanceof RadioNodeList || element instanceof HTMLElement) {
        const elementsToTrigger: HTMLElement[] = [];

        if (element.constructor === RadioNodeList) {
          for (const radio of Array.from(element as unknown as Iterable<HTMLInputElement>)) {
            radio.checked = radio.value === data[name];
            if (radio.checked) elementsToTrigger.push(radio);
          }
        } else {
          const el = element as HTMLInputElement;
          switch (el.type) {
            case 'checkbox':
              el.checked = data[name];
              break;
            case 'select-multiple': {
              const values = new Set(data[name]);
              for (const option of (element as HTMLSelectElement).options) {
                option.selected = values.has(option.value);
              }
              break;
            }
            default:
              el.value = data[name];
          }
          elementsToTrigger.push(el);
        }

        elementsToTrigger.forEach((el) => {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      // Handle custom content-rescuable elements
      else {
        const customElement = this.form.querySelector(`[data-rescue-content="${name}"]`);
        if (customElement) {
          customElement.innerHTML = data[name];
          // Dispatch events for frameworks that might be listening
          customElement.dispatchEvent(new Event('input', { bubbles: true }));
          customElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }

  private _clearDraft() {
    localStorage.removeItem(this.storageKey);
  }

  private _handleStorageEvent(event: StorageEvent) {
    if (event.key === this.storageKey && event.newValue) {
      try {
        const draft: Draft = JSON.parse(event.newValue);
        this._restoreForm(draft.data);
      } catch (e) {
        console.error('Form Rescue: Failed to sync from another tab.', e);
      }
    }
  }

  private _debounce(func: (...args: any[]) => void, delay: number) {
    let timeout: number;
    const debounced = function (this: any, ...args: any[]) {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => func.apply(this, args), delay);
    };
    debounced.cancel = () => {
      clearTimeout(timeout);
    };
    return debounced as ((...args: any[]) => void) & { cancel: () => void };
  }

  private _parseTtl(ttlString: string): number {
    const match = ttlString.match(/^(\d+)([mhd])$/);
    if (!match) return 24 * 60 * 60 * 1000;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      default:
        // 'd' is the only remaining match guaranteed by the regex
        return value * 24 * 60 * 60 * 1000;
    }
  }
}

export default Rescue;
