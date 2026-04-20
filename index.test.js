import Rescue from './index.js';

// Helper to create a basic form in the JSDOM environment for each test
const createForm = () => {
  document.body.innerHTML = `
        <form id="test-form">
            <input type="text" name="fullName" />
            <input type="email" name="emailAddress" />
            <input type="password" name="password" data-no-rescue />
            <input type="checkbox" name="agreed" />
            <input type="radio" name="shipping" value="standard" checked />
            <input type="radio" name="shipping" value="express" />
            <input type="range" name="volume" min="0" max="100" value="50" />
            <div contenteditable="true" data-rescue-content="notes">Initial content</div>
        </form>
    `;
  return document.getElementById('test-form');
};

const STORAGE_KEY = `form-rescue-draft:${window.location.pathname}:test-form`;

describe('Form Rescue', () => {
  let form;

  beforeEach(() => {
    // Set up a clean DOM, clear localStorage, and use fake timers for each test
    form = createForm();
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Clean up fake timers
    jest.useRealTimers();
  });

  it('should save form data to localStorage on input', () => {
    new Rescue(form);

    const nameInput = form.elements.fullName;
    nameInput.value = 'John Doe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fast-forward time to trigger the debounced save
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(savedData).not.toBeNull();
    expect(savedData.data.fullName).toBe('John Doe');
  });

  it('should not save fields with data-no-rescue attribute', () => {
    new Rescue(form);

    const passwordInput = form.elements.password;
    passwordInput.value = 'supersecret';
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
    // The 'data' object should exist, but the 'password' key should not.
    expect(savedData.data.password).toBeUndefined();
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

    expect(form.elements.fullName.value).toBe('Jane Doe');
    expect(form.elements.agreed.checked).toBe(true);
    expect(form.elements.shipping.value).toBe('express');
    expect(form.elements.volume.value).toBe('85');
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

    const nameInput = form.elements.fullName;
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
    expect(form.elements.fullName.value).toBe('');
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
    expect(form.elements.fullName.value).toBe('Synced Name');
    expect(form.elements.agreed.checked).toBe(true);
    expect(form.elements.shipping.value).toBe('express');
  });

  it('should save and restore content from a contenteditable div', () => {
    new Rescue(form);
    const notesEditor = form.querySelector('[data-rescue-content="notes"]');

    // 1. Test saving
    notesEditor.innerHTML = 'This is a <b>bold</b> comment.';
    notesEditor.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(savedData.data.notes).toBe('This is a <b>bold</b> comment.');

    // 2. Test restoring by creating a new instance
    notesEditor.innerHTML = ''; // Clear the editor
    new Rescue(form); // This should trigger the _loadDraft

    expect(notesEditor.innerHTML).toBe('This is a <b>bold</b> comment.');
  });

  it('should not save content from a custom element with data-no-rescue', () => {
    const notesEditor = form.querySelector('[data-rescue-content="notes"]');
    notesEditor.setAttribute('data-no-rescue', ''); // Add the exclusion attribute

    new Rescue(form);

    notesEditor.innerHTML = 'This is a secret note.';
    notesEditor.dispatchEvent(new Event('input', { bubbles: true }));
    jest.runAllTimers();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(savedData.data.notes).toBeUndefined();
  });

  it('should manually save the draft when save() is called', () => {
    const rescueInstance = new Rescue(form);

    // Ensure nothing is saved initially by the constructor's loadDraft
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    const nameInput = form.elements.fullName;
    nameInput.value = 'Manual Save';

    // Call save() directly without waiting for debounce timers
    rescueInstance.save();

    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
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
    const rescueInstance = new Rescue(form, { onSave: onSaveMock });

    const nameInput = form.elements.fullName;
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

    const nameInput = form.elements.fullName;
    nameInput.value = 'Debounced Save';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Fast-forward time, but not enough to trigger the save
    jest.advanceTimersByTime(499);
    expect(onSaveMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Fast-forward time past the debounce delay
    jest.advanceTimersByTime(1);
    expect(onSaveMock).toHaveBeenCalledTimes(1);
    const savedData = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(savedData.data.fullName).toBe('Debounced Save');
  });

  it('should remove all event listeners when destroy() is called', () => {
    const onSaveMock = jest.fn();
    const rescueInstance = new Rescue(form, { onSave: onSaveMock });

    // Destroy the instance
    rescueInstance.destroy();

    // Trigger an input event
    const nameInput = form.elements.fullName;
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
});
