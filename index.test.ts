import Rescue, { Draft } from './index';

// Helper to create a basic form in the JSDOM environment for each test
const createForm = () => {
  document.body.innerHTML = `
        <form id="test-form">
            <input type="text" name="fullName" />
            <input type="email" name="emailAddress" />
            <textarea name="message"></textarea>
            <input type="password" name="password" data-no-rescue />
            <input type="checkbox" name="agreed" />
            <input type="checkbox" name="interests" value="news" />
            <input type="checkbox" name="interests" value="updates" />
            <input type="radio" name="shipping" value="standard" checked />
            <input type="radio" name="shipping" value="express" />
            <input type="range" name="volume" min="0" max="100" value="50" />
            <select name="tags" multiple>
                <option value="news">News</option>
                <option value="updates">Updates</option>
            </select>
            <button type="button" name="actionButton">Action</button>
            <input type="text" value="unnamed" />
            <input type="text" name="disabledField" disabled value="disabled" />
            <input type="file" name="document" />
            <div contenteditable="true" data-rescue-content="notes">Initial content</div>
        </form>
    `;
  return document.getElementById('test-form') as HTMLFormElement;
};

const createCheckboxGroupForm = () => {
  document.body.innerHTML = `
        <form id="checkbox-group-form">
            <input type="checkbox" name="interests" value="news" />
            <input type="checkbox" name="interests" value="updates" />
        </form>
    `;
  return document.getElementById('checkbox-group-form') as HTMLFormElement;
};

const STORAGE_KEY = `form-rescue-draft:${window.location.pathname}:test-form`;

describe('Form Rescue', () => {
  let form: HTMLFormElement;

  beforeEach(() => {
    // Set up a clean DOM, clear localStorage, and use fake timers for each test
    form = createForm();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should save form data to localStorage on input', () => {
    new Rescue(form);

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fast-forward time to trigger the debounced save
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData).not.toBeNull();
    expect(savedData.data.fullName).toBe('John Doe');
  });

  it('should not save fields with data-no-rescue attribute, disabled, type="file", or unnamed fields', () => {
    new Rescue(form);

    const passwordInput = form.querySelector('input[name="password"]') as HTMLInputElement;
    passwordInput.value = 'supersecret';
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

    const disabledInput = form.querySelector('input[name="disabledField"]') as HTMLInputElement;
    disabledInput.value = 'changed';
    disabledInput.dispatchEvent(new Event('input', { bubbles: true }));

    const unnamedInput = form.querySelector('input[value="unnamed"]') as HTMLInputElement;
    unnamedInput.value = 'named now?';
    unnamedInput.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    // The 'data' object should exist, but the 'password' key should not.
    expect(savedData.data.password).toBeUndefined();
    expect(savedData.data.disabledField).toBeUndefined();
    expect(Object.values(savedData.data)).not.toContain('named now?');
    expect(savedData.data.document).toBeUndefined();
  });

  it('should restore form data on initialization if a draft exists', () => {
    const draft = {
      timestamp: Date.now(),
      data: {
        fullName: 'Jane Doe',
        agreed: true,
        shipping: 'express',
        volume: '85',
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

    // Initialize Rescue, which should automatically restore the form
    new Rescue(form);

    expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
      'Jane Doe',
    );
    expect((form.querySelector('input[name="agreed"]') as HTMLInputElement).checked).toBe(true);
    expect(
      (form.querySelector('input[name="shipping"][value="express"]') as HTMLInputElement).checked,
    ).toBe(true);
    expect((form.querySelector('input[name="volume"]') as HTMLInputElement).value).toBe('85');
  });

  it('should save and restore a select-multiple field', () => {
    new Rescue(form);

    const tagsSelect = form.querySelector('select[name="tags"]') as HTMLSelectElement;
    tagsSelect.options[0].selected = true;
    tagsSelect.options[1].selected = true;
    tagsSelect.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData.data.tags).toEqual(['news', 'updates']);

    tagsSelect.options[0].selected = false;
    tagsSelect.options[1].selected = false;
    new Rescue(form);

    expect(tagsSelect.options[0].selected).toBe(true);
    expect(tagsSelect.options[1].selected).toBe(true);
  });

  it('should save and restore a textarea field', () => {
    new Rescue(form);

    const messageField = form.querySelector('textarea[name="message"]') as HTMLTextAreaElement;
    messageField.value = 'Longer feedback lives here.';
    messageField.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData.data.message).toBe('Longer feedback lives here.');

    messageField.value = '';
    new Rescue(form);

    expect(messageField.value).toBe('Longer feedback lives here.');
  });

  it('should save and restore checkbox groups that share the same name', () => {
    const checkboxGroupForm = createCheckboxGroupForm();
    const checkboxGroupStorageKey = `form-rescue-draft:${window.location.pathname}:checkbox-group-form`;

    new Rescue(checkboxGroupForm);

    const [newsCheckbox, updatesCheckbox] = Array.from(
      checkboxGroupForm.querySelectorAll('input[name="interests"]'),
    ) as HTMLInputElement[];

    newsCheckbox.checked = true;
    updatesCheckbox.checked = true;
    updatesCheckbox.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(checkboxGroupStorageKey)!);
    expect(savedData.data.interests).toEqual(['news', 'updates']);

    newsCheckbox.checked = false;
    updatesCheckbox.checked = false;

    new Rescue(checkboxGroupForm);

    expect(newsCheckbox.checked).toBe(true);
    expect(updatesCheckbox.checked).toBe(true);
  });

  it('should call onDraftFound callback if a draft exists', () => {
    const draft = { timestamp: Date.now(), data: { fullName: 'Jane Doe' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

    const onDraftFoundMock = jest.fn();
    new Rescue(form, { onDraftFound: onDraftFoundMock });

    expect(onDraftFoundMock).toHaveBeenCalledTimes(1);
    // Check that it was called with the draft and a restore function
    expect(onDraftFoundMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: draft.data }),
      expect.any(Function),
    );
  });

  it('should clear the draft from localStorage on form submit', () => {
    new Rescue(form);

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Simulate form submission
    form.dispatchEvent(new Event('submit'));

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('should not load an expired draft', () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const draft = {
      timestamp: twoHoursAgo,
      data: { fullName: 'Expired User' },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

    // Initialize with a 1-hour TTL
    new Rescue(form, { ttl: '1h' });

    // The form should not be restored
    expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe('');
    // The expired draft should be cleared from storage
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('should sync form data when a storage event occurs from another tab', () => {
    // Initialize Rescue on the form in "Tab A"
    new Rescue(form);

    // Simulate a draft being saved in "Tab B", which triggers a storage event
    const newDataFromOtherTab = {
      timestamp: Date.now(),
      data: { fullName: 'Synced Name', agreed: true, shipping: 'express' },
    };

    // Manually dispatch a 'storage' event, as JSDOM doesn't do this automatically
    const storageEvent = new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify(newDataFromOtherTab),
    });
    window.dispatchEvent(storageEvent);

    // Assert that the form in "Tab A" was updated by the event listener
    expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
      'Synced Name',
    );
    expect((form.querySelector('input[name="agreed"]') as HTMLInputElement).checked).toBe(true);
    expect(
      (form.querySelector('input[name="shipping"][value="express"]') as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('should not save a new draft while restoring data from another tab', () => {
    const onSaveMock = jest.fn();
    new Rescue(form, { onSave: onSaveMock });

    const storageEvent = new StorageEvent('storage', {
      key: STORAGE_KEY,
      newValue: JSON.stringify({
        timestamp: Date.now(),
        data: { fullName: 'Synced Name' },
      }),
    });

    window.dispatchEvent(storageEvent);
    jest.runAllTimers();

    expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
      'Synced Name',
    );
    expect(onSaveMock).not.toHaveBeenCalled();
  });

  it('should save and restore content from a contenteditable div', () => {
    new Rescue(form);
    const notesEditor = form.querySelector('[data-rescue-content="notes"]') as HTMLElement;

    // 1. Test saving
    notesEditor.innerHTML = 'This is a <b>bold</b> comment.';
    notesEditor.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData.data.notes).toBe('This is a <b>bold</b> comment.');

    // 2. Test restoring by creating a new instance
    notesEditor.innerHTML = ''; // Clear the editor
    new Rescue(form); // This should trigger the _loadDraft

    expect(notesEditor.innerHTML).toBe('This is a <b>bold</b> comment.');
  });

  it('should not save content from a custom element with data-no-rescue', () => {
    const notesEditor = form.querySelector('[data-rescue-content="notes"]') as HTMLElement;
    notesEditor.setAttribute('data-no-rescue', ''); // Add the exclusion attribute

    new Rescue(form);

    notesEditor.innerHTML = 'This is a secret note.';
    notesEditor.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData.data.notes).toBeUndefined();
  });

  it('should manually save the draft when save() is called', () => {
    const rescueInstance = new Rescue(form);

    // Ensure nothing is saved initially by the constructor's loadDraft
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'Manual Save';

    // Call save() directly without waiting for debounce timers
    rescueInstance.save();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData).not.toBeNull();
    expect(savedData.data.fullName).toBe('Manual Save');
  });

  it('should manually clear the draft when clear() is called', () => {
    const rescueInstance = new Rescue(form);

    // Create a draft first by calling save()
    rescueInstance.save();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    // Now clear it manually and verify it's gone
    rescueInstance.clear();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('should call onSave callback when a draft is saved', () => {
    const onSaveMock = jest.fn();
    new Rescue(form, { onSave: onSaveMock });

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'Testing onSave';

    // 1. Test automatic save
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    expect(onSaveMock).toHaveBeenCalledTimes(1);
    expect(onSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fullName: 'Testing onSave' }),
      }),
    );
  });

  it('should respect a custom debounce delay', () => {
    const onSaveMock = jest.fn();
    // Initialize with a 500ms debounce delay
    new Rescue(form, { debounce: 500, onSave: onSaveMock });

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'Debounced Save';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fast-forward time, but not enough to trigger the save
    jest.advanceTimersByTime(499);
    expect(onSaveMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Fast-forward time past the debounce delay
    jest.advanceTimersByTime(1);
    expect(onSaveMock).toHaveBeenCalledTimes(1);
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(savedData.data.fullName).toBe('Debounced Save');
  });

  it('should remove all event listeners when destroy() is called', () => {
    const onSaveMock = jest.fn();
    const rescueInstance = new Rescue(form, { onSave: onSaveMock });

    // Destroy the instance
    rescueInstance.destroy();

    // Trigger an input event
    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'This should not be saved';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fast-forward time
    jest.runAllTimers();

    // Assert that the save function was not called and localStorage is empty
    expect(onSaveMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Also check that submit no longer clears
    localStorage.setItem(STORAGE_KEY, 'test-data');
    form.dispatchEvent(new Event('submit'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('test-data');
  });

  it('should not clear the draft if clearOnSubmit is false', () => {
    new Rescue(form, { clearOnSubmit: false });
    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    form.dispatchEvent(new Event('submit'));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it('should clear the draft if onAjaxSubmit resolves successfully', async () => {
    const mockAjaxSubmit = jest.fn().mockResolvedValue('success');
    new Rescue(form, { onAjaxSubmit: mockAjaxSubmit });

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const submitEvent = new Event('submit', { cancelable: true });
    form.dispatchEvent(submitEvent);

    expect(submitEvent.defaultPrevented).toBe(true);
    expect(mockAjaxSubmit).toHaveBeenCalledTimes(1);

    // Flush microtasks to allow the .then() in _handleSubmit to execute
    await Promise.resolve();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('should retain the draft if onAjaxSubmit rejects', async () => {
    const mockAjaxSubmit = jest.fn().mockRejectedValue('error');
    new Rescue(form, { onAjaxSubmit: mockAjaxSubmit });

    const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const submitEvent = new Event('submit', { cancelable: true });
    form.dispatchEvent(submitEvent);

    await Promise.resolve();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  describe('Edge Cases and Error Handling', () => {
    it('should initialize using the static watch method', () => {
      const rescueInstance = Rescue.watch('#test-form');
      expect(rescueInstance).toBeInstanceOf(Rescue);
    });

    it('should initialize using the static watch method with an HTML element', () => {
      const rescueInstance = Rescue.watch(form);
      expect(rescueInstance).toBeInstanceOf(Rescue);
    });

    it('should log an error if watch is called with an invalid selector', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      Rescue.watch('#non-existent-form');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find form'));
      consoleSpy.mockRestore();
    });

    it('should log an error if instantiated without a valid form', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      new Rescue(null as any);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
      consoleSpy.mockRestore();
    });

    it('should handle corrupted JSON gracefully when loading a draft', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      localStorage.setItem(STORAGE_KEY, '{ invalid: json ]'); // Corrupted JSON

      new Rescue(form);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse draft'),
        expect.any(Error),
      );
      // It should clear the corrupted draft to prevent future errors
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
      consoleSpy.mockRestore();
    });

    it('should handle corrupted JSON gracefully during a cross-tab storage event', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      new Rescue(form);

      const storageEvent = new StorageEvent('storage', {
        key: STORAGE_KEY,
        newValue: '{ invalid: json ]',
      });
      window.dispatchEvent(storageEvent);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to sync'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('should fallback to a default 24h TTL if an invalid TTL string is provided', () => {
      const draft = { timestamp: Date.now() - 1000, data: { fullName: 'TTL Test' } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

      // 'invalid' will fail the regex in _parseTtl and default to 24h
      new Rescue(form, { ttl: 'invalid' });
      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
        'TTL Test',
      );
    });

    it('should ignore draft keys that do not match any standard or custom form element', () => {
      const draft = {
        timestamp: Date.now(),
        data: {
          nonExistentField: 'ghost data',
          actionButton: 'ignore button controls',
          fullName: 'Real User',
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

      new Rescue(form);

      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
        'Real User',
      );
    });

    it('should handle invalid draft value shapes gracefully during restore', () => {
      const draft = {
        timestamp: Date.now(),
        data: {
          interests: true,
          tags: 'news',
          fullName: null,
          notes: null,
          actionButton: 'ignored',
        },
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

      new Rescue(form);

      const interestCheckboxes = Array.from(
        form.querySelectorAll('input[name="interests"]'),
      ) as HTMLInputElement[];
      const tagsSelect = form.querySelector('select[name="tags"]') as HTMLSelectElement;
      const notesEditor = form.querySelector('[data-rescue-content="notes"]') as HTMLElement;

      expect(interestCheckboxes.every((checkbox) => !checkbox.checked)).toBe(true);
      expect(tagsSelect.options[0].selected).toBe(false);
      expect(tagsSelect.options[1].selected).toBe(false);
      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe('');
      expect(notesEditor.innerHTML).toBe('');
    });

    it('should handle minutes (m) and days (d) TTL correctly', () => {
      // Test minutes (m) expiration
      const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: fiveMinsAgo, data: { fullName: 'Minute Test' } }),
      );

      new Rescue(form, { ttl: '1m' });
      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe('');

      // Test days (d) expiration
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: twoDaysAgo, data: { fullName: 'Day Test' } }),
      );

      new Rescue(form, { ttl: '1d' });
      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe('');

      // Test days (d) valid
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ timestamp: twoDaysAgo, data: { fullName: 'Valid Day Test' } }),
      );
      new Rescue(form, { ttl: '3d' });
      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
        'Valid Day Test',
      );
    });

    it('should generate correct storage keys based on form attributes or options', () => {
      const formWithName = document.createElement('form');
      formWithName.name = 'my-form-name';
      const rescue1 = new Rescue(formWithName);
      rescue1.save();
      expect(
        localStorage.getItem(`form-rescue-draft:${window.location.pathname}:my-form-name`),
      ).not.toBeNull();

      const formNameless = document.createElement('form');
      const rescue2 = new Rescue(formNameless);
      rescue2.save();
      expect(
        localStorage.getItem(`form-rescue-draft:${window.location.pathname}:form`),
      ).not.toBeNull();

      const rescue3 = new Rescue(form, { storageKey: 'custom-key' });
      rescue3.save();
      expect(localStorage.getItem('custom-key')).not.toBeNull();
    });

    it('should fail gracefully when localStorage throws while saving', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      new Rescue(form);

      const nameInput = form.querySelector('input[name="fullName"]') as HTMLInputElement;
      nameInput.value = 'Storage Failure';
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));

      expect(() => jest.runAllTimers()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to save draft'),
        expect.any(Error),
      );
    });

    it('should fail gracefully when localStorage throws while reading', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('read failed');
      });

      expect(() => new Rescue(form)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read draft'),
        expect.any(Error),
      );
    });

    it('should fail gracefully when localStorage throws while clearing', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('clear failed');
      });

      const rescueInstance = new Rescue(form);

      expect(() => rescueInstance.clear()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clear draft'),
        expect.any(Error),
      );
    });

    it('should skip properties in the prototype chain during restore', () => {
      const draft = { timestamp: Date.now(), data: { fullName: 'Proto Test' } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));

      (Object.prototype as any).hackedKey = 'hacked';
      new Rescue(form);
      delete (Object.prototype as any).hackedKey;

      expect((form.querySelector('input[name="fullName"]') as HTMLInputElement).value).toBe(
        'Proto Test',
      );
    });
  });
});
