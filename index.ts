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

type RescuableFormControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isRescuableFormControl = (
  element: Element | RadioNodeList | null,
): element is RescuableFormControl =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLSelectElement ||
  element instanceof HTMLTextAreaElement;

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
  private boundHandleInput!: () => void;
  private boundHandleStorageEvent!: (event: StorageEvent) => void;
  private boundHandleSubmit!: (event: Event) => void;
  private debouncedSave!: (() => void) & { cancel: () => void };
  private isRestoring = false;

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

    this.boundClearDraft = this._clearDraft.bind(this) as () => void;
    this.boundHandleInput = this._handleInput.bind(this) as () => void;
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
    }

    console.error(`Form Rescue: Could not find form with selector "${formSelectorOrElement}".`);
  }

  private _addEventListeners() {
    this.form.addEventListener('input', this.boundHandleInput);
    this.form.addEventListener('submit', this.boundHandleSubmit);
    this.form.addEventListener('reset', this.boundClearDraft);
    window.addEventListener('storage', this.boundHandleStorageEvent);
  }

  private _handleInput() {
    if (this.isRestoring) {
      return;
    }

    this.debouncedSave();
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
    this.debouncedSave.cancel();

    this.form.removeEventListener('input', this.boundHandleInput);
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

  private _getNamedControls(name: string): RescuableFormControl[] {
    const namedItem = this.form.elements.namedItem(name);
    if (!namedItem) {
      return [];
    }

    if (namedItem instanceof RadioNodeList) {
      return Array.from(namedItem as unknown as ArrayLike<Element>).filter(isRescuableFormControl);
    }

    return isRescuableFormControl(namedItem) ? [namedItem] : [];
  }

  private _shouldSerializeControl(element: RescuableFormControl) {
    return (
      !!element.name &&
      !element.disabled &&
      !(element instanceof HTMLInputElement && element.type === 'file') &&
      !element.hasAttribute('data-no-rescue')
    );
  }

  private _serializeForm() {
    const data: DraftData = {};
    const processedChoiceGroups = new Set<string>();

    for (const element of Array.from(this.form.elements)) {
      if (!isRescuableFormControl(element) || !this._shouldSerializeControl(element)) {
        continue;
      }

      if (element instanceof HTMLInputElement && element.type === 'checkbox') {
        const checkboxGroup = this._getNamedControls(element.name).filter(
          (control): control is HTMLInputElement =>
            control instanceof HTMLInputElement &&
            control.type === 'checkbox' &&
            this._shouldSerializeControl(control),
        );

        if (checkboxGroup.length > 1) {
          if (!processedChoiceGroups.has(element.name)) {
            data[element.name] = checkboxGroup
              .filter((checkbox) => checkbox.checked)
              .map((checkbox) => checkbox.value);
            processedChoiceGroups.add(element.name);
          }

          continue;
        }

        data[element.name] = element.checked;
        continue;
      }

      if (element instanceof HTMLInputElement && element.type === 'radio') {
        if (processedChoiceGroups.has(element.name)) {
          continue;
        }

        const radioGroup = this._getNamedControls(element.name).filter(
          (control): control is HTMLInputElement =>
            control instanceof HTMLInputElement &&
            control.type === 'radio' &&
            this._shouldSerializeControl(control),
        );
        const checkedRadio = radioGroup.find((radio) => radio.checked);

        if (checkedRadio) {
          data[element.name] = checkedRadio.value;
        }

        processedChoiceGroups.add(element.name);
        continue;
      }

      if (element instanceof HTMLSelectElement && element.multiple) {
        data[element.name] = Array.from(element.options)
          .filter((option) => option.selected)
          .map((option) => option.value);
        continue;
      }

      data[element.name] = element.value;
    }

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

    try {
      localStorage.setItem(this.storageKey, JSON.stringify(draft));
      this.options.onSave?.(draft);
    } catch (e) {
      console.error('Form Rescue: Failed to save draft to localStorage.', e);
    }
  }

  private _loadDraft() {
    let savedDraft: string | null = null;

    try {
      savedDraft = localStorage.getItem(this.storageKey);
    } catch (e) {
      console.error('Form Rescue: Failed to read draft from localStorage.', e);
      return;
    }

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

  private _dispatchRestoreEvents(elementsToTrigger: HTMLElement[]) {
    elementsToTrigger.forEach((element) => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  private _restoreSingleControl(
    element: RescuableFormControl,
    value: DraftData[string],
    elementsToTrigger: HTMLElement[],
  ) {
    if (element instanceof HTMLInputElement && element.type === 'checkbox') {
      element.checked = Boolean(value);
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      const values = new Set(Array.isArray(value) ? value.map((entry) => String(entry)) : []);
      for (const option of element.options) {
        option.selected = values.has(option.value);
      }
    } else {
      element.value = value == null ? '' : String(value);
    }

    elementsToTrigger.push(element);
  }

  private _restoreForm(data: DraftData) {
    this.isRestoring = true;

    try {
      for (const name in data) {
        if (!Object.prototype.hasOwnProperty.call(data, name)) continue;

        const namedControls = this._getNamedControls(name);
        const elementsToTrigger: HTMLElement[] = [];

        if (namedControls.length > 0) {
          const checkboxGroup = namedControls.filter(
            (control): control is HTMLInputElement =>
              control instanceof HTMLInputElement && control.type === 'checkbox',
          );
          const radioGroup = namedControls.filter(
            (control): control is HTMLInputElement =>
              control instanceof HTMLInputElement && control.type === 'radio',
          );

          if (checkboxGroup.length > 1) {
            const values = new Set(
              Array.isArray(data[name]) ? data[name].map((entry) => String(entry)) : [],
            );

            checkboxGroup.forEach((checkbox) => {
              checkbox.checked = values.has(checkbox.value);
              elementsToTrigger.push(checkbox);
            });
          } else if (radioGroup.length > 0) {
            radioGroup.forEach((radio) => {
              radio.checked = radio.value === data[name];
              if (radio.checked) {
                elementsToTrigger.push(radio);
              }
            });
          } else {
            this._restoreSingleControl(namedControls[0], data[name], elementsToTrigger);
          }

          this._dispatchRestoreEvents(elementsToTrigger);
          continue;
        }

        const customElement = this.form.querySelector(`[data-rescue-content="${name}"]`);
        if (customElement) {
          customElement.innerHTML = String(data[name] ?? '');
          customElement.dispatchEvent(new Event('input', { bubbles: true }));
          customElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } finally {
      this.isRestoring = false;
    }
  }

  private _clearDraft() {
    try {
      localStorage.removeItem(this.storageKey);
    } catch (e) {
      console.error('Form Rescue: Failed to clear draft from localStorage.', e);
    }
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

  private _debounce(func: () => void, delay: number) {
    let timeout: number;
    const debounced = () => {
      clearTimeout(timeout);
      timeout = window.setTimeout(() => func(), delay);
    };

    debounced.cancel = () => {
      clearTimeout(timeout);
    };

    return debounced;
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
        return value * 24 * 60 * 60 * 1000;
    }
  }
}

export default Rescue;
