(() => {
  try {
    if (!window.__EGGUARD__) {
      window.__EGGUARD__ = {
        marks: Object.create(null),
        mark(key) {
          this.marks[key] = true;
        },
        isMarked(key) {
          return !!this.marks[key];
        },
        once(key, fn) {
          if (this.isMarked(key)) {
            return false;
          }
          this.mark(key);
          try {
            if (typeof fn === 'function') {
              fn();
            }
          } catch (e) {
            // no-op
          }
          return true;
        },
      };
    }
  } catch {
    // ignore
  }
})();
