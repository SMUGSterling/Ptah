// history.js — undo/redo command stack.
// A command is { label, undo(), redo() }. Push after the action has been
// performed once (push does not call redo).

export class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null; // callback for UI (enable/disable buttons, dirty flag)
  }

  push(cmd) {
    this.undoStack.push(cmd);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this._notify();
  }

  undo() { return this._step(this.undoStack, this.redoStack, 'undo'); }
  redo() { return this._step(this.redoStack, this.undoStack, 'redo'); }

  // A command that throws partway leaves the scene in a state no stack
  // describes; keeping either stack would replay commands against the wrong
  // scene. Drop the history, tell the UI, and let the error surface.
  _step(from, to, method) {
    const cmd = from.pop();
    if (!cmd) return null;
    try {
      cmd[method]();
    } catch (err) {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
      this._notify();
      throw err;
    }
    to.push(cmd);
    this._notify();
    return cmd;
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._notify();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  _notify() { if (this.onChange) this.onChange(this); }
}
