import '@tether/ui/globals.css';
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from 'web/app';

// Deep links (tether://room/<id>) arrive from the main process. Under file://
// the web app uses hash routing, so steering the hash navigates the router.
const desktopApi = window.tether;
desktopApi?.onOpenRoom((roomId) => {
  window.location.hash = `/room/${roomId}`;
});
desktopApi?.ready();

const rootElement = document.getElementById('root');

if (!rootElement?.innerHTML) {
  ReactDOM.createRoot(rootElement!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
