# Form Rescue

An intelligent, zero-dependency auto-saver for HTML forms.

Form Rescue acts as a safety net for your users. It automatically and efficiently persists form data to `localStorage` in the background as the user types. If the user accidentally closes the tab, navigates away, or experiences a browser crash, Form Rescue will seamlessly restore their typed data upon returning to the page.

## Features

- **Zero Dependencies**: Lightweight and built with modern vanilla JavaScript/TypeScript.
- **Debounced Auto-saving**: Ensures high performance by waiting for the user to pause typing before writing to storage.
- **Cross-Tab Synchronization**: Automatically syncs form state across multiple open tabs.
- **Smart Expiration**: Supports configurable Time-To-Live (TTL) to automatically discard stale drafts.
- **AJAX Support**: Built-in support for intercepting and handling custom asynchronous form submissions.
- **Custom Element Support**: Can save and restore content from custom `contenteditable` elements.

## Installation

Install via npm:

```bash
npm install form-rescue
```

## Basic Usage

The easiest way to use Form Rescue is by calling the static `watch` method and passing a CSS selector for your form.

```javascript
import Rescue from 'form-rescue';

// Initializes auto-saving on the form with the ID "checkout-form"
Rescue.watch('#checkout-form');
```

Alternatively, you can instantiate it directly with an HTML element:

```javascript
const myForm = document.getElementById('checkout-form');
const rescueInstance = new Rescue(myForm);
```

## Configuration Options

You can pass an optional configuration object as the second argument to customize the behavior of Form Rescue.

```javascript
Rescue.watch('#checkout-form', {
  ttl: '48h',
  debounce: 500,
  clearOnSubmit: true,
});
```

### Available Options

| Option          | Type       | Default          | Description                                                                                                                                 |
| --------------- | ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ttl`           | `string`   | `'24h'`          | Time-to-live for the saved draft. Supports minutes (`m`), hours (`h`), and days (`d`). Examples: `'30m'`, `'12h'`, `'7d'`.                  |
| `debounce`      | `number`   | `300`            | Delay in milliseconds to wait after the last input event before saving the draft.                                                           |
| `storageKey`    | `string`   | _auto-generated_ | Custom key used for `localStorage`. Defaults to a unique key based on the URL path and form ID/name.                                        |
| `clearOnSubmit` | `boolean`  | `true`           | Automatically clears the draft from storage when the native `submit` event fires.                                                           |
| `onDraftFound`  | `function` | `undefined`      | Callback triggered when an existing draft is found on initialization. Passes the draft data and a manual restore function.                  |
| `onSave`        | `function` | `undefined`      | Callback triggered immediately after a draft is successfully saved to storage.                                                              |
| `onAjaxSubmit`  | `function` | `undefined`      | Callback for asynchronous form submissions. Prevents default behavior, awaits the returned Promise, and clears the draft only upon success. |

## API Reference

### Instance Methods

Once instantiated, you have access to several methods for manual control over the form's draft state.

#### `save()`

Manually triggers an immediate save of the current form state, bypassing the standard debounce delay.

```javascript
rescueInstance.save();
```

#### `clear()`

Manually deletes the saved draft from `localStorage`.

```javascript
rescueInstance.clear();
```

#### `destroy()`

Removes all event listeners and cleans up the instance. This is highly recommended for Single Page Applications (SPAs) to prevent memory leaks when a form component is unmounted.

```javascript
rescueInstance.destroy();
```

### Static Methods

#### `Rescue.watch(selectorOrElement, options?)`

A utility method to easily find a form in the DOM and initialize Form Rescue. Returns the created `Rescue` instance, or `undefined` if the form cannot be found.

## HTML Attributes

Form Rescue respects specific HTML attributes to grant you granular control over what gets saved.

### Excluding Specific Fields

By default, Form Rescue ignores `disabled` fields, `type="file"` inputs, and fields without a `name` attribute.

To explicitly prevent a specific input from being saved, add the `data-no-rescue` attribute:

```html
<input type="password" name="userPassword" data-no-rescue />
```

### Custom Content Elements

If you are using custom text editors or `contenteditable` elements, you can instruct Form Rescue to save their `innerHTML` by using the `data-rescue-content` attribute. The value provided will be used as the internal property key.

```html
<div contenteditable="true" data-rescue-content="documentNotes">User notes go here...</div>
```

## Advanced Usage

### Handling AJAX Submissions

If your form submits data asynchronously, the default `submit` listener might clear the draft before the server confirms a successful operation. Use `onAjaxSubmit` to handle this safely:

```javascript
Rescue.watch('#ajax-form', {
  onAjaxSubmit: async (event) => {
    // event.preventDefault() is automatically called by Form Rescue

    const response = await fetch('/api/submit', {
      method: 'POST',
      body: new FormData(event.target),
    });

    if (!response.ok) {
      throw new Error('Server error'); // Draft is retained
    }

    // Promise resolves successfully; Draft is automatically cleared
    return response.json();
  },
});
```

### Prompting Before Restore

If you want to ask the user before overwriting their form with a saved draft, use the `onDraftFound` callback.

```javascript
Rescue.watch('#ticket-form', {
  onDraftFound: (draft, restore) => {
    const dateStr = new Date(draft.timestamp).toLocaleString();
    if (confirm(`We found an unsaved draft from ${dateStr}. Would you like to restore it?`)) {
      restore();
    }
  },
});
```

## License

ISC
