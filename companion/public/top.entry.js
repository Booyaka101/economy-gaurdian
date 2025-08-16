// ES module entry for Top Sold page
// Phase 1: preserve behavior by loading existing top.js (side-effect) via controller
import { TopController } from './top.controller.js';

(async function main() {
  try {
    const ctl = new TopController();
    await ctl.init();
  } catch (e) {
    try {
      console.error('[Top] init failed', e);
    } catch {}
  }
})();
