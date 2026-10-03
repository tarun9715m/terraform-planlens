// Fonts are bundled into the page, so the viewer never fetches anything from the network.
import './fonts.css';
import './styles.css';
import type { Plan } from '../core/types';
import { initEvents, showPlan, showStart } from './events';
import type { Payload } from './state';

initEvents();

// The planlens command embeds the plan as JSON in <script id="planlens-data">.
const data = document.getElementById('planlens-data')?.textContent?.trim();
if (data) {
  try {
    showPlan(JSON.parse(data) as Payload);
  } catch (e) {
    showStart(`The plan embedded in this page couldn't be read (${(e as Error).message}).`);
  }
} else if (import.meta.env.DEV) {
  const demo = (await import('../samples/aws-demo.json')).default as unknown as Plan;
  showPlan({ meta: { mode: 'demo', label: 'Demo plan' }, plan: demo });
} else {
  showStart();
}
